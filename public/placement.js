/* Word Party - shared placement checks (used by the server for authority and by the browser for live hints).
 * Pure geometry: no dictionary. Works as a CommonJS module (Node) or a browser global (window.Placement). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Placement = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const SIZE = 15, CENTER = 7;

  // Friendly copy for every placement problem. `msg` = full explanation, `short` = the gentle live hint.
  const MESSAGES = {
    NO_TILES: { msg: 'Drag or tap tiles from your rack onto the board first.', short: 'Place some tiles to make a word' },
    TOO_MANY: { msg: 'You can place at most 7 tiles in one turn.', short: 'Too many tiles' },
    OFF_BOARD: { msg: "That tile isn't on the board. Tap Recall and try again.", short: 'A tile is off the board' },
    NOT_YOUR_TILE: { msg: "One of those tiles isn't on your rack any more. Tap Recall and try again.", short: 'Tile not on your rack' },
    SQUARE_TAKEN: { msg: 'That square already has a tile on it. Pick an empty square.', short: 'Square already taken' },
    BLANK_LETTER: { msg: 'Pick a letter for your blank tile (tap it on the board to choose).', short: 'Choose a letter for the blank' },
    NOT_IN_LINE: {
      msg: "All the tiles you place in one turn must be in a single straight line, across OR down. You've placed tiles both across and down. The tiles flashing red are the odd ones out. Move them into line, or tap Recall and play one word at a time.",
      short: 'Tiles must all be in one straight line (across or down). The tiles ringed in orange are out of line.',
    },
    GAP: {
      msg: "There's a gap in your word. Every square between your first and last tile has to be filled, by your tiles or tiles already on the board. Fill the highlighted square, or slide your tiles together.",
      short: "There's a gap between your tiles. Fill the highlighted square.",
    },
    FIRST_CENTER: {
      msg: 'The first word of the game has to cover the ★ star in the middle of the board. Move one of your tiles onto the star.',
      short: 'The first word must cover the ★ star in the middle',
    },
    FIRST_TOO_SHORT: { msg: 'The first word needs at least 2 letters. Add another tile next to it.', short: 'The first word needs at least 2 letters' },
    NOT_CONNECTED: {
      msg: "Your word has to join onto tiles that are already on the board, by touching them or crossing through them. Move your tiles so they connect to an existing word.",
      short: 'Your word needs to touch tiles already on the board',
    },
    TOO_SHORT: { msg: 'A word needs at least 2 letters.', short: 'A word needs at least 2 letters' },
    INVALID_WORDS: { msg: "That word isn't in the dictionary.", short: "That word isn't in the dictionary" },
  };

  const fail = (code, cells = [], mark = 'tiles', extra) =>
    Object.assign({ ok: false, code, error: MESSAGES[code].msg, short: MESSAGES[code].short, cells, mark }, extra);

  function invalidWordsMessage(words) {
    const q = words.map((w) => w.toUpperCase());
    if (q.length === 1) return `${q[0]} isn't in the dictionary.`;
    const list = q.length === 2 ? `${q[0]} and ${q[1]}` : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
    return `${list} aren't in the dictionary.`;
  }

  const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  /**
   * Choose the straight line (a row or a column) that holds the most new tiles; everything else is "odd one out".
   * Ties: prefer the line that touches existing tiles (or the star on move 1), then the line holding the tile placed
   * first (players usually start where they meant to), then across.
   */
  function bestLine(board, tiles, first) {
    const filled = (r, c) => inside(r, c) && !!board[r][c];
    const anchored = (t) => (first ? t.r === CENTER && t.c === CENTER
      : filled(t.r - 1, t.c) || filled(t.r + 1, t.c) || filled(t.r, t.c - 1) || filled(t.r, t.c + 1));
    const cands = [];
    for (const horiz of [true, false]) {
      const groups = new Map();
      tiles.forEach((t, i) => {
        const k = horiz ? t.r : t.c;
        if (!groups.has(k)) groups.set(k, { horiz, index: k, members: [], anchors: 0, firstIdx: i });
        const g = groups.get(k); g.members.push(t); if (anchored(t)) g.anchors++;
      });
      cands.push(...groups.values());
    }
    cands.sort((a, b) => b.members.length - a.members.length || b.anchors - a.anchors || a.firstIdx - b.firstIdx || (b.horiz - a.horiz));
    const best = cands[0];
    const odd = tiles.filter((t) => (best.horiz ? t.r !== best.index : t.c !== best.index));
    return { horiz: best.horiz, index: best.index, odd };
  }

  /**
   * Geometry checks for a set of new tiles.
   * board: 15x15 array, truthy where a tile is already played. tiles: [{r, c}] in the order they were placed.
   * Returns {ok:true, horiz, first} or {ok:false, code, error, short, cells:[[r,c]...], mark:'tiles'|'pulse'|'squares'|'star'|'word'|'none'}.
   */
  function checkPlacement(board, tiles) {
    if (!tiles.length) return fail('NO_TILES', [], 'none');
    const filled = (r, c) => inside(r, c) && !!board[r][c];
    const isNew = new Set(tiles.map((t) => t.r * SIZE + t.c));
    const any = (r, c) => filled(r, c) || isNew.has(r * SIZE + c);
    let first = true;
    for (let r = 0; r < SIZE && first; r++) for (let c = 0; c < SIZE; c++) if (board[r][c]) { first = false; break; }

    const rows = new Set(tiles.map((t) => t.r)), cols = new Set(tiles.map((t) => t.c));
    if (rows.size > 1 && cols.size > 1) {
      const line = bestLine(board, tiles, first);
      return fail('NOT_IN_LINE', line.odd.map((t) => [t.r, t.c]), 'tiles', { line: { horiz: line.horiz, index: line.index } });
    }
    let horiz;
    if (tiles.length > 1) horiz = rows.size === 1;
    else {
      const t = tiles[0];
      const run = (dr, dc) => { let n = 1; for (let r = t.r - dr, c = t.c - dc; any(r, c); r -= dr, c -= dc) n++; for (let r = t.r + dr, c = t.c + dc; any(r, c); r += dr, c += dc) n++; return n; };
      horiz = run(0, 1) >= run(1, 0);
    }
    const [dr, dc] = horiz ? [0, 1] : [1, 0];
    const sorted = tiles.slice().sort((a, b) => (horiz ? a.c - b.c : a.r - b.r));
    const a = sorted[0], z = sorted[sorted.length - 1];
    const gaps = [];
    let throughOld = false;
    for (let r = a.r, c = a.c; r <= z.r && c <= z.c; r += dr, c += dc) {
      if (filled(r, c)) throughOld = true;
      else if (!isNew.has(r * SIZE + c)) gaps.push([r, c]);
    }
    if (first) {
      if (!isNew.has(CENTER * SIZE + CENTER)) return fail('FIRST_CENTER', [[CENTER, CENTER]], 'star');
      if (gaps.length) return fail('GAP', gaps, 'squares');
      if (tiles.length < 2) return fail('FIRST_TOO_SHORT', tiles.map((t) => [t.r, t.c]), 'pulse');
      return { ok: true, horiz, first };
    }
    if (gaps.length) return fail('GAP', gaps, 'squares');
    const touches = throughOld || tiles.some((t) => filled(t.r - 1, t.c) || filled(t.r + 1, t.c) || filled(t.r, t.c - 1) || filled(t.r, t.c + 1));
    if (!touches) return fail('NOT_CONNECTED', tiles.map((t) => [t.r, t.c]), 'pulse');
    return { ok: true, horiz, first };
  }

  return { SIZE, CENTER, MESSAGES, fail, checkPlacement, bestLine, invalidWordsMessage };
});
