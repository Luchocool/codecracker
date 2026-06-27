function evaluateGuess(secret, guess) {
  let correctPosition = 0;
  let correctNumberWrongPosition = 0;
  const secretArr = secret.split('');
  const guessArr = guess.split('');

  for (let i = 0; i < secretArr.length; i++) {
    if (secretArr[i] === guessArr[i]) {
      correctPosition++;
      secretArr[i] = null;
      guessArr[i] = null;
    }
  }

  for (let i = 0; i < secretArr.length; i++) {
    if (guessArr[i] !== null) {
      const idx = secretArr.indexOf(guessArr[i]);
      if (idx !== -1) {
        correctNumberWrongPosition++;
        secretArr[idx] = null;
      }
    }
  }

  return { correctPosition, correctNumberWrongPosition };
}

function sanitizeRoomState(room) {
  const players = {};
  for (const [id, p] of Object.entries(room.players)) {
    players[id] = {
      name: p.name,
      isHost: p.isHost,
      ready: p.ready,
      hasSubmittedCode: p.code !== null,
    };
  }

  return {
    roomId: room.id,
    players,
    settings: { ...room.settings },
    gameState: room.gameState,
    currentTurn: room.currentTurn,
    guessHistory: room.guessHistory,
    winner: room.winner,
  };
}

export class Room {
  constructor(state, env) {
    this.state = state;
    this.connections = new Map(); // playerId -> WebSocket
    this.room = null;
  }

  async initializeRoom(playerId) {
    this.room = {
      id: this.state.id.name,
      hostId: playerId,
      guestId: null,
      players: {
        [playerId]: { name: 'Player 1', isHost: true, ready: false, code: null },
      },
      settings: { codeLength: 4 },
      gameState: 'waiting',
      currentTurn: null,
      guessHistory: [],
      winner: null,
    };
    await this.state.storage.put('room', this.room);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- HTTP endpoints for room management ----
    if (path === '/check' && request.method === 'GET') {
      if (!this.room) {
        this.room = await this.state.storage.get('room');
      }

      if (this.room && this.room.guestId) {
        return new Response(JSON.stringify({ error: 'Room is full.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!this.room) {
        return new Response(JSON.stringify({ error: 'Room not found.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const playerId = crypto.randomUUID();
      return new Response(JSON.stringify({ playerId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/init' && request.method === 'POST') {
      if (!this.room) {
        this.room = await this.state.storage.get('room');
      }
      if (this.room) {
        return new Response(JSON.stringify({ error: 'Room already exists' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const playerId = crypto.randomUUID();
      await this.initializeRoom(playerId);
      return new Response(JSON.stringify({ playerId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ---- WebSocket upgrade ----
    const playerId = url.searchParams.get('playerId');
    if (!playerId) {
      return new Response('Missing playerId', { status: 400 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    if (!this.room) {
      this.room = await this.state.storage.get('room');
    }

    if (!this.room) {
      return new Response(JSON.stringify({ error: 'Room not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);

    server.accept();

    this.connections.set(playerId, server);

    const isHost = this.room && this.room.hostId === playerId;
    const isGuest = this.room && this.room.guestId === playerId;
    const isNew = !isHost && !isGuest;

    if (isNew && this.room) {
      if (this.room.guestId) {
        server.close(4000, 'Room is full.');
        this.connections.delete(playerId);
        return new Response(null, { status: 101, webSocket: client });
      }
      this.room.guestId = playerId;
      this.room.players[playerId] = { name: 'Player 2', isHost: false, ready: false, code: null };
      await this.state.storage.put('room', this.room);

      server.send(JSON.stringify({
        type: 'room-joined',
        roomId: this.room.id,
        playerId,
        roomState: sanitizeRoomState(this.room),
      }));

      this.broadcastExcept(playerId, JSON.stringify({
        type: 'player-joined',
        roomState: sanitizeRoomState(this.room),
      }));
    } else if (isHost) {
      server.send(JSON.stringify({
        type: 'room-created',
        roomId: this.room.id,
        playerId,
        roomState: sanitizeRoomState(this.room),
      }));
    } else if (isGuest) {
      server.send(JSON.stringify({
        type: 'room-joined',
        roomId: this.room.id,
        playerId,
        roomState: sanitizeRoomState(this.room),
      }));
    }

    const ws = server;
    ws.addEventListener('message', async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleMessage(ws, playerId, msg);
      } catch (err) {
        ws.send(JSON.stringify({ type: 'room-error', message: 'Invalid message.' }));
      }
    });

    ws.addEventListener('close', async () => {
      this.connections.delete(playerId);
      await this.handleDisconnect(playerId);
    });

    ws.addEventListener('error', async () => {
      this.connections.delete(playerId);
      await this.handleDisconnect(playerId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(data) {
    for (const ws of this.connections.values()) {
      try { ws.send(data); } catch {}
    }
  }

  broadcastExcept(playerId, data) {
    for (const [pid, ws] of this.connections) {
      if (pid !== playerId) {
        try { ws.send(data); } catch {}
      }
    }
  }

  sendTo(playerId, data) {
    const ws = this.connections.get(playerId);
    if (ws) {
      try { ws.send(data); } catch {}
    }
  }

  async handleMessage(ws, playerId, msg) {
    const room = this.room;
    if (!room) return;

    switch (msg.type) {
      case 'update-name': {
        if (!room.players[playerId]) return;
        room.players[playerId].name = msg.name;
        await this.state.storage.put('room', room);
        this.broadcast(JSON.stringify({
          type: 'name-updated',
          playerId,
          name: msg.name,
          roomState: sanitizeRoomState(room),
        }));
        break;
      }

      case 'update-setting': {
        if (room.hostId !== playerId) return;
        if (msg.setting === 'codeLength' && [4, 6, 8].includes(msg.value)) {
          room.settings.codeLength = msg.value;
          await this.state.storage.put('room', room);
          this.broadcast(JSON.stringify({
            type: 'setting-updated',
            roomState: sanitizeRoomState(room),
          }));
        }
        break;
      }

      case 'player-ready': {
        if (!room.players[playerId]) return;
        room.players[playerId].ready = msg.ready;
        await this.state.storage.put('room', room);

        this.broadcast(JSON.stringify({
          type: 'ready-updated',
          playerId,
          ready: msg.ready,
          roomState: sanitizeRoomState(room),
        }));

        const allReady = room.hostId && room.guestId &&
          room.players[room.hostId]?.ready &&
          room.players[room.guestId]?.ready;

        if (allReady && room.gameState === 'waiting') {
          room.gameState = 'setting-codes';
          await this.state.storage.put('room', room);
          this.broadcast(JSON.stringify({
            type: 'game-start',
            roomState: sanitizeRoomState(room),
          }));
        }
        break;
      }

      case 'submit-code': {
        if (room.gameState !== 'setting-codes') return;
        if (!room.players[playerId]) return;
        if (msg.code.length !== room.settings.codeLength) return;

        room.players[playerId].code = msg.code;
        await this.state.storage.put('room', room);

        this.sendTo(playerId, JSON.stringify({
          type: 'code-submitted',
          roomState: sanitizeRoomState(room),
        }));

        const hostSubmitted = room.players[room.hostId]?.code !== null;
        const guestSubmitted = room.guestId && room.players[room.guestId]?.code !== null;

        if (hostSubmitted && guestSubmitted) {
          room.gameState = 'guessing';
          room.currentTurn = room.hostId;
          await this.state.storage.put('room', room);

          this.broadcast(JSON.stringify({
            type: 'both-codes-submitted',
            roomState: sanitizeRoomState(room),
          }));

          this.broadcast(JSON.stringify({
            type: 'turn-change',
            currentTurnId: room.currentTurn,
            roomState: sanitizeRoomState(room),
          }));
        }
        break;
      }

      case 'submit-guess': {
        if (room.gameState !== 'guessing') return;
        if (room.currentTurn !== playerId) return;
        if (!room.players[playerId]) return;
        if (msg.guess.length !== room.settings.codeLength) return;

        const opponentId = playerId === room.hostId ? room.guestId : room.hostId;
        if (!opponentId || !room.players[opponentId]?.code) return;

        const secret = room.players[opponentId].code;
        const result = evaluateGuess(secret, msg.guess);
        const isWin = result.correctPosition === room.settings.codeLength;

        const guessEntry = {
          playerId,
          guess: msg.guess,
          ...result,
          isWin,
        };
        room.guessHistory.push(guessEntry);
        await this.state.storage.put('room', room);

        if (isWin) {
          room.gameState = 'finished';
          room.winner = playerId;
          await this.state.storage.put('room', room);
          this.broadcast(JSON.stringify({
            type: 'game-over',
            winnerId: playerId,
            winnerCode: room.players[playerId].code,
            roomState: sanitizeRoomState(room),
          }));
        } else {
          room.currentTurn = opponentId;
          await this.state.storage.put('room', room);
          this.broadcast(JSON.stringify({
            type: 'guess-result',
            guessEntry,
            currentTurnId: opponentId,
            roomState: sanitizeRoomState(room),
          }));
        }
        break;
      }

      case 'send-emote': {
        if (!room.players[playerId]) return;
        this.broadcastExcept(playerId, JSON.stringify({
          type: 'receive-emote',
          emoji: msg.emoji,
          playerName: room.players[playerId].name,
        }));
        break;
      }

      case 'play-again': {
        if (room.gameState !== 'finished') return;

        room.players[playerId].ready = true;
        room.players[playerId].code = null;
        for (const id of Object.keys(room.players)) {
          if (id !== playerId) {
            room.players[id].ready = false;
            room.players[id].code = null;
          }
        }
        room.guessHistory = [];
        room.winner = null;
        room.gameState = 'waiting';
        room.currentTurn = null;
        await this.state.storage.put('room', room);

        this.broadcast(JSON.stringify({
          type: 'reset-for-rematch',
          roomState: sanitizeRoomState(room),
        }));
        break;
      }

      case 'leave-room': {
        ws.close(1000, 'Player left.');
        this.connections.delete(playerId);
        await this.handleDisconnect(playerId);
        break;
      }
    }
  }

  async handleDisconnect(playerId) {
    const room = this.room;
    if (!room || !room.players[playerId]) return;

    const wasInGame = room.gameState !== 'waiting';

    delete room.players[playerId];

    if (playerId === room.hostId) {
      if (room.guestId && room.players[room.guestId]) {
        room.players[room.guestId].isHost = true;
        room.hostId = room.guestId;
        room.guestId = null;
        if (wasInGame) this.resetRoomForLobby(room);
        await this.state.storage.put('room', room);
        this.broadcast(JSON.stringify({
          type: 'host-transferred',
          roomState: sanitizeRoomState(room),
        }));
      } else {
        await this.state.storage.deleteAll();
        this.room = null;
        return;
      }
    } else if (playerId === room.guestId) {
      room.guestId = null;
      if (wasInGame) this.resetRoomForLobby(room);
      await this.state.storage.put('room', room);
      this.broadcast(JSON.stringify({
        type: 'player-left',
        playerId,
        roomState: sanitizeRoomState(room),
      }));
    } else {
      if (wasInGame) {
        this.resetRoomForLobby(room);
        await this.state.storage.put('room', room);
      }
    }
  }

  resetRoomForLobby(room) {
    room.gameState = 'waiting';
    room.currentTurn = null;
    room.guessHistory = [];
    room.winner = null;
    for (const id of Object.keys(room.players)) {
      room.players[id].ready = false;
      room.players[id].code = null;
    }
  }
}
