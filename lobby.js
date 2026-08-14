// lobby.js
(() => {
  if (!Api.requireAuthOrRedirect()) return;

  document.getElementById('me-name').textContent = Api.getUsername();
  document.getElementById('logout-btn').addEventListener('click', () => {
    Api.clearSession();
    window.location.href = '/index.html';
  });

  Api.request('/api/me').then((me) => {
    document.getElementById('me-record').textContent = `${me.wins}勝 ${me.losses}敗`;
  }).catch(() => {});

  const socket = Api.getSocket();

  const roomPanel = document.getElementById('room-panel');
  const roomCodeLabel = document.getElementById('room-code-label');
  const roomCodeBig = document.getElementById('room-code-big');
  const slotP1 = document.getElementById('slot-p1');
  const slotP2 = document.getElementById('slot-p2');
  const waitingRow = document.getElementById('waiting-row');
  const startBtn = document.getElementById('start-game-btn');
  const errorBox = document.getElementById('lobby-error');

  let currentCode = null;
  let isHost = false;

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.add('show');
  }

  function renderRoom(room) {
    roomCodeLabel.textContent = room.code;
    roomCodeBig.textContent = room.code;
    roomPanel.style.display = 'block';

    slotP1.textContent = room.players[0] || '-';
    slotP1.classList.remove('empty');

    if (room.players[1]) {
      slotP2.textContent = room.players[1];
      slotP2.classList.remove('empty');
      waitingRow.style.display = 'none';
    } else {
      slotP2.textContent = '相手を待っています';
      slotP2.classList.add('empty');
      waitingRow.style.display = 'flex';
    }

    startBtn.style.display = (isHost && room.players.length === 2 && !room.started) ? 'block' : 'none';
  }

  document.getElementById('create-room-btn').addEventListener('click', () => {
    socket.emit('room:create', {}, (res) => {
      if (!res.ok) return showError('部屋の作成に失敗しました。');
      currentCode = res.room.code;
      isHost = true;
      sessionStorage.setItem('speed_room_code', currentCode);
      renderRoom(res.room);
    });
  });

  document.getElementById('join-room-btn').addEventListener('click', () => {
    const code = document.getElementById('join-code-input').value.trim().toUpperCase();
    if (!code) return showError('部屋コードを入力してください。');
    socket.emit('room:join', { code }, (res) => {
      if (!res.ok) {
        const messages = {
          not_found: 'その部屋コードは見つかりませんでした。',
          full: 'その部屋はすでに満員です。',
          already_in_room: 'すでにこの部屋に入っています。',
        };
        return showError(messages[res.reason] || '入室に失敗しました。');
      }
      currentCode = res.room.code;
      isHost = res.you === 'p1';
      sessionStorage.setItem('speed_room_code', currentCode);
      renderRoom(res.room);
    });
  });

  document.getElementById('start-game-btn').addEventListener('click', () => {
    socket.emit('game:start', {}, (res) => {
      if (!res.ok) showError('対戦を開始できませんでした。');
    });
  });

  document.getElementById('leave-room-btn').addEventListener('click', () => {
    socket.emit('room:leave');
    currentCode = null;
    roomPanel.style.display = 'none';
    sessionStorage.removeItem('speed_room_code');
  });

  socket.on('room:update', (room) => {
    if (!currentCode || room.code !== currentCode) return;
    renderRoom(room);
  });

  socket.on('game:started', () => {
    window.location.href = '/game.html';
  });

  socket.on('connect_error', () => {
    showError('サーバーへの接続に失敗しました。再読み込みしてください。');
  });
})();
