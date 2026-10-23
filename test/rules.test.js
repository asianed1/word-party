'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../server/rules');
const { fromWords, load } = require('../server/dict');

const DICT = fromWords(['CAT', 'CATS', 'AA', 'AX', 'TX', 'RETAINS', 'HELLO', 'TO', 'AT', 'QI', 'ZA']);
const rackOf = (letters) => letters.split('').map((l, i) => ({ id: i, letter: l }));
const place = (board, word, r, c, horiz = true) => { word.split('').forEach((l, i) => { board[horiz ? r : r + i][horiz ? c + i : c] = { letter: l, blank: false }; }); return board; };
const move = (rack, specs) => specs.map(([letter, r, c, blankAs]) => { const t = rack.find((x) => x.letter === letter && !x.used); t.used = true; return blankAs ? { id: t.id, r, c, letter: blankAs } : { id: t.id, r, c }; });

test('bag: 100 tiles, standard distribution, 2 blanks, unique ids', () => {
  const bag = R.makeBag();
  assert.equal(bag.length, 100);
  assert.equal(new Set(bag.map((t) => t.id)).size, 100);
  const counts = {}; bag.forEach((t) => { counts[t.letter] = (counts[t.letter] || 0) + 1; });
  assert.deepEqual(counts, R.DIST);
  assert.equal(counts['?'], 2); assert.equal(counts.E, 12); assert.equal(counts.A, 9); assert.equal(counts.Z, 1);
  assert.equal(bag.reduce((s, t) => s + R.VALUES[t.letter], 0), 187);
  // shuffled (vanishingly unlikely to equal the sorted order)
  assert.notDeepEqual(bag.map((t) => t.id), [...Array(100).keys()]);
});

test('premium layout: 8 TW, 17 DW (incl. centre), 12 TL, 24 DL, symmetric', () => {
  const flat = R.PREMIUM.flat();
  assert.equal(flat.filter((x) => x === 'TW').length, 8);
  assert.equal(flat.filter((x) => x === 'DW').length, 17);
  assert.equal(flat.filter((x) => x === 'TL').length, 12);
  assert.equal(flat.filter((x) => x === 'DL').length, 24);
  assert.equal(R.PREMIUM[7][7], 'DW'); assert.equal(R.PREMIUM[0][0], 'TW'); assert.equal(R.PREMIUM[0][3], 'DL'); assert.equal(R.PREMIUM[1][5], 'TL');
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) assert.equal(R.PREMIUM[r][c], R.PREMIUM[c][r]);
});

test('placement validation', () => {
  const empty = R.emptyBoard();
  const rk = rackOf('CATSXAE');
  const code = (b, p) => R.evaluateMove(b, rk, p, DICT).code;
  assert.equal(code(empty, []), 'NO_TILES');
  assert.equal(code(empty, [{ id: 0, r: 7, c: 7 }]), 'FIRST_TOO_SHORT');
  assert.equal(code(empty, [{ id: 0, r: 0, c: 0 }, { id: 1, r: 0, c: 1 }, { id: 2, r: 0, c: 2 }]), 'FIRST_CENTER');
  assert.equal(code(empty, [{ id: 0, r: 7, c: 7 }, { id: 1, r: 8, c: 8 }]), 'NOT_IN_LINE');
  assert.equal(code(empty, [{ id: 0, r: 7, c: 6 }, { id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 9 }]), 'GAP');
  assert.equal(code(empty, [{ id: 0, r: 7, c: 7 }, { id: 0, r: 7, c: 8 }]), 'NOT_YOUR_TILE');
  assert.equal(code(empty, [{ id: 42, r: 7, c: 7 }, { id: 1, r: 7, c: 8 }]), 'NOT_YOUR_TILE');
  assert.equal(code(empty, [{ id: 0, r: 7, c: 7 }, { id: 1, r: 7, c: 7 }]), 'SQUARE_TAKEN');
  assert.equal(code(empty, [{ id: 0, r: 7, c: 15 }, { id: 1, r: 7, c: 14 }]), 'OFF_BOARD');
  const b = place(R.emptyBoard(), 'CAT', 7, 6);
  assert.equal(code(b, [{ id: 0, r: 7, c: 7 }, { id: 1, r: 8, c: 7 }]), 'SQUARE_TAKEN');
  assert.equal(code(b, [{ id: 1, r: 0, c: 0 }, { id: 2, r: 0, c: 1 }]), 'NOT_CONNECTED');
  assert.equal(code(b, [{ id: 1, r: 0, c: 0 }]), 'NOT_CONNECTED');
  // gap filled by an existing tile is fine: S _ (existing) ... use CATS extension
  const ok = R.evaluateMove(b, rk, [{ id: 3, r: 7, c: 9 }], DICT);
  assert.equal(ok.ok, true); assert.equal(ok.words[0].word, 'CATS');
  // bridging over existing tiles: C _ _ _ placed at both ends -> contiguity through board tiles
  const b2 = place(R.emptyBoard(), 'AT', 7, 7);
  const bridge = R.evaluateMove(b2, rk, [{ id: 0, r: 7, c: 6 }, { id: 3, r: 7, c: 9 }], DICT);
  assert.equal(bridge.ok, true); assert.equal(bridge.words[0].word, 'CATS');
  // blank must have a chosen letter
  const br = [{ id: 0, letter: '?' }, { id: 1, letter: 'A' }, { id: 2, letter: 'T' }];
  assert.equal(R.evaluateMove(R.emptyBoard(), br, [{ id: 0, r: 7, c: 6 }, { id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 8 }], DICT).code, 'BLANK_LETTER');
});

test('invalid words are reported by name', () => {
  const rk = rackOf('DOGXQZ');
  const r = R.evaluateMove(R.emptyBoard(), rk, [{ id: 0, r: 7, c: 7 }, { id: 1, r: 7, c: 8 }, { id: 2, r: 7, c: 9 }], DICT);
  assert.equal(r.ok, false); assert.deepEqual(r.invalid, ['DOG']); assert.match(r.error, /DOG/);
  // cross-word invalid while main word valid
  const b = place(R.emptyBoard(), 'CAT', 7, 6);
  const rk2 = rackOf('AXQ');
  const r2 = R.evaluateMove(b, rk2, [{ id: 0, r: 8, c: 7 }, { id: 2, r: 8, c: 8 }], DICT); // AQ main, AA + TQ cross
  assert.equal(r2.ok, false); assert.deepEqual(r2.invalid.sort(), ['AQ', 'TQ']);
});

test('scoring: centre double word, letter premiums, only new tiles get premiums', () => {
  const rk = rackOf('CATHELO');
  // CAT across the centre star: (3+1+1) x2
  const cat = R.evaluateMove(R.emptyBoard(), rk, [{ id: 0, r: 7, c: 6 }, { id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 8 }], DICT);
  assert.equal(cat.score, 10);
  // HELLO from (7,3) DL on H, centre DW on O: (4*2 + 1+1+1+1) x2 = 24
  const rk2 = rackOf('HELLO');
  const hello = R.evaluateMove(R.emptyBoard(), rk2, move(rk2, [['H', 7, 3], ['E', 7, 4], ['L', 7, 5], ['L', 7, 6], ['O', 7, 7]]), DICT);
  assert.equal(hello.score, 24);
  // extending CAT -> CATS doesn't re-use the centre premium
  const b = place(R.emptyBoard(), 'CAT', 7, 6);
  assert.equal(R.evaluateMove(b, rackOf('S'), [{ id: 0, r: 7, c: 9 }], DICT).score, 6);
});

test('scoring: cross-words count, premium applies to each word through the square', () => {
  const b = place(R.emptyBoard(), 'CAT', 7, 6);
  const rk = rackOf('AX');
  // AX at (8,7),(8,8). (8,8) is a double letter. Main AX = 1 + 16 = 17; cross AA = 2; cross TX = 1 + 16 = 17
  const r = R.evaluateMove(b, rk, [{ id: 0, r: 8, c: 7 }, { id: 1, r: 8, c: 8 }], DICT);
  assert.equal(r.ok, true);
  assert.deepEqual(r.words.map((w) => [w.word, w.score]).sort(), [['AA', 2], ['AX', 17], ['TX', 17]]);
  assert.equal(r.score, 36);
  // triple word on (0,7): a word ending there is tripled
  const b2 = R.emptyBoard(); place(b2, 'T', 1, 7);
  const r2 = R.evaluateMove(b2, rackOf('A'), [{ id: 0, r: 0, c: 7 }], DICT);
  assert.equal(r2.words[0].word, 'AT'); assert.equal(r2.score, (1 + 1) * 3);
  // triple letter on (5,5) with a Z: ZA down from (5,5) => Z*3 + A = 31
  const b3 = R.emptyBoard(); place(b3, 'A', 6, 5);
  assert.equal(R.evaluateMove(b3, rackOf('Z'), [{ id: 0, r: 5, c: 5 }], DICT).score, 31);
});

test('scoring: blanks score zero, bingo adds 50', () => {
  const rk = [{ id: 0, letter: '?' }, { id: 1, letter: 'A' }, { id: 2, letter: 'T' }];
  const r = R.evaluateMove(R.emptyBoard(), rk, [{ id: 0, r: 7, c: 6, letter: 'C' }, { id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 8 }], DICT);
  assert.equal(r.ok, true); assert.equal(r.score, 4); assert.equal(r.tiles[0].blank, true); assert.equal(r.tiles[0].letter, 'C');
  // existing blank on board still scores 0 in later words
  const b = R.emptyBoard(); b[7][6] = { letter: 'C', blank: true }; place(b, 'AT', 7, 7);
  assert.equal(R.evaluateMove(b, rackOf('S'), [{ id: 0, r: 7, c: 9 }], DICT).score, 3);
  // bingo: RETAINS from (7,1) to (7,7): T on DL (7,3), S on centre DW: (1+1+2+1+1+1+1) x2 + 50 = 66
  const rk2 = rackOf('RETAINS');
  const bingo = R.evaluateMove(R.emptyBoard(), rk2, rk2.map((t, i) => ({ id: t.id, r: 7, c: 1 + i })), DICT);
  assert.equal(bingo.bingo, true); assert.equal(bingo.score, 66);
});

test('ENABLE dictionary loads and checks words', () => {
  const d = load();
  for (const w of ['QI', 'ZA', 'AA', 'QUIZ', 'RETAINS', 'JUKEBOX', 'XYST']) assert.ok(d.has(w), w);
  for (const w of ['QQ', 'ASDF', 'A', '', 'HELLOWORLD', 'cat1']) assert.equal(d.has(w), false, w);
  assert.ok(d.count > 160000);
});
