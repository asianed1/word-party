'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, MAX_SCORELESS } = require('../server/game');
const R = require('../server/rules');
const MG = require('../server/movegen');
const dict = require('../server/dict');

const D = dict.load();
const seats = (n, bot = false) => [0, 1, 2, 3].map((i) => (i < n ? { name: `P${i + 1}`, isBot: bot } : null));
const mk = (s, opts = {}) => new Game(s, Object.assign({ dict: D, botDelay: 0 }, opts));

test('deal: 7 tiles each, bag has the rest, empty seats skipped in turn order', () => {
  const g = mk([{ name: 'A' }, null, { name: 'C' }, null]);
  g.start();
  assert.deepEqual(g.order, [0, 2]);
  assert.equal(g.players[0].rack.length, 7); assert.equal(g.players[2].rack.length, 7);
  assert.equal(g.bag.length, 86);
  const t = g.turn; g.pass(t);
  assert.equal(g.turn, t === 0 ? 2 : 0);
  assert.equal(g.viewFor(0).players[1], null);
  // a player's view never contains other racks
  const v = g.viewFor(0);
  assert.equal(JSON.stringify(v).includes('"rack":[') && v.rack.length, 7);
  assert.ok(!('rack' in v.players[2]));
  g.destroy();
});

test('needs 2-4 players', () => {
  assert.throws(() => mk(seats(1)));
  assert.doesNotThrow(() => mk(seats(2)).destroy());
});

test('play updates board, score, rack and turn; out-of-turn rejected', () => {
  const g = mk(seats(2)); g.start(); g.turn = 0;
  g.players[0].rack = [{ id: 1, letter: 'C' }, { id: 2, letter: 'A' }, { id: 3, letter: 'T' }, { id: 4, letter: 'E' }, { id: 5, letter: 'E' }, { id: 6, letter: 'E' }, { id: 7, letter: 'E' }];
  assert.match(g.play(1, [{ id: 1, r: 7, c: 7 }]).error, /turn/);
  const bad = g.play(0, [{ id: 1, r: 7, c: 7 }, { id: 3, r: 7, c: 8 }]);
  assert.equal(bad.ok, false); assert.deepEqual(bad.invalid, ['CT']);
  const ok = g.play(0, [{ id: 1, r: 7, c: 6 }, { id: 2, r: 7, c: 7 }, { id: 3, r: 7, c: 8 }]);
  assert.equal(ok.ok, true);
  assert.equal(g.players[0].score, 10);
  assert.equal(g.players[0].rack.length, 7);
  assert.equal(g.board[7][7].letter, 'A');
  assert.equal(g.turn, 1);
  assert.deepEqual(g.lastMove.cells, [[7, 6], [7, 7], [7, 8]]);
  g.destroy();
});

test('preview scores without changing state; hint returns a legal move', () => {
  const g = mk(seats(2)); g.start(); g.turn = 0;
  g.players[0].rack = [{ id: 1, letter: 'Q' }, { id: 2, letter: 'U' }, { id: 3, letter: 'I' }, { id: 4, letter: 'Z' }, { id: 5, letter: 'E' }, { id: 6, letter: 'S' }, { id: 7, letter: 'T' }];
  const p = g.preview(0, [{ id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 8 }, { id: 3, r: 7, c: 9 }, { id: 4, r: 7, c: 10 }]);
  assert.equal(p.preview.valid, true); assert.equal(p.preview.score, 2 * (10 + 1 + 1 + 10));
  assert.equal(g.board[7][7], null); assert.equal(g.players[0].score, 0);
  const h = g.hint(0);
  assert.ok(h.hint && h.hint.score > 0);
  assert.equal(g.preview(0, h.hint.placements).preview.score, h.hint.score);
  g.destroy();
});

test('exchange: only with 7+ in bag, keeps rack size, counts as scoreless', () => {
  const g = mk(seats(2)); g.start(); g.turn = 0;
  const before = g.players[0].rack.map((t) => t.id);
  assert.equal(g.exchange(0, [before[0], before[0]]).ok, false);
  assert.equal(g.exchange(0, [999]).ok, false);
  assert.equal(g.exchange(0, before.slice(0, 3)).ok, true);
  assert.equal(g.players[0].rack.length, 7); assert.equal(g.bag.length, 86); assert.equal(g.scoreless, 1);
  g.turn = 1; g.bag = g.bag.slice(0, 6);
  assert.match(g.exchange(1, [g.players[1].rack[0].id]).error, /7 or more/);
  g.destroy();
});

test('end game: going out collects opponents\' rack values', () => {
  const g = mk(seats(3)); g.start(); g.turn = 0;
  for (const [r, c, l] of [[7, 6, 'C'], [7, 7, 'A'], [7, 8, 'T']]) g.board[r][c] = { letter: l, blank: false };
  g.bag = [];
  g.players[0].rack = [{ id: 1, letter: 'S' }]; g.players[0].score = 50;
  g.players[1].rack = [{ id: 2, letter: 'Q' }, { id: 3, letter: '?' }]; g.players[1].score = 60; // 10
  g.players[2].rack = [{ id: 4, letter: 'X' }, { id: 5, letter: 'E' }]; g.players[2].score = 40; // 9
  let over = null; g.on('gameOver', (r) => { over = r; });
  assert.equal(g.play(0, [{ id: 1, r: 7, c: 9 }]).ok, true);
  assert.equal(g.phase, 'over');
  assert.equal(over.reason, 'out'); assert.equal(over.outSeat, 0);
  assert.deepEqual(over.adjust, { 0: 19, 1: -10, 2: -9 });
  assert.deepEqual(over.scores, { 0: 50 + 6 + 19, 1: 50, 2: 31 });
  assert.deepEqual(over.winners, [0]);
  assert.equal(g.play(1, [{ id: 2, r: 0, c: 0 }]).ok, false);
});

test(`end game: ${MAX_SCORELESS} scoreless turns in a row, everyone subtracts their own rack`, () => {
  const g = mk(seats(2)); g.start(); g.turn = 0;
  g.players[0].rack = [{ id: 1, letter: 'Z' }]; g.players[1].rack = [{ id: 2, letter: 'A' }, { id: 3, letter: 'B' }];
  for (let i = 0; i < MAX_SCORELESS - 1; i++) { g.pass(g.turn); assert.equal(g.phase, 'play'); }
  g.pass(g.turn);
  assert.equal(g.phase, 'over');
  assert.equal(g.result.reason, 'scoreless');
  assert.deepEqual(g.result.adjust, { 0: -10, 1: -4 });
  assert.deepEqual(g.result.winners, [1]);
});

test('a scoring play resets the scoreless counter', () => {
  const g = mk(seats(2)); g.start(); g.turn = 0;
  g.pass(0); g.pass(1); g.pass(0); assert.equal(g.scoreless, 3);
  g.players[1].rack = [{ id: 1, letter: 'A' }, { id: 2, letter: 'T' }];
  g.play(1, [{ id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 8 }]);
  assert.equal(g.scoreless, 0);
  g.destroy();
});

test('turn timer auto-passes; away players are skipped after a grace period', async () => {
  const g = mk(seats(2), { turnTime: 40, awayGrace: 30 }); g.start();
  const first = g.turn;
  await new Promise((r) => setTimeout(r, 70));
  assert.notEqual(g.turn, first);
  assert.ok(g.scoreless >= 1);
  g.destroy();
  const g2 = mk(seats(2), { awayGrace: 30 }); g2.start();
  const t = g2.turn; g2.setAway(t, true);
  await new Promise((r) => setTimeout(r, 60));
  assert.notEqual(g2.turn, t);
  g2.destroy();
});

test('move generator: every generated move is legal and fully valid', () => {
  const g = mk(seats(2)); g.start();
  for (let k = 0; k < 6; k++) {
    const p = g.players[g.turn];
    const moves = MG.generateMoves(g.board, p.rack, D, { limit: 0 });
    for (const m of moves.slice(0, 300)) {
      const ev = R.evaluateMove(g.board, p.rack, m.placements, D);
      assert.equal(ev.ok, true, JSON.stringify(m) + ev.error);
      assert.equal(ev.score, m.score);
    }
    const best = MG.bestMove(g.board, p.rack, D);
    if (best) g.play(g.turn, best.placements); else g.pass(g.turn);
  }
  g.destroy();
});

test('headless simulation: several full 4-bot games finish with consistent totals', async () => {
  const GAMES = 6;
  for (let n = 0; n < GAMES; n++) {
    const players = n % 3 === 0 ? 4 : n % 3 === 1 ? 3 : 2;
    const g = mk(seats(players, true));
    const errors = [];
    g.on('error', (e) => errors.push(e));
    let moves = 0, playScore = 0;
    g.on('event', (e) => { if (e.type === 'play') { moves++; playScore += e.score; } });
    const done = new Promise((resolve) => g.on('gameOver', resolve));
    g.start();
    const res = await done;
    assert.deepEqual(errors, []);
    assert.ok(moves >= 5, `only ${moves} plays`);
    // final total = sum of play scores + net end-game adjustments
    const total = Object.values(res.scores).reduce((a, b) => a + b, 0);
    const adj = Object.values(res.adjust).reduce((a, b) => a + b, 0);
    assert.equal(total, playScore + adj);
    if (res.reason === 'out') { assert.equal(adj, 0); assert.equal(g.bag.length, 0); assert.equal(g.players[res.outSeat].rack.length, 0); }
    // tile conservation: board + racks + bag = 100
    const onBoard = g.board.flat().filter(Boolean).length;
    const inRacks = g.order.reduce((s, i) => s + g.players[i].rack.length, 0);
    assert.equal(onBoard + inRacks + g.bag.length, 100);
    // every word on the board (rows and columns, length >= 2) is in the dictionary
    for (let r = 0; r < 15; r++) for (const dir of [[0, 1], [1, 0]]) {
      const line = Array.from({ length: 15 }, (_, i) => { const x = dir[0] ? g.board[i][r] : g.board[r][i]; return x ? x.letter : ' '; }).join('');
      for (const w of line.split(/\s+/)) if (w.length >= 2) assert.ok(D.has(w), `board word ${w}`);
    }
    g.destroy();
  }
});
