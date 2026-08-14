// game.js
(() => {
  if (!Api.requireAuthOrRedirect()) return;

  const roomCode = sessionStorage.getItem('speed_room_code');
  if (!roomCode) {
    window.location.href = '/lobby.html';
    return;
  }

  const socket = Api.getSocket();
  let myPid = null;
  let selectedCardId = null;
  let lastEventKey = null;
  let gameEnded = false;

  const el = {
    roomChip: document.getElementById('room-code-chip'),
    p1Name: document.getElementById('p1-name'),
    p2Name: document.getElementById('p2-name'),
    oppStock: document.getElementById('opp-stock'),
    oppHand: document.getElementById('opp-hand'),
    myStock: document.getElementById('my-stock'),
    myHand: document.getElementById('my-hand'),
    pile0: document.getElementById('pile-0'),
    pile1: document.getElementById('pile-1'),
    pile0Wrap: document.getElementById('pile-0-wrap'),
    pile1Wrap: document.getElementById('pile-1-wrap'),
    pile0Count: document.getElementById('pile-0-count'),
    pile1Count: document.getElementById('pile-1-count'),
    stuckBtn: document.getElementById('stuck-btn'),
    statusLine: document.getElementById('status-line'),
    spitFlash: document.getElementById('spit-flash'),
    overlay: document.getElementById('result-overlay'),
    resultTitle: document.getElementById('result-title'),
    resultSub: document.getElementById('result-sub'),
  };

  el.roomChip.textContent = `部屋 ${roomCode}`;

  const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_COLOR = { S: 'black', H: 'red', D: 'red', C: 'black' };
  function rankLabel(r) {
    if (r === 1) return 'A';
    if (r === 11) return 'J';
    if (r === 12) return 'Q';
    if (r === 13) return 'K';
    return String(r);
  }
  function isAdjacent(a, b) {
    const diff = Math.abs(a - b);
    return diff === 1 || diff === 12;
  }

  function cardEl(card, { faceUp = true, playable = false } = {}) {
    const div = document.createElement('div');
    div.className = 'card' + (faceUp ? ' ' + SUIT_COLOR[card.suit] : ' back');
    if (playable) div.classList.add('playable');
    if (faceUp) {
      div.innerHTML = `<div>${rankLabel(card.rank)}</div><div class="card-suit">${SUIT_SYMBOL[card.suit]}</div>`;
    }
    return div;
  }

  function setStatus(text) {
    el.statusLine.textContent = text;
  }

  function renderState(state) {
    window.__lastState = state;
    // Names / turn strip already static from room info fetched at rejoin time.

    // Stocks
    el.oppStock.textContent = state.opponent.stockCount;
    el.myStock.textContent = state.you.stockCount;

    // Opponent hand (face down)
    el.oppHand.innerHTML = '';
    for (let i = 0; i < state.opponent.handCount; i++) {
      el.oppHand.appendChild(cardEl(null, { faceUp: false }));
    }

    // Piles
    const tops = state.piles;
    el.pile0.className = 'card ' + SUIT_COLOR[tops[0].suit];
    el.pile0.innerHTML = `<div>${rankLabel(tops[0].rank)}</div><div class="card-suit">${SUIT_SYMBOL[tops[0].suit]}</div>`;
    el.pile1.className = 'card ' + SUIT_COLOR[tops[1].suit];
    el.pile1.innerHTML = `<div>${rankLabel(tops[1].rank)}</div><div class="card-suit">${SUIT_SYMBOL[tops[1].suit]}</div>`;
    el.pile0Count.textContent = `${state.pileCounts[0]}枚`;
    el.pile1Count.textContent = `${state.pileCounts[1]}枚`;

    // My hand
    el.myHand.innerHTML = '';
    state.you.hand.forEach((card) => {
      const playable = isAdjacent(card.rank, tops[0].rank) || isAdjacent(card.rank, tops[1].rank);
      const c = cardEl(card, { faceUp: true, playable });
      if (card.id === selectedCardId) c.style.transform = 'translateY(-10px)';
      c.addEventListener('click', () => onCardClick(card, playable));
      el.myHand.appendChild(c);
    });

    // Stuck button state
    if (state.status === 'playing') {
      if (state.you.stuck && !state.opponent.stuck) {
        el.stuckBtn.classList.add('armed');
        setStatus('相手が手詰まりを宣言するのを待っています…');
      } else if (state.you.stuck && state.opponent.stuck) {
        el.stuckBtn.classList.remove('armed');
      } else {
        el.stuckBtn.classList.remove('armed');
        if (!selectedCardId) setStatus('');
      }
    }

    // Spit / play flash based on lastEvent
    const key = state.lastEvent ? JSON.stringify(state.lastEvent) + '|' + state.pileCounts.join(',') : null;
    if (key && key !== lastEventKey) {
      lastEventKey = key;
      if (state.lastEvent.type === 'spit') triggerSpitFlash();
      if (state.lastEvent.type === 'play') triggerPileFlash(state.lastEvent.pileIndex);
    }

    if (state.status === 'over' && !gameEnded) {
      gameEnded = true;
      showResult(state.winner, state.lastEvent);
    }
  }

  function onCardClick(card, playable) {
    if (!playable) {
      setStatus('そのカードは今出せません。');
      return;
    }
    if (selectedCardId === card.id) {
      selectedCardId = null;
      setStatus('');
      return;
    }
    selectedCardId = card.id;

    const tops = window.__lastState ? window.__lastState.piles : null;
    if (!tops) return;
    const canPile0 = isAdjacent(card.rank, tops[0].rank);
    const canPile1 = isAdjacent(card.rank, tops[1].rank);
    if (canPile0 && !canPile1) {
      submitPlay(card.id, 0);
    } else if (canPile1 && !canPile0) {
      submitPlay(card.id, 1);
    } else {
      setStatus('どちらの山に出しますか？山をクリックしてください。');
    }
  }

  function submitPlay(cardId, pileIndex) {
    selectedCardId = null;
    socket.emit('game:play', { cardId, pileIndex }, (res) => {
      if (!res.ok) {
        setStatus('その手は出せませんでした。');
      }
    });
  }

  [ [el.pile0Wrap, 0], [el.pile1Wrap, 1] ].forEach(([wrap, idx]) => {
    wrap.addEventListener('click', () => {
      if (!selectedCardId) return;
      submitPlay(selectedCardId, idx);
    });
  });

  el.stuckBtn.addEventListener('click', () => {
    socket.emit('game:stuck', {}, (res) => {
      if (!res.ok && res.reason === 'has_legal_move') {
        setStatus('まだ出せるカードがあります。');
      }
    });
  });

  function triggerPileFlash(pileIndex) {
    const wrap = pileIndex === 0 ? el.pile0Wrap : el.pile1Wrap;
    wrap.classList.remove('flash');
    void wrap.offsetWidth;
    wrap.classList.add('flash');
  }

  function triggerSpitFlash() {
    el.spitFlash.classList.remove('show');
    void el.spitFlash.offsetWidth;
    el.spitFlash.classList.add('show');
    setStatus('スピット!両方の山が更新されました。');
  }

  function showResult(winner, lastEvent) {
    let title, sub, cls;
    if (winner === 'draw') {
      title = 'DRAW'; cls = 'draw'; sub = '引き分けでした。';
    } else if (winner === myPid) {
      title = 'YOU WIN'; cls = 'win'; sub = '勝利!お見事です。';
    } else {
      title = 'YOU LOSE'; cls = 'lose'; sub = '次はきっと勝てます。';
    }
    if (lastEvent && lastEvent.type === 'opponent_left') {
      sub = '相手が退出したため対戦が終了しました。';
    }
    el.resultTitle.textContent = title;
    el.resultTitle.className = 'result-title ' + cls;
    el.resultSub.textContent = sub;
    el.overlay.classList.add('show');
  }

  document.getElementById('back-lobby-btn').addEventListener('click', goToLobby);
  document.getElementById('leave-game-btn').addEventListener('click', goToLobby);

  function goToLobby() {
    socket.emit('room:leave');
    sessionStorage.removeItem('speed_room_code');
    window.location.href = '/lobby.html';
  }

  socket.on('game:state', renderState);

  socket.emit('room:rejoin', { code: roomCode }, (res) => {
    if (!res.ok) {
      alert('部屋に再接続できませんでした。ロビーに戻ります。');
      window.location.href = '/lobby.html';
      return;
    }
    myPid = res.you;
    const players = res.room.players;
    el.p1Name.textContent = players[0] || '-';
    el.p2Name.textContent = players[1] || '-';
    if (myPid === 'p1') {
      el.p1Name.textContent += ' (あなた)';
    } else if (myPid === 'p2') {
      el.p2Name.textContent += ' (あなた)';
    }
  });

  socket.on('connect_error', () => {
    setStatus('サーバーとの接続に問題が発生しました。');
  });
})();
