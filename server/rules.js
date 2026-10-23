'use strict';
const crypto = require('crypto');
const P = require('../public/placement.js');

const SIZE = 15, CENTER = 7, RACK_SIZE = 7, BINGO = 50;
const DIST = { A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, '?': 2 };
const VALUES = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0 };

// Premium squares (standard layout, symmetric). Codes: TW, DW, TL, DL.
const PREMIUM = (() => {
  const g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
  const sym = (r, c, v) => { for (const [a, b] of [[r, c], [c, r], [SIZE - 1 - r, c], [r, SIZE - 1 - c], [SIZE - 1 - r, SIZE - 1 - c], [c, SIZE - 1 - r], [SIZE - 1 - c, r], [SIZE - 1 - c, SIZE - 1 - r]]) g[a][b] = v; };
  [[0, 0], [0, 7]].forEach(([r, c]) => sym(r, c, 'TW'));
  [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]].forEach(([r, c]) => sym(r, c, 'DW'));
  [[1, 5], [5, 5]].forEach(([r, c]) => sym(r, c, 'TL'));
  [[0, 3], [2, 6], [3, 7], [6, 6]].forEach(([r, c]) => sym(r, c, 'DL'));
  return g;
})();

/** 100 tiles with unique ids; letter '?' = blank. */
function makeBag(randInt = (n) => crypto.randomInt(n)) {
  const bag = []; let id = 0;
  for (const [l, n] of Object.entries(DIST)) for (let k = 0; k < n; k++) bag.push({ id: id++, letter: l });
  for (let i = bag.length - 1; i > 0; i--) { const j = randInt(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  return bag;
}

const emptyBoard = () => Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
const boardEmpty = (b) => b.every((row) => row.every((x) => !x));
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
const rackValue = (rack) => rack.reduce((s, t) => s + VALUES[t.letter], 0);

/**
 * Validate a placement and compute score.
 * board: 15x15 of null | {letter, blank}
 * rack: [{id, letter}] ; placements: [{id, r, c, letter?}] (letter required for blanks)
 * dict: object with has(word)
 * Returns {ok:true, score, words:[{word, score, cells}], tiles:[{r,c,letter,blank,id}], bingo}
 *      or {ok:false, code, error, short, cells:[[r,c]], mark, invalid?:[words]} (see public/placement.js for codes)
 */
function evaluateMove(board, rack, placements, dict, { checkWords = true } = {}) {
  if (!Array.isArray(placements) || placements.length === 0) return P.fail('NO_TILES', [], 'none');
  if (placements.length > RACK_SIZE) return P.fail('TOO_MANY', [], 'none');
  const byId = new Map(rack.map((t) => [t.id, t]));
  const used = new Set(), cells = new Set(), tiles = [];
  for (const p of placements) {
    if (!p || !Number.isInteger(p.r) || !Number.isInteger(p.c) || !inside(p.r, p.c)) return P.fail('OFF_BOARD', [], 'none');
    const t = byId.get(p.id);
    if (!t || used.has(p.id)) return P.fail('NOT_YOUR_TILE', [], 'none');
    used.add(p.id);
    const key = p.r * SIZE + p.c;
    if (board[p.r][p.c] || cells.has(key)) return P.fail('SQUARE_TAKEN', [[p.r, p.c]], 'tiles');
    cells.add(key);
    let letter = t.letter, blank = false;
    if (letter === '?') {
      if (typeof p.letter !== 'string' || !/^[A-Z]$/.test(p.letter)) return P.fail('BLANK_LETTER', [[p.r, p.c]], 'tiles');
      letter = p.letter; blank = true;
    }
    tiles.push({ r: p.r, c: p.c, letter, blank, id: p.id });
  }
  const geo = P.checkPlacement(board, tiles);
  if (!geo.ok) return geo;
  const first = geo.first;
  const at = (r, c) => {
    if (!inside(r, c)) return null;
    if (board[r][c]) return { letter: board[r][c].letter, blank: board[r][c].blank, isNew: false };
    const t = tiles.find((x) => x.r === r && x.c === c);
    return t ? { letter: t.letter, blank: t.blank, isNew: true } : null;
  };
  const wordAt = (r, c, dr, dc) => {
    while (at(r - dr, c - dc)) { r -= dr; c -= dc; }
    const out = [];
    while (at(r, c)) { out.push({ r, c, ...at(r, c) }); r += dr; c += dc; }
    return out;
  };
  const horiz = geo.horiz;
  const [dr, dc] = horiz ? [0, 1] : [1, 0];
  const a = tiles.slice().sort((x, y) => (horiz ? x.c - y.c : x.r - y.r))[0];
  const words = [];
  const main = wordAt(a.r, a.c, dr, dc);
  if (main.length >= 2) words.push(main);
  for (const t of tiles) { const cw = wordAt(t.r, t.c, dc, dr); if (cw.length >= 2) words.push(cw); }
  if (!words.length) return P.fail('TOO_SHORT', tiles.map((t) => [t.r, t.c]), 'pulse');
  if (!first && !words.some((w) => w.some((x) => !x.isNew))) return P.fail('NOT_CONNECTED', tiles.map((t) => [t.r, t.c]), 'pulse');
  const scored = words.map((w) => {
    let sum = 0, mult = 1;
    for (const x of w) {
      let v = x.blank ? 0 : VALUES[x.letter];
      if (x.isNew) {
        const p = PREMIUM[x.r][x.c];
        if (p === 'DL') v *= 2; else if (p === 'TL') v *= 3; else if (p === 'DW') mult *= 2; else if (p === 'TW') mult *= 3;
      }
      sum += v;
    }
    return { word: w.map((x) => x.letter).join(''), score: sum * mult, cells: w.map((x) => [x.r, x.c]) };
  });
  if (checkWords) {
    const bad = scored.filter((w) => !dict.has(w.word));
    if (bad.length) {
      const invalid = bad.map((w) => w.word);
      const badCells = []; const seen = new Set();
      for (const w of bad) for (const [r, c] of w.cells) if (!seen.has(r * SIZE + c)) { seen.add(r * SIZE + c); badCells.push([r, c]); }
      return P.fail('INVALID_WORDS', badCells, 'word', { error: P.invalidWordsMessage(invalid), short: P.invalidWordsMessage(invalid), invalid, words: scored });
    }
  }
  const bingo = tiles.length === RACK_SIZE;
  const score = scored.reduce((s, w) => s + w.score, 0) + (bingo ? BINGO : 0);
  return { ok: true, score, words: scored, tiles, bingo };
}

module.exports = { SIZE, CENTER, RACK_SIZE, BINGO, DIST, VALUES, PREMIUM, makeBag, emptyBoard, boardEmpty, inside, rackValue, evaluateMove };
