(function () {
  'use strict';

  const WORKER_URL = 'https://codecracker.luchocuber-09d.workers.dev';

  const WS_URL = `${WORKER_URL.replace(/^http/, 'ws')}/ws`;

  const API_URL = WORKER_URL;

  let ws = null;
  let connected = false;
  let reconnectTimer = null;
  let roomCode = null;
  let playerId = null;

  // --- State ---
  let state = {
    roomId: null,
    playerId: null,
    isHost: false,
    myName: '',
    opponentName: '',
    codeLength: 4,
    gameState: 'waiting',
    ready: false,
    currentTurnId: null,
    guessHistory: [],
    winnerId: null,
    myCodeSubmitted: false,
  };

  let codeDials = [];
  let guessDials = [];
  let mySecretCode = '';
  let codeTimer = null;

  // --- DOM refs ---
  const $ = (id) => document.getElementById(id);
  const viewHome = $('view-home');
  const viewLobby = $('view-lobby');
  const viewGame = $('view-game');
  const homeMain = $('home-main');
  const homeOptions = $('home-options');
  const btnPlay = $('btn-play');
  const btnCreateRoom = $('btn-create-room');
  const btnJoin = $('btn-join');
  const inputJoinCode = $('input-join-code');
  const joinError = $('join-error');
  const roomCodeDisplay = $('room-code-display');
  const inputNameHost = $('input-name-host');
  const inputNameGuest = $('input-name-guest');
  const playerSlots = $('player-slots');
  const settingsPanel = $('settings-panel');
  const guestOverlay = $('guest-overlay');
  const settingBtns = settingsPanel.querySelectorAll('.setting-btn');
  const btnReady = $('btn-ready');
  const readyStatus = $('ready-status');
  const btnLobbyLeave = $('btn-lobby-leave');
  const turnBanner = $('turn-banner');
  const turnText = $('turn-text');
  const yourCodeDisplay = $('your-code-display');
  const yourCodeValue = $('your-code-value');
  const phaseSetCode = $('phase-set-code');
  const phaseGuessing = $('phase-guessing');
  const phaseGameover = $('phase-gameover');
  const codeDialsContainer = $('code-dials');
  const guessDialsContainer = $('guess-dials');
  const btnSubmitCode = $('btn-submit-code');
  const submitCodeStatus = $('submit-code-status');
  const btnSubmitGuess = $('btn-submit-guess');
  const guessStatus = $('guess-status');
  const guessHistoryContainer = $('guess-history-container');
  const guessHistoryEl = $('guess-history');
  const btnToggleOpponentGuesses = $('btn-toggle-opponent-guesses');
  const waitingCodeOverlay = $('waiting-code-overlay');
  const codeTimerEl = $('code-timer');
  const gameoverIcon = $('gameover-icon');
  const gameoverTitle = $('gameover-title');
  const gameoverSubtitle = $('gameover-subtitle');
  const gameoverHistory = $('gameover-history');
  const btnPlayAgain = $('btn-play-again');
  const btnBackLobby = $('btn-back-lobby');
  const btnEmote = $('btn-emote');
  const emotePicker = $('emote-picker');
  const btnCloseEmote = $('btn-close-emote');
  const emoteOptions = document.querySelectorAll('.emote-option');
  const emoteDisplay = $('emote-display');
  const emoteDisplayText = $('emote-display-text');

  // --- View switching ---
  function showView(viewId) {
    [viewHome, viewLobby, viewGame].forEach(v => v.classList.remove('active'));
    const el = $(viewId);
    if (el) el.classList.add('active');
  }

  // --- Dials ---
  function createDials(container, length) {
    container.innerHTML = '';
    const dials = [];
    for (let i = 0; i < length; i++) {
      const digit = document.createElement('div');
      digit.className = 'dial-digit';
      digit.innerHTML = `
        <div class="dial-arrow dial-up" data-idx="${i}">▲</div>
        <div class="dial-value" data-idx="${i}">0</div>
        <div class="dial-arrow dial-down" data-idx="${i}">▼</div>
      `;
      container.appendChild(digit);
      dials.push(0);
    }

    container.querySelectorAll('.dial-up').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        dials[idx] = (dials[idx] + 1) % 10;
        updateDialDisplay(container, idx, dials[idx]);
      });
    });
    container.querySelectorAll('.dial-down').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        dials[idx] = (dials[idx] + 9) % 10;
        updateDialDisplay(container, idx, dials[idx]);
      });
    });

    container.querySelectorAll('.dial-value').forEach(el => {
      el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx);
        if (e.deltaY < 0) {
          dials[idx] = (dials[idx] + 1) % 10;
        } else {
          dials[idx] = (dials[idx] + 9) % 10;
        }
        updateDialDisplay(container, idx, dials[idx]);
      }, { passive: false });

      let touchStartY = 0;
      el.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      el.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.abs(dy) < 15) return;
        const idx = parseInt(el.dataset.idx);
        if (dy < 0) {
          dials[idx] = (dials[idx] + 1) % 10;
        } else {
          dials[idx] = (dials[idx] + 9) % 10;
        }
        updateDialDisplay(container, idx, dials[idx]);
        touchStartY = e.touches[0].clientY;
      }, { passive: false });

      el.addEventListener('click', (e) => {
        const idx = parseInt(el.dataset.idx);
        dials[idx] = (dials[idx] + 1) % 10;
        updateDialDisplay(container, idx, dials[idx]);
      });
    });

    return dials;
  }

  function updateDialDisplay(container, idx, value) {
    const valEl = container.querySelector(`.dial-value[data-idx="${idx}"]`);
    if (valEl) {
      valEl.textContent = value;
      valEl.classList.add('active-spin');
      setTimeout(() => valEl.classList.remove('active-spin'), 200);
    }
  }

  function getDialValues(dialsArr) {
    return dialsArr.join('');
  }

  function resetDials(dialsArr) {
    for (let i = 0; i < dialsArr.length; i++) dialsArr[i] = 0;
  }

  function syncDialDisplay(container, dialsArr) {
    for (let i = 0; i < dialsArr.length; i++) {
      const valEl = container.querySelector(`.dial-value[data-idx="${i}"]`);
      if (valEl) valEl.textContent = dialsArr[i];
    }
  }

  // --- WebSocket ---
  function connectWebSocket(code, pid) {
    if (ws) {
      roomCode = null;
      playerId = null;
      ws.close();
      ws = null;
    }

    roomCode = code;
    playerId = pid;

    const url = `${WS_URL}?roomCode=${encodeURIComponent(code)}&playerId=${encodeURIComponent(pid)}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected = true;
      btnPlay.disabled = false;
      btnPlay.textContent = '▶ PLAY';
      btnPlay.className = 'btn-base btn-primary w-full text-lg py-4';
      const cs = document.getElementById('conn-status');
      if (cs) cs.remove();
    };

    ws.onclose = () => {
      connected = false;
      scheduleReconnect();
    };

    ws.onerror = () => {
      if (!connected) {
        btnPlay.disabled = true;
        btnPlay.textContent = '⚠ Connecting...';
        btnPlay.className = 'btn-base btn-ghost w-full text-lg py-4 cursor-wait';
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('Invalid message:', e);
      }
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (!roomCode || !playerId) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket(roomCode, playerId);
    }, 1000);
  }

  function wsSend(type, payload = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  // --- Server message handler ---
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'room-created': {
        state.roomId = msg.roomId;
        state.playerId = msg.playerId;
        state.isHost = true;
        state.myName = 'Player 1';
        state.opponentName = '';

        roomCodeDisplay.textContent = msg.roomId;
        showView('view-lobby');
        updateLobbyUI(msg.roomState);
        updateReadyStatus(msg.roomState);
        break;
      }

      case 'room-joined': {
        state.roomId = msg.roomId;
        state.playerId = msg.playerId;
        state.isHost = false;
        state.myName = 'Player 2';

        roomCodeDisplay.textContent = msg.roomId;
        showView('view-lobby');
        updateLobbyUI(msg.roomState);
        updateReadyStatus(msg.roomState);
        break;
      }

      case 'room-error': {
        joinError.textContent = msg.message;
        joinError.classList.remove('hidden');
        setTimeout(() => joinError.classList.add('hidden'), 4000);
        break;
      }

      case 'player-joined': {
        updateLobbyUI(msg.roomState);
        updateReadyStatus(msg.roomState);
        break;
      }

      case 'player-left': {
        if (state.gameState !== 'waiting') {
          state.gameState = 'waiting';
          state.ready = false;
          state.myCodeSubmitted = false;
          btnReady.textContent = 'READY';
          btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
          showView('view-lobby');
        }
        updateLobbyUI(msg.roomState);
        updateReadyStatus(msg.roomState);
        break;
      }

      case 'host-transferred': {
        state.isHost = true;
        if (state.gameState !== 'waiting') {
          state.gameState = 'waiting';
          state.ready = false;
          state.myCodeSubmitted = false;
          btnReady.textContent = 'READY';
          btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
          showView('view-lobby');
        }
        updateLobbyUI(msg.roomState);
        updateReadyStatus(msg.roomState);
        break;
      }

      case 'name-updated': {
        const players = msg.roomState.players;
        for (const id of Object.keys(players)) {
          if (id !== state.playerId) {
            if (players[id].isHost) {
              inputNameHost.value = players[id].name;
            } else {
              inputNameGuest.value = players[id].name;
            }
          }
        }
        break;
      }

      case 'setting-updated': {
        updateLobbyUI(msg.roomState);
        break;
      }

      case 'ready-updated': {
        if (msg.playerId === state.playerId) {
          state.ready = msg.ready;
        }
        if (msg.roomState) {
          updateLobbyUI(msg.roomState);
          updateReadyStatus(msg.roomState);
        }
        break;
      }

      case 'game-start': {
        state.gameState = 'setting-codes';
        state.myCodeSubmitted = false;
        state.guessHistory = [];

        phaseSetCode.classList.remove('hidden');
        phaseGuessing.classList.add('hidden');
        phaseGameover.classList.add('hidden');
        waitingCodeOverlay.classList.add('hidden');
        guessHistoryContainer.classList.add('hidden');
        turnBanner.classList.add('hidden');
        btnSubmitGuess.classList.add('hidden');
        yourCodeDisplay.classList.add('hidden');
        emoteDisplay.classList.add('hidden');

        codeDials = createDials(codeDialsContainer, state.codeLength);
        resetDials(codeDials);
        syncDialDisplay(codeDialsContainer, codeDials);

        btnSubmitCode.disabled = false;
        btnSubmitCode.textContent = 'SUBMIT';
        submitCodeStatus.classList.add('hidden');

        clearInterval(codeTimer);
        let seconds = 60;
        codeTimerEl.textContent = '01:00';
        codeTimerEl.classList.remove('hidden');
        codeTimer = setInterval(() => {
          seconds--;
          const m = String(Math.floor(seconds / 60)).padStart(2, '0');
          const s = String(seconds % 60).padStart(2, '0');
          codeTimerEl.textContent = `${m}:${s}`;
          if (seconds <= 0) {
            clearInterval(codeTimer);
            codeTimerEl.classList.add('hidden');
            const changedCount = codeDials.filter(v => v !== 0).length;
            const code = changedCount >= 2 ? getDialValues(codeDials) : Array.from({ length: state.codeLength }, () => Math.floor(Math.random() * 10)).join('');
            mySecretCode = code;
            btnSubmitCode.disabled = true;
            btnSubmitCode.textContent = 'Submitting...';
            wsSend('submit-code', { code });
          }
        }, 1000);

        btnEmote.classList.remove('hidden');
        showView('view-game');
        break;
      }

      case 'code-submitted': {
        clearInterval(codeTimer);
        codeTimerEl.classList.add('hidden');
        state.myCodeSubmitted = true;
        btnSubmitCode.disabled = true;
        btnSubmitCode.textContent = '✅ Code Submitted';
        submitCodeStatus.textContent = 'Your code is locked in! Waiting for opponent...';
        submitCodeStatus.className = 'text-center text-sm text-green-400 mt-3';
        submitCodeStatus.classList.remove('hidden');
        phaseSetCode.classList.add('hidden');
        waitingCodeOverlay.classList.remove('hidden');
        break;
      }

      case 'both-codes-submitted': {
        state.gameState = 'guessing';
        phaseSetCode.classList.add('hidden');
        waitingCodeOverlay.classList.add('hidden');
        phaseGuessing.classList.remove('hidden');
        guessHistoryContainer.classList.remove('hidden');
        guessHistoryEl.innerHTML = '';
        turnBanner.classList.remove('hidden');
        yourCodeValue.textContent = mySecretCode;
        yourCodeDisplay.classList.remove('hidden');

        guessDials = createDials(guessDialsContainer, state.codeLength);
        resetDials(guessDials);
        syncDialDisplay(guessDialsContainer, guessDials);

        if (msg.roomState.currentTurn === state.playerId) {
          turnBanner.className = 'text-center mb-6 py-3 px-4 rounded-xl neon-glow-green';
          turnText.innerHTML = '🎯 Your Turn! Make a guess.';
          btnSubmitGuess.classList.remove('hidden');
          btnSubmitGuess.disabled = false;
          guessStatus.classList.add('hidden');
        } else {
          turnBanner.className = 'text-center mb-6 py-3 px-4 rounded-xl glass-strong';
          turnText.innerHTML = '⏳ Waiting for the opps...';
          btnSubmitGuess.classList.add('hidden');
          guessStatus.classList.add('hidden');
        }
        break;
      }

      case 'turn-change': {
        state.currentTurnId = msg.currentTurnId;
        phaseSetCode.classList.add('hidden');
        waitingCodeOverlay.classList.add('hidden');
        phaseGuessing.classList.remove('hidden');
        guessHistoryContainer.classList.remove('hidden');
        turnBanner.classList.remove('hidden');
        yourCodeDisplay.classList.remove('hidden');
        btnSubmitGuess.classList.remove('hidden');

        if (msg.currentTurnId === state.playerId) {
          turnBanner.className = 'text-center mb-6 py-3 px-4 rounded-xl neon-glow-green';
          turnText.innerHTML = '🎯 Your Turn! Make a guess.';
          btnSubmitGuess.disabled = false;
          guessStatus.classList.add('hidden');
          guessStatus.textContent = '';
        } else {
          turnBanner.className = 'text-center mb-6 py-3 px-4 rounded-xl glass-strong';
          turnText.innerHTML = '⏳ Waiting for the opps...';
          btnSubmitGuess.disabled = true;
          guessStatus.textContent = '';
        }
        break;
      }

      case 'guess-result': {
        addGuessToHistory(msg.guessEntry);
        state.guessHistory = msg.roomState.guessHistory;
        yourCodeDisplay.classList.remove('hidden');

        if (msg.currentTurnId === state.playerId) {
          turnBanner.className = 'text-center mb-6 py-3 px-4 rounded-xl neon-glow-green';
          turnText.innerHTML = '🎯 Your Turn! Make a guess.';
          btnSubmitGuess.disabled = false;
          btnSubmitGuess.classList.remove('hidden');
          guessStatus.classList.add('hidden');

          resetDials(guessDials);
          syncDialDisplay(guessDialsContainer, guessDials);
        } else {
          turnBanner.className = 'text-center mb-6 py-3 px-4 rounded-xl glass-strong';
          turnText.innerHTML = '⏳ Waiting for the opps...';
          btnSubmitGuess.disabled = true;
          guessStatus.classList.add('hidden');
        }
        break;
      }

      case 'game-over': {
        state.gameState = 'finished';
        state.winnerId = msg.winnerId;
        state.guessHistory = msg.roomState.guessHistory;

        phaseSetCode.classList.add('hidden');
        phaseGuessing.classList.add('hidden');
        waitingCodeOverlay.classList.add('hidden');
        turnBanner.classList.add('hidden');
        phaseGameover.classList.remove('hidden');
        btnEmote.classList.add('hidden');
        emoteDisplay.classList.add('hidden');

        const isWinner = msg.winnerId === state.playerId;

        if (isWinner) {
          gameoverIcon.textContent = '🏆';
          gameoverTitle.textContent = 'You Cracked the Code!';
          gameoverTitle.className = 'text-3xl font-bold mb-2 text-green-400';
          gameoverSubtitle.textContent = 'Congratulations! You win!';
        } else {
          gameoverIcon.textContent = '😔';
          gameoverTitle.textContent = 'Your Opponent Cracked the Code!';
          gameoverTitle.className = 'text-3xl font-bold mb-2 text-red-400';
          gameoverSubtitle.textContent = `Their code was ${msg.winnerCode}`;
        }

        gameoverHistory.innerHTML = '';
        msg.roomState.guessHistory.forEach(entry => {
          const el = document.createElement('div');
          const isMyGuess = entry.playerId === state.playerId;
          const playerName = isMyGuess ? 'You' : 'Opponent';
          el.className = `guess-entry ${entry.isWin ? 'win' : ''}`;
          el.innerHTML = `
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-400">${playerName}</span>
              <span class="guess-numbers text-${entry.isWin ? 'green' : 'blue'}-400">${entry.guess}</span>
            </div>
            <div class="text-sm mt-1">
              <span class="text-green-400">● ${entry.correctPosition} correct position${entry.correctPosition !== 1 ? 's' : ''}</span>
              <span class="mx-2 text-gray-600">|</span>
              <span class="text-yellow-400">● ${entry.correctNumberWrongPosition} correct number${entry.correctNumberWrongPosition !== 1 ? 's' : ''} wrong position</span>
              ${entry.isWin ? '<span class="ml-2 text-green-400 font-bold">✓ WINNER!</span>' : ''}
            </div>
          `;
          gameoverHistory.appendChild(el);
        });
        break;
      }

      case 'reset-for-rematch': {
        state.gameState = 'waiting';
        state.ready = msg.roomState.players[state.playerId]?.ready ?? false;
        state.myCodeSubmitted = false;
        state.guessHistory = [];
        state.winnerId = null;
        state.currentTurnId = null;

        if (state.ready) {
          btnReady.textContent = '✅ READY!';
          btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4 opacity-60';
        } else {
          btnReady.textContent = 'READY';
          btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
        }

        btnEmote.classList.add('hidden');
        emoteDisplay.classList.add('hidden');
        phaseGameover.classList.add('hidden');
        showView('view-lobby');

        updateLobbyUI(msg.roomState);
        updateReadyStatus(msg.roomState);
        break;
      }

      case 'receive-emote': {
        emoteDisplayText.textContent = `${msg.playerName} sent: ${msg.emoji}`;
        emoteDisplay.classList.remove('hidden');
        setTimeout(() => emoteDisplay.classList.add('hidden'), 6000);
        break;
      }
    }
  }

  // --- UI Updates ---
  function updateLobbyUI(roomState) {
    if (!roomState) return;

    const players = Object.values(roomState.players);
    const hostPlayer = players.find(p => p.isHost);
    const guestPlayer = players.find(p => !p.isHost);

    if (hostPlayer) {
      inputNameHost.value = hostPlayer.name;
      state.myName = hostPlayer.name;
    }
    inputNameHost.disabled = !state.isHost;
    if (guestPlayer) {
      inputNameGuest.value = guestPlayer.name;
      inputNameGuest.disabled = state.isHost;
      inputNameGuest.placeholder = 'Your Name';
    } else {
      inputNameGuest.value = '';
      inputNameGuest.disabled = true;
      inputNameGuest.placeholder = 'Waiting for opponent...';
    }

    document.querySelectorAll('.player-slot').forEach(slot => {
      const isHost = slot.dataset.slot === 'host';
      const player = isHost ? hostPlayer : guestPlayer;
      const dot = slot.querySelector('.ready-indicator');
      if (player && player.ready) {
        dot.className = 'ready-indicator w-3 h-3 rounded-full bg-green-500 shrink-0 transition-all';
      } else if (player) {
        dot.className = 'ready-indicator w-3 h-3 rounded-full bg-gray-600 shrink-0 transition-all';
      } else {
        dot.className = 'ready-indicator w-3 h-3 rounded-full bg-gray-600 shrink-0 transition-all';
      }
    });

    state.codeLength = roomState.settings.codeLength;
    settingBtns.forEach(btn => {
      const val = parseInt(btn.dataset.value);
      if (val === roomState.settings.codeLength) {
        btn.className = 'setting-btn px-5 py-2 rounded-lg text-sm font-semibold transition-all border-2 border-yellow-400 text-yellow-400 bg-yellow-400/10';
      } else {
        btn.className = 'setting-btn px-5 py-2 rounded-lg text-sm font-semibold transition-all border-2 border-gray-700 text-gray-400 hover:border-gray-500';
      }
    });

    guestOverlay.classList.add('hidden');
    if (state.isHost) {
      settingBtns.forEach(b => { b.disabled = false; b.style.pointerEvents = 'auto'; });
    } else {
      settingBtns.forEach(b => { b.disabled = true; b.style.pointerEvents = 'none'; });
    }
  }

  function updateReadyStatus(roomState) {
    if (!roomState) return;

    const players = Object.values(roomState.players);
    const host = players.find(p => p.isHost);
    const guest = players.find(p => !p.isHost);
    const bothPresent = host && guest;

    if (bothPresent) {
      const hReady = host.ready;
      const gReady = guest.ready;
      const iAmHost = state.isHost;
      if (hReady && gReady) {
        readyStatus.textContent = '✅ Both players ready!';
        readyStatus.className = 'text-center text-sm text-green-400 mt-2';
      } else if ((iAmHost && hReady) || (!iAmHost && gReady)) {
        readyStatus.textContent = '⏳ You are ready. Waiting for opponent...';
        readyStatus.className = 'text-center text-sm text-yellow-400 mt-2';
      } else if ((iAmHost && gReady) || (!iAmHost && hReady)) {
        readyStatus.textContent = '⏳ Opponent is ready! Ready up!';
        readyStatus.className = 'text-center text-sm text-yellow-400 mt-2';
      } else {
        readyStatus.textContent = '';
        readyStatus.className = 'text-center text-sm text-gray-500 mt-2 hidden';
      }
      readyStatus.classList.remove('hidden');
      btnReady.disabled = false;
    } else {
      readyStatus.innerHTML = '⏳ Waiting for an opponent to join...';
      readyStatus.className = 'text-center text-sm text-gray-500 mt-2';
      readyStatus.classList.remove('hidden');
      btnReady.disabled = true;
    }
  }

  // --- UI Event Handlers ---

  // Homepage
  btnPlay.addEventListener('click', () => {
    homeMain.classList.add('hidden');
    homeOptions.classList.remove('hidden');
    homeOptions.classList.add('fade-slide-in');
    inputJoinCode.focus();
  });

  btnCreateRoom.addEventListener('click', async () => {
    btnCreateRoom.disabled = true;
    btnCreateRoom.textContent = 'Creating...';
    try {
      const res = await fetch(`${API_URL}/api/create-room`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to create room');
      const data = await res.json();
      connectWebSocket(data.roomCode, data.playerId);
    } catch (err) {
      joinError.textContent = 'Could not create room. Try again.';
      joinError.classList.remove('hidden');
      setTimeout(() => joinError.classList.add('hidden'), 4000);
      btnCreateRoom.disabled = false;
      btnCreateRoom.textContent = '＋ Create a Room';
    }
  });

  btnJoin.addEventListener('click', async () => {
    const code = inputJoinCode.value.trim().toUpperCase();
    if (code.length !== 4) {
      joinError.textContent = 'Please enter a valid 4-character room code.';
      joinError.classList.remove('hidden');
      setTimeout(() => joinError.classList.add('hidden'), 3000);
      return;
    }
    joinError.classList.add('hidden');
    btnJoin.disabled = true;
    btnJoin.textContent = 'Joining...';
    try {
      const res = await fetch(`${API_URL}/api/join-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        joinError.textContent = data.error || 'Could not join room.';
        joinError.classList.remove('hidden');
        setTimeout(() => joinError.classList.add('hidden'), 4000);
        btnJoin.disabled = false;
        btnJoin.textContent = 'Join';
        return;
      }
      connectWebSocket(data.roomCode, data.playerId);
    } catch (err) {
      joinError.textContent = 'Could not join room. Try again.';
      joinError.classList.remove('hidden');
      setTimeout(() => joinError.classList.add('hidden'), 4000);
      btnJoin.disabled = false;
      btnJoin.textContent = 'Join';
    }
  });

  inputJoinCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });

  inputJoinCode.addEventListener('input', () => {
    inputJoinCode.value = inputJoinCode.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4);
  });

  // Lobby - Name syncing
  inputNameHost.addEventListener('input', () => {
    if (!state.isHost) return;
    const name = inputNameHost.value.trim() || 'Player 1';
    state.myName = name;
    wsSend('update-name', { name });
  });

  inputNameGuest.addEventListener('input', () => {
    if (state.isHost) return;
    const name = inputNameGuest.value.trim() || 'Player 2';
    state.myName = name;
    wsSend('update-name', { name });
  });

  // Settings - Host only
  settingBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.isHost) return;
      const value = parseInt(btn.dataset.value);
      state.codeLength = value;
      wsSend('update-setting', { setting: 'codeLength', value });
    });
  });

  // Ready
  btnReady.addEventListener('click', () => {
    state.ready = !state.ready;
    if (state.ready) {
      btnReady.textContent = '✅ READY!';
      btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4 opacity-60';
    } else {
      btnReady.textContent = 'READY';
      btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
    }
    wsSend('player-ready', { ready: state.ready });
  });

  // Leave room
  btnLobbyLeave.addEventListener('click', () => {
    wsSend('leave-room');
    disconnectAndReset();
  });

  function disconnectAndReset() {
    if (ws) {
      ws.close();
      ws = null;
    }
    clearInterval(reconnectTimer);
    reconnectTimer = null;
    roomCode = null;
    playerId = null;
    resetToHome();
  }

  function resetToHome() {
    state.roomId = null;
    state.playerId = null;
    state.isHost = false;
    state.ready = false;
    state.gameState = 'waiting';
    state.myCodeSubmitted = false;
    state.guessHistory = [];
    state.winnerId = null;

    clearInterval(codeTimer);
    codeTimerEl.classList.add('hidden');

    btnCreateRoom.disabled = false;
    btnCreateRoom.textContent = '＋ Create a Room';
    btnJoin.disabled = false;
    btnJoin.textContent = 'Join';

    homeMain.classList.remove('hidden');
    homeOptions.classList.add('hidden');
    inputJoinCode.value = '';
    joinError.classList.add('hidden');
    btnReady.textContent = 'READY';
    btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
    readyStatus.classList.add('hidden');
    btnEmote.classList.add('hidden');

    showView('view-home');
  }

  // Game - Submit code
  btnSubmitCode.addEventListener('click', () => {
    const code = getDialValues(codeDials);
    mySecretCode = code;
    if (code.length !== state.codeLength) return;
    btnSubmitCode.disabled = true;
    btnSubmitCode.textContent = 'Submitting...';
    wsSend('submit-code', { code });
  });

  // Game - Submit guess
  btnSubmitGuess.addEventListener('click', () => {
    const guess = getDialValues(guessDials);
    if (guess.length !== state.codeLength) return;
    btnSubmitGuess.disabled = true;
    btnSubmitGuess.textContent = 'Submitting Guess...';
    guessStatus.textContent = 'Evaluating...';
    guessStatus.className = 'text-center text-sm text-gray-400 mt-3';
    guessStatus.classList.remove('hidden');
    wsSend('submit-guess', { guess });
  });

  function addGuessToHistory(entry) {
    guessHistoryContainer.classList.remove('hidden');
    const el = document.createElement('div');
    const isMyGuess = entry.playerId === state.playerId;
    const playerName = isMyGuess ? 'You' : 'Opponent';
    el.className = `guess-entry fade-slide-in ${isMyGuess ? 'yours' : ''} ${entry.isWin ? 'win' : ''}`;
    el.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="text-sm text-gray-400">${playerName}</span>
        <span class="guess-numbers text-${entry.isWin ? 'green' : 'blue'}-400">${entry.guess}</span>
      </div>
      <div class="text-sm mt-1 flex items-center gap-1.5 flex-wrap">
        <span class="inline-flex items-center gap-1"><span class="text-green-400">●</span> ${entry.correctPosition} correct position${entry.correctPosition !== 1 ? 's' : ''}</span>
        <span class="text-gray-600">|</span>
        <span class="inline-flex items-center gap-1"><span class="text-yellow-400">●</span> ${entry.correctNumberWrongPosition} correct number${entry.correctNumberWrongPosition !== 1 ? 's' : ''} wrong position</span>
        ${entry.isWin ? '<span class="ml-auto text-green-400 font-bold text-xs">WINNER</span>' : ''}
      </div>
    `;
    guessHistoryEl.appendChild(el);
    guessHistoryEl.scrollTop = guessHistoryEl.scrollHeight;

    if (!entry.isWin) {
      btnSubmitGuess.textContent = 'SUBMIT GUESS';
    }
  }

  // Guess History - Toggle opponent guesses
  let opponentGuessesHidden = false;
  btnToggleOpponentGuesses.addEventListener('click', () => {
    opponentGuessesHidden = !opponentGuessesHidden;
    guessHistoryEl.classList.toggle('hide-opponent', opponentGuessesHidden);
    btnToggleOpponentGuesses.textContent = opponentGuessesHidden ? 'Show Their Guesses' : 'Hide Their Guesses';
    btnToggleOpponentGuesses.classList.toggle('active', opponentGuessesHidden);
  });

  // Exclusion Grid
  document.getElementById('exclusion-grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.exclusion-tile');
    if (tile) tile.classList.toggle('excluded');
  });

  // Emote
  btnEmote.addEventListener('click', () => {
    emotePicker.classList.toggle('hidden');
  });

  btnCloseEmote.addEventListener('click', () => {
    emotePicker.classList.add('hidden');
  });

  emoteOptions.forEach(el => {
    el.addEventListener('click', () => {
      const emoji = el.dataset.emote;
      wsSend('send-emote', { emoji });
      emoteDisplayText.textContent = `Sent: ${emoji}`;
      emoteDisplay.classList.remove('hidden');
      setTimeout(() => emoteDisplay.classList.add('hidden'), 6000);
      emotePicker.classList.add('hidden');
    });
  });

  // Game Over - Play Again
  btnPlayAgain.addEventListener('click', () => {
    wsSend('play-again');
  });

  btnBackLobby.addEventListener('click', () => {
    wsSend('leave-room');
    disconnectAndReset();
  });

  console.log('CodeCracker client loaded (Cloudflare Edition).');
})();
