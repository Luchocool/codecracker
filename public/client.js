(function () {
  'use strict';

  const socket = io({
    transports: ['polling', 'websocket'],
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 2000,
  });

  let connected = false;

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

    // Ready indicators
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

    // Code length setting
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

  // --- Socket Events ---
  socket.on('connect', () => {
    connected = true;
    btnPlay.disabled = false;
    btnPlay.textContent = '▶ PLAY';
    btnPlay.className = 'btn-base btn-primary w-full text-lg py-4';
    document.getElementById('conn-status')?.remove();
  });

  socket.on('disconnect', () => {
    connected = false;
  });

  socket.on('connect_error', () => {
    btnPlay.disabled = true;
    btnPlay.textContent = '⚠ Connecting...';
    btnPlay.className = 'btn-base btn-ghost w-full text-lg py-4 cursor-wait';
  });

  socket.on('room-created', (data) => {
    state.roomId = data.roomId;
    state.playerId = data.playerId;
    state.isHost = true;
    state.myName = 'Player 1';
    state.opponentName = '';

    roomCodeDisplay.textContent = data.roomId;
    showView('view-lobby');
    updateLobbyUI(data.roomState);
    updateReadyStatus(data.roomState);
  });

  socket.on('room-joined', (data) => {
    state.roomId = data.roomId;
    state.playerId = data.playerId;
    state.isHost = false;
    state.myName = 'Player 2';

    roomCodeDisplay.textContent = data.roomId;
    showView('view-lobby');
    updateLobbyUI(data.roomState);
    updateReadyStatus(data.roomState);
  });

  socket.on('room-error', (data) => {
    joinError.textContent = data.message;
    joinError.classList.remove('hidden');
    setTimeout(() => joinError.classList.add('hidden'), 4000);
  });

  socket.on('player-joined', (data) => {
    updateLobbyUI(data.roomState);
    updateReadyStatus(data.roomState);
  });

  socket.on('player-left', (data) => {
    if (state.gameState !== 'waiting') {
      state.gameState = 'waiting';
      state.ready = false;
      state.myCodeSubmitted = false;
      btnReady.textContent = 'READY';
      btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
      showView('view-lobby');
    }
    updateLobbyUI(data.roomState);
    updateReadyStatus(data.roomState);
  });

  socket.on('host-transferred', (data) => {
    state.isHost = true;
    if (state.gameState !== 'waiting') {
      state.gameState = 'waiting';
      state.ready = false;
      state.myCodeSubmitted = false;
      btnReady.textContent = 'READY';
      btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
      showView('view-lobby');
    }
    updateLobbyUI(data.roomState);
    updateReadyStatus(data.roomState);
  });

  socket.on('name-updated', (data) => {
    // Update opponent's name display
    const players = data.roomState.players;
    for (const id of Object.keys(players)) {
      if (id !== state.playerId) {
        if (players[id].isHost) {
          inputNameHost.value = players[id].name;
        } else {
          inputNameGuest.value = players[id].name;
        }
      }
    }
  });

  socket.on('setting-updated', (data) => {
    updateLobbyUI(data.roomState);
  });

  socket.on('ready-updated', (data) => {
    if (data.playerId === state.playerId) {
      state.ready = data.ready;
    }
    if (data.roomState) {
      updateLobbyUI(data.roomState);
      updateReadyStatus(data.roomState);
    }
  });

  socket.on('game-start', (data) => {
    state.gameState = 'setting-codes';
    state.myCodeSubmitted = false;
    state.guessHistory = [];

    // Reset phase visibility
    phaseSetCode.classList.remove('hidden');
    phaseGuessing.classList.add('hidden');
    phaseGameover.classList.add('hidden');
    waitingCodeOverlay.classList.add('hidden');
    guessHistoryContainer.classList.add('hidden');
    turnBanner.classList.add('hidden');
    btnSubmitGuess.classList.add('hidden');

    // Create code dials
    codeDials = createDials(codeDialsContainer, state.codeLength);
    resetDials(codeDials);
    syncDialDisplay(codeDialsContainer, codeDials);

    btnSubmitCode.disabled = false;
    btnSubmitCode.textContent = 'SUBMIT';
    submitCodeStatus.classList.add('hidden');

    // Code timer
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
        socket.emit('submit-code', { code });
      }
    }, 1000);

    showView('view-game');
  });

  socket.on('code-submitted', (data) => {
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
  });

  socket.on('both-codes-submitted', (data) => {
    state.gameState = 'guessing';
    phaseSetCode.classList.add('hidden');
    waitingCodeOverlay.classList.add('hidden');
    phaseGuessing.classList.remove('hidden');
    guessHistoryContainer.classList.remove('hidden');
    guessHistoryEl.innerHTML = '';
    turnBanner.classList.remove('hidden');
    yourCodeValue.textContent = mySecretCode;
    yourCodeDisplay.classList.remove('hidden');

    // Create guess dials
    guessDials = createDials(guessDialsContainer, state.codeLength);
    resetDials(guessDials);
    syncDialDisplay(guessDialsContainer, guessDials);

    if (data.roomState.currentTurn === state.playerId) {
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
  });

  socket.on('turn-change', (data) => {
    state.currentTurnId = data.currentTurnId;
    phaseSetCode.classList.add('hidden');
    waitingCodeOverlay.classList.add('hidden');
    phaseGuessing.classList.remove('hidden');
    guessHistoryContainer.classList.remove('hidden');
    turnBanner.classList.remove('hidden');
    yourCodeDisplay.classList.remove('hidden');
    btnSubmitGuess.classList.remove('hidden');

    if (data.currentTurnId === state.playerId) {
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
  });

  socket.on('guess-result', (data) => {
    addGuessToHistory(data.guessEntry);
    state.guessHistory = data.roomState.guessHistory;
    yourCodeDisplay.classList.remove('hidden');

    if (data.currentTurnId === state.playerId) {
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
  });

  socket.on('game-over', (data) => {
    state.gameState = 'finished';
    state.winnerId = data.winnerId;
    state.guessHistory = data.roomState.guessHistory;

    phaseSetCode.classList.add('hidden');
    phaseGuessing.classList.add('hidden');
    waitingCodeOverlay.classList.add('hidden');
    turnBanner.classList.add('hidden');
    phaseGameover.classList.remove('hidden');

    const isWinner = data.winnerId === state.playerId;

    if (isWinner) {
      gameoverIcon.textContent = '🏆';
      gameoverTitle.textContent = 'You Cracked the Code!';
      gameoverTitle.className = 'text-3xl font-bold mb-2 text-green-400';
      gameoverSubtitle.textContent = 'Congratulations! You win!';
    } else {
      gameoverIcon.textContent = '😔';
      gameoverTitle.textContent = 'Your Opponent Cracked the Code!';
      gameoverTitle.className = 'text-3xl font-bold mb-2 text-red-400';
      gameoverSubtitle.textContent = 'Better luck next time!';
    }

    // Show full history in game over
    gameoverHistory.innerHTML = '';
    data.roomState.guessHistory.forEach(entry => {
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
  });

  socket.on('reset-for-rematch', (data) => {
    state.gameState = 'waiting';
    state.ready = data.roomState.players[state.playerId]?.ready ?? false;
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

    phaseGameover.classList.add('hidden');
    showView('view-lobby');

    updateLobbyUI(data.roomState);
    updateReadyStatus(data.roomState);
  });

  // --- UI Event Handlers ---

  // Homepage
  btnPlay.addEventListener('click', () => {
    homeMain.classList.add('hidden');
    homeOptions.classList.remove('hidden');
    homeOptions.classList.add('fade-slide-in');
    inputJoinCode.focus();
  });

  btnCreateRoom.addEventListener('click', () => {
    if (!connected) {
      joinError.textContent = 'Not connected to server. Please wait...';
      joinError.classList.remove('hidden');
      setTimeout(() => joinError.classList.add('hidden'), 3000);
      return;
    }
    socket.emit('create-room');
  });

  btnJoin.addEventListener('click', () => {
    const code = inputJoinCode.value.trim().toUpperCase();
    if (code.length !== 4) {
      joinError.textContent = 'Please enter a valid 4-character room code.';
      joinError.classList.remove('hidden');
      setTimeout(() => joinError.classList.add('hidden'), 3000);
      return;
    }
    if (!connected) {
      joinError.textContent = 'Not connected to server. Please wait...';
      joinError.classList.remove('hidden');
      setTimeout(() => joinError.classList.add('hidden'), 3000);
      return;
    }
    joinError.classList.add('hidden');
    socket.emit('join-room', { roomId: code, name: 'Player 2' });
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
    socket.emit('update-name', { name });
  });

  inputNameGuest.addEventListener('input', () => {
    if (state.isHost) return;
    const name = inputNameGuest.value.trim() || 'Player 2';
    state.myName = name;
    socket.emit('update-name', { name });
  });

  // Settings - Host only
  settingBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.isHost) return;
      const value = parseInt(btn.dataset.value);
      state.codeLength = value;
      socket.emit('update-setting', { setting: 'codeLength', value });
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
    socket.emit('player-ready', { ready: state.ready });
  });

  // Leave room
  btnLobbyLeave.addEventListener('click', () => {
    socket.emit('leave-room');
    resetToHome();
  });

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

    homeMain.classList.remove('hidden');
    homeOptions.classList.add('hidden');
    inputJoinCode.value = '';
    joinError.classList.add('hidden');
    btnReady.textContent = 'READY';
    btnReady.className = 'btn-base btn-success w-full text-lg mt-6 py-4';
    readyStatus.classList.add('hidden');

    showView('view-home');
  }

  // Game - Submit code
  btnSubmitCode.addEventListener('click', () => {
    const code = getDialValues(codeDials);
    mySecretCode = code;
    if (code.length !== state.codeLength) return;
    btnSubmitCode.disabled = true;
    btnSubmitCode.textContent = 'Submitting...';
    socket.emit('submit-code', { code });
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
    socket.emit('submit-guess', { guess });
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

    // Reset guess dials after submitting
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

  // Exclusion Grid - Toggle number tiles
  document.getElementById('exclusion-grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.exclusion-tile');
    if (tile) tile.classList.toggle('excluded');
  });

  // Game Over - Play Again
  btnPlayAgain.addEventListener('click', () => {
    socket.emit('play-again');
  });

  btnBackLobby.addEventListener('click', () => {
    socket.emit('leave-room');
    resetToHome();
  });

  console.log('CodeCracker client loaded.');
})();
