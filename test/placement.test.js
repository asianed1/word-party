'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../server/rules');
const P = require('../public/placement.js');
const { fromWords } = require('../server/dict');

const DICT = fromWords(['CAT', 'CATS', 'OS', 'STEE', 'TEE', 'TO', 'AT']);
const place = (board, word, r, c, horiz = true) => { word.split('').forEach((l, i) => { board[horiz ? r : r + i][horiz ? c + i : c] = { letter: l, blank: false }; }); return board; };
const sortCells = (cells) => cells.map(([r, c]) => `${r},${c}`).sort();

// The reported case: blank-as-O and S across, then T, E, E down (an L-shape).
const lRack = [{ id: 0, letter: '?' }, { id: 1, letter: 'S' }, { id: 2, letter: 'T' }, { id: 3, letter: 'E' }, { id: 4, letter: 'E' }];

test('L-shape sharing a corner: the lone across tile is the odd one out', () => {
  const ev = R.evaluateMove(R.emptyBoard(), lRack, [
    { id: 0, r: 7, c: 6, letter: 'O' }, { id: 1, r: 7, c: 7 }, { id: 2, r: 8, c: 7 }, { id: 3, r: 9, c: 7 }, { id: 4, r: 10, c: 7 },
  ], DICT);
  assert.equal(ev.ok, false);
  assert.equal(ev.code, 'NOT_IN_LINE');
  assert.equal(ev.mark, 'tiles');
  assert.deepEqual(ev.cells, [[7, 6]]);                // column 7 holds S,T,E,E (4) vs row 7 O,S (2)
  assert.deepEqual(ev.line, { horiz: false, index: 7 });
  assert.match(ev.error, /single straight line, across OR down/);
  assert.match(ev.error, /Recall/);
  assert.doesNotMatch(ev.error, /one row or one column/);
});

test('L-shape without a shared corner: both across tiles are odd ones out', () => {
  const ev = R.evaluateMove(R.emptyBoard(), lRack, [
    { id: 0, r: 7, c: 6, letter: 'O' }, { id: 1, r: 7, c: 7 }, { id: 2, r: 8, c: 8 }, { id: 3, r: 9, c: 8 }, { id: 4, r: 10, c: 8 },
  ], DICT);
  assert.equal(ev.code, 'NOT_IN_LINE');
  assert.deepEqual(sortCells(ev.cells), ['7,6', '7,7']);
});

test('ties: the line touching existing tiles wins, then the first-placed tile, then across', () => {
  const b = place(R.emptyBoard(), 'CAT', 7, 6);
  // two tiles across in row 3 (floating) and two down in column 9 touching T at (7,8)
  const tiles = [{ r: 3, c: 1 }, { r: 3, c: 2 }, { r: 8, c: 9 }, { r: 7, c: 9 }];
  const ev = P.checkPlacement(b, tiles);
  assert.equal(ev.code, 'NOT_IN_LINE');
  assert.deepEqual(sortCells(ev.cells), ['3,1', '3,2']);
  // no anchors either way: the line holding the first-placed tile wins
  const e2 = P.checkPlacement(b, [{ r: 1, c: 12 }, { r: 2, c: 12 }, { r: 12, c: 1 }, { r: 12, c: 2 }]);
  assert.deepEqual(sortCells(e2.cells), ['12,1', '12,2']);
  // fully symmetric (diagonal pair): across wins, so the second tile is odd
  const e3 = P.checkPlacement(R.emptyBoard(), [{ r: 7, c: 7 }, { r: 8, c: 8 }]);
  assert.deepEqual(e3.cells, [[8, 8]]);
});

test('gaps: the empty squares between the tiles are returned', () => {
  const ev = R.evaluateMove(R.emptyBoard(), lRack, [{ id: 1, r: 7, c: 5 }, { id: 2, r: 7, c: 7 }, { id: 3, r: 7, c: 9 }], DICT);
  assert.equal(ev.code, 'GAP'); assert.equal(ev.mark, 'squares');
  assert.deepEqual(ev.cells, [[7, 6], [7, 8]]);
  assert.match(ev.error, /gap/);
  // a gap bridged by an existing tile is not a gap
  const b = place(R.emptyBoard(), 'A', 7, 7);
  assert.equal(P.checkPlacement(b, [{ r: 7, c: 6 }, { r: 7, c: 8 }]).ok, true);
  const g2 = P.checkPlacement(b, [{ r: 7, c: 6 }, { r: 7, c: 9 }]);
  assert.equal(g2.code, 'GAP'); assert.deepEqual(g2.cells, [[7, 8]]);
});

test('first move off the star points at the star', () => {
  const ev = R.evaluateMove(R.emptyBoard(), lRack, [{ id: 1, r: 3, c: 3 }, { id: 2, r: 3, c: 4 }], DICT);
  assert.equal(ev.code, 'FIRST_CENTER'); assert.equal(ev.mark, 'star'); assert.deepEqual(ev.cells, [[7, 7]]);
  assert.match(ev.error, /★ star/);
});

test('not connected: all placed tiles are flagged', () => {
  const b = place(R.emptyBoard(), 'CAT', 7, 6);
  const ev = R.evaluateMove(b, lRack, [{ id: 2, r: 1, c: 1 }, { id: 3, r: 1, c: 2 }], DICT);
  assert.equal(ev.code, 'NOT_CONNECTED'); assert.equal(ev.mark, 'pulse');
  assert.deepEqual(ev.cells, [[1, 1], [1, 2]]);
  assert.match(ev.error, /join onto tiles that are already on the board/);
});

test('invalid words: each is named and its squares are returned', () => {
  const rk = [{ id: 0, letter: 'Z' }, { id: 1, letter: 'O' }, { id: 2, letter: 'R' }, { id: 3, letter: 'P' }];
  const ev = R.evaluateMove(R.emptyBoard(), rk, [{ id: 0, r: 7, c: 7 }, { id: 1, r: 7, c: 8 }, { id: 2, r: 7, c: 9 }, { id: 3, r: 7, c: 10 }], DICT);
  assert.equal(ev.code, 'INVALID_WORDS'); assert.deepEqual(ev.invalid, ['ZORP']);
  assert.equal(ev.error, "ZORP isn't in the dictionary.");
  assert.deepEqual(ev.cells, [[7, 7], [7, 8], [7, 9], [7, 10]]);
  assert.equal(P.invalidWordsMessage(['AQ', 'TQ']), "AQ and TQ aren't in the dictionary.");
  assert.equal(P.invalidWordsMessage(['AQ', 'TQ', 'XX']), "AQ, TQ and XX aren't in the dictionary.");
});

test('every error code has a friendly full and short message', () => {
  for (const [code, m] of Object.entries(P.MESSAGES)) {
    assert.ok(m.msg.length > 20, code); assert.ok(m.short.length > 10, code);
  }
});
