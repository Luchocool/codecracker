const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms[code]);
  return code;
}

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

function getRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return null;

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

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('create-room', () => {
    const roomId = generateRoomCode();
    const room = {
      id: roomId,
      hostId: socket.id,
      guestId: null,
      players: {
        [socket.id]: {
          name: 'Player 1',
          isHost: true,
          ready: false,
          code: null,
        },
      },
      settings: { codeLength: 4 },
      gameState: 'waiting',
      currentTurn: null,
      guessHistory: [],
      winner: null,
    };
    rooms[roomId] = room;
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-created', { roomId, playerId: socket.id, roomState: getRoomState(roomId) });
  });

  socket.on('join-room', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('room-error', { message: 'Room not found. Check your code and try again.' });
      return;
    }
    if (room.guestId) {
      socket.emit('room-error', { message: 'Room is full (2/2 players).' });
      return;
    }

    room.guestId = socket.id;
    room.players[socket.id] = {
      name: name || 'Player 2',
      isHost: false,
      ready: false,
      code: null,
    };
    currentRoom = roomId;
    socket.join(roomId);

    socket.emit('room-joined', { roomId, playerId: socket.id, roomState: getRoomState(roomId) });
    socket.to(roomId).emit('player-joined', { roomState: getRoomState(roomId) });
  });

  socket.on('update-name', ({ name }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].name = name;
    socket.to(currentRoom).emit('name-updated', { playerId: socket.id, name, roomState: getRoomState(currentRoom) });
  });

  socket.on('update-setting', ({ setting, value }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || room.hostId !== socket.id) return;
    if (setting === 'codeLength' && [4, 6, 8].includes(value)) {
      room.settings.codeLength = value;
      io.in(currentRoom).emit('setting-updated', { roomState: getRoomState(currentRoom) });
    }
  });

  socket.on('player-ready', ({ ready }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || !room.players[socket.id]) return;
    room.players[socket.id].ready = ready;
    io.in(currentRoom).emit('ready-updated', { playerId: socket.id, ready, roomState: getRoomState(currentRoom) });

    const allReady = room.hostId && room.guestId &&
      room.players[room.hostId]?.ready &&
      room.players[room.guestId]?.ready;

    if (allReady && room.gameState === 'waiting') {
      room.gameState = 'setting-codes';
      io.in(currentRoom).emit('game-start', { roomState: getRoomState(currentRoom) });
    }
  });

  socket.on('submit-code', ({ code }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || !room.players[socket.id]) return;
    if (room.gameState !== 'setting-codes') return;
    if (code.length !== room.settings.codeLength) return;

    room.players[socket.id].code = code;
    socket.emit('code-submitted', { roomState: getRoomState(currentRoom) });

    const hostSubmitted = room.players[room.hostId]?.code !== null;
    const guestSubmitted = room.guestId && room.players[room.guestId]?.code !== null;

    if (hostSubmitted && guestSubmitted) {
      room.gameState = 'guessing';
      room.currentTurn = room.hostId;
      io.in(currentRoom).emit('both-codes-submitted', { roomState: getRoomState(currentRoom) });

      const turnPlayerId = room.currentTurn;
      io.in(currentRoom).emit('turn-change', {
        currentTurnId: turnPlayerId,
        roomState: getRoomState(currentRoom),
      });
    }
  });

  socket.on('submit-guess', ({ guess }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || !room.players[socket.id]) return;
    if (room.gameState !== 'guessing') return;
    if (room.currentTurn !== socket.id) return;
    if (guess.length !== room.settings.codeLength) return;

    const opponentId = socket.id === room.hostId ? room.guestId : room.hostId;
    if (!opponentId || !room.players[opponentId]?.code) return;

    const secret = room.players[opponentId].code;
    const result = evaluateGuess(secret, guess);
    const isWin = result.correctPosition === room.settings.codeLength;

    const guessEntry = {
      playerId: socket.id,
      guess,
      ...result,
      isWin,
    };
    room.guessHistory.push(guessEntry);

    if (isWin) {
      room.gameState = 'finished';
      room.winner = socket.id;
      io.in(currentRoom).emit('game-over', {
        winnerId: socket.id,
        roomState: getRoomState(currentRoom),
      });
    } else {
      room.currentTurn = opponentId;
      io.in(currentRoom).emit('guess-result', {
        guessEntry,
        currentTurnId: opponentId,
        roomState: getRoomState(currentRoom),
      });
    }
  });

  socket.on('play-again', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room || !room.players[socket.id]) return;
    if (room.gameState !== 'finished') return;

    room.players[socket.id].ready = true;
    room.players[socket.id].code = null;
    for (const id of Object.keys(room.players)) {
      if (id !== socket.id) {
        room.players[id].ready = false;
        room.players[id].code = null;
      }
    }
    room.guessHistory = [];
    room.winner = null;
    room.gameState = 'waiting';
    room.currentTurn = null;

    io.in(currentRoom).emit('reset-for-rematch', { roomState: getRoomState(currentRoom) });
  });

  socket.on('leave-room', () => {
    handleDisconnect();
  });

  function resetRoomForLobby(room) {
    room.gameState = 'waiting';
    room.currentTurn = null;
    room.guessHistory = [];
    room.winner = null;
    for (const id of Object.keys(room.players)) {
      room.players[id].ready = false;
      room.players[id].code = null;
    }
  }

  function handleDisconnect() {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room) return;

    const wasInGame = room.gameState !== 'waiting';

    delete room.players[socket.id];

    if (socket.id === room.hostId) {
      if (room.guestId && room.players[room.guestId]) {
        room.players[room.guestId].isHost = true;
        room.hostId = room.guestId;
        room.guestId = null;
        if (wasInGame) resetRoomForLobby(room);
        socket.to(currentRoom).emit('host-transferred', { roomState: getRoomState(currentRoom) });
      } else {
        delete rooms[currentRoom];
        return;
      }
    } else if (socket.id === room.guestId) {
      room.guestId = null;
      if (wasInGame) resetRoomForLobby(room);
      socket.to(currentRoom).emit('player-left', { playerId: socket.id, roomState: getRoomState(currentRoom) });
    } else {
      if (wasInGame) resetRoomForLobby(room);
    }
  }

  socket.on('disconnect', handleDisconnect);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
