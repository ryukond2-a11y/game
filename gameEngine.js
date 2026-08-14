// gameEngine.js
// Server-authoritative game logic for the card game "Speed" (2 players).
// House rules used here (documented in README.md):
//  - 52 card deck, no jokers. Rank runs A(1)-K(13), Ace is ONLY low
//    for adjacency EXCEPT the special K-A wrap (13 <-> 1) which is allowed,
//    matching the common "circular" Speed rule.
//  - Each player: 5 card hand + 20 card stock + 1 starter card (goes to a
//    center pile). 26 cards per player, 52 total.
//  - Hand is refilled from stock immediately after a play, up to 5 cards,
//    as long as stock remains.
//  - If a player has no legal move, they call "stuck". When BOTH players
//    are simultaneously stuck, each center pile is refreshed by its
//    owning player's stock (top card placed face-up on that pile). If a
//    pile's owner has no stock left, that pile cannot be refreshed.
//  - If both piles cannot be refreshed while both players are stuck, the
//    game ends: whoever holds fewer total cards (hand+stock) wins; equal
//    counts is a draw.
//  - A player wins instantly when their hand AND stock are both empty.

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = [1,2,3,4,5,6,7,8,9,10,11,12,13]; // A,2..10,J,Q,K

function buildDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (const r of RANKS) {
      deck.push({ id: `${s}${r}`, suit: s, rank: r });
    }
  }
  return deck;
}

// Fisher-Yates using crypto-strength randomness where available.
function shuffle(deck) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isAdjacent(rankA, rankB) {
  const diff = Math.abs(rankA - rankB);
  return diff === 1 || diff === 12; // 12 covers the K(13)-A(1) wrap
}

function createGame() {
  const deck = shuffle(buildDeck());
  const p1cards = deck.slice(0, 26);
  const p2cards = deck.slice(26, 52);

  const makePlayer = (cards) => ({
    hand: cards.slice(0, 5),
    starter: cards[5],
    stock: cards.slice(6, 26),
    stuck: false,
  });

  const p1 = makePlayer(p1cards);
  const p2 = makePlayer(p2cards);

  return {
    players: { p1, p2 },
    piles: [ [p1.starter], [p2.starter] ], // pile 0 owned by p1, pile 1 owned by p2
    pileOwner: ['p1', 'p2'],
    status: 'playing', // 'playing' | 'over'
    winner: null,       // 'p1' | 'p2' | 'draw' | null
    lastEvent: null,
  };
}

function opponentOf(pid) {
  return pid === 'p1' ? 'p2' : 'p1';
}

function pileTop(game, pileIndex) {
  const pile = game.piles[pileIndex];
  return pile[pile.length - 1];
}

function refillHand(player) {
  while (player.hand.length < 5 && player.stock.length > 0) {
    player.hand.push(player.stock.shift());
  }
}

function hasLegalMove(game, pid) {
  const player = game.players[pid];
  for (const card of player.hand) {
    for (let i = 0; i < game.piles.length; i++) {
      if (isAdjacent(card.rank, pileTop(game, i).rank)) return true;
    }
  }
  return false;
}

function checkWin(game) {
  for (const pid of ['p1', 'p2']) {
    const pl = game.players[pid];
    if (pl.hand.length === 0 && pl.stock.length === 0) {
      game.status = 'over';
      game.winner = pid;
      return true;
    }
  }
  return false;
}

// Attempt to play `cardId` from `pid`'s hand onto pile `pileIndex`.
// Returns { ok: true } or { ok: false, reason }
function playCard(game, pid, cardId, pileIndex) {
  if (game.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (pileIndex !== 0 && pileIndex !== 1) return { ok: false, reason: 'bad_pile' };

  const player = game.players[pid];
  const idx = player.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return { ok: false, reason: 'card_not_in_hand' };

  const card = player.hand[idx];
  const top = pileTop(game, pileIndex);
  if (!isAdjacent(card.rank, top.rank)) return { ok: false, reason: 'not_adjacent' };

  // Commit the move
  player.hand.splice(idx, 1);
  game.piles[pileIndex].push(card);
  refillHand(player);

  // Playing unblocks things, so clear stuck flags to force re-evaluation.
  game.players.p1.stuck = false;
  game.players.p2.stuck = false;

  game.lastEvent = { type: 'play', pid, cardId, pileIndex };

  checkWin(game);
  return { ok: true };
}

// Mark a player as stuck (client believes it has no legal move).
// Server double-checks. If both are stuck at once, resolve a "spit".
function markStuck(game, pid) {
  if (game.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (hasLegalMove(game, pid)) {
    return { ok: false, reason: 'has_legal_move' };
  }
  game.players[pid].stuck = true;

  const other = opponentOf(pid);
  if (game.players[other].stuck) {
    return resolveSpit(game);
  }
  return { ok: true, waiting: true };
}

function resolveSpit(game) {
  let refreshedAny = false;
  for (let i = 0; i < game.piles.length; i++) {
    const ownerId = game.pileOwner[i];
    const owner = game.players[ownerId];
    if (owner.stock.length > 0) {
      const card = owner.stock.shift();
      game.piles[i].push(card);
      refreshedAny = true;
    }
  }
  game.players.p1.stuck = false;
  game.players.p2.stuck = false;

  if (!refreshedAny) {
    // Stalemate: decide by total remaining cards.
    const p1Total = game.players.p1.hand.length + game.players.p1.stock.length;
    const p2Total = game.players.p2.hand.length + game.players.p2.stock.length;
    game.status = 'over';
    if (p1Total < p2Total) game.winner = 'p1';
    else if (p2Total < p1Total) game.winner = 'p2';
    else game.winner = 'draw';
    game.lastEvent = { type: 'stalemate' };
    return { ok: true, spit: true, stalemate: true };
  }

  game.lastEvent = { type: 'spit' };
  checkWin(game);
  return { ok: true, spit: true };
}

// Build the state as visible to a given player (hides opponent's hand
// contents, only reveals counts).
function viewFor(game, pid) {
  const me = game.players[pid];
  const oppId = opponentOf(pid);
  const opp = game.players[oppId];
  return {
    you: {
      hand: me.hand,
      stockCount: me.stock.length,
      stuck: me.stuck,
    },
    opponent: {
      handCount: opp.hand.length,
      stockCount: opp.stock.length,
      stuck: opp.stuck,
    },
    piles: game.piles.map((p) => p[p.length - 1]),
    pileCounts: game.piles.map((p) => p.length),
    status: game.status,
    winner: game.winner,
    lastEvent: game.lastEvent,
  };
}

module.exports = {
  createGame,
  playCard,
  markStuck,
  viewFor,
  hasLegalMove,
  isAdjacent,
  opponentOf,
};
