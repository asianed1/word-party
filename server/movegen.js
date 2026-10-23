'use strict';
// Move generator for bots and hints: anchor-based search over the dictionary trie with cross-checks.
const { SIZE, CENTER, RACK_SIZE, VALUES, boardEmpty, evaluateMove } = require('./rules');
const ALL = (1 << 26) - 1;

function crossMasks(board, dict, horiz) {
  // for each empty cell, letters allowed by the perpendicular word (dr,dc = perpendicular direction)
  const [dr, dc] = horiz ? [1, 0] : [0, 1];
  const masks = Array.from({ length: SIZE }, () => new Array(SIZE).fill(ALL));
  const get = (r, c) => (r >= 0 && r < SIZE && c >= 0 && c < SIZE ? board[r][c] : null);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c]) { masks[r][c] = 0; continue; }
    if (!get(r - dr, c - dc) && !get(r + dr, c + dc)) continue;
    let pre = '', suf = '';
    for (let rr = r - dr, cc = c - dc; get(rr, cc); rr -= dr, cc -= dc) pre = get(rr, cc).letter + pre;
    for (let rr = r + dr, cc = c + dc; get(rr, cc); rr += dr, cc += dc) suf += get(rr, cc).letter;
    let m = 0;
    const pn = dict.walk(pre);
    if (pn !== -1) for (let k = dict.first[pn]; k !== -1; k = dict.next[k]) {
      const sn = dict.walk(suf, k);
      if (sn !== -1 && dict.term[sn]) m |= 1 << dict.ch[k];
    }
    masks[r][c] = m;
  }
  return masks;
}

/** Generate legal moves. Returns array of {placements, score, words}. Options: limit (max candidates kept, sorted). */
function generateMoves(board, rack, dict, { limit = 20 } = {}) {
  const empty = boardEmpty(board);
  const anchor = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
  if (empty) anchor[CENTER][CENTER] = true;
  else for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (board[r][c]) continue;
    anchor[r][c] = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => r + a >= 0 && r + a < SIZE && c + b >= 0 && c + b < SIZE && board[r + a][c + b]);
  }
  const counts = new Map();
  for (const t of rack) { if (!counts.has(t.letter)) counts.set(t.letter, []); counts.get(t.letter).push(t.id); }
  const found = new Map();
  for (const horiz of [true, false]) {
    const masks = crossMasks(board, dict, horiz);
    const cell = (line, i) => (horiz ? board[line][i] : board[i][line]);
    const isAnchor = (line, i) => (horiz ? anchor[line][i] : anchor[i][line]);
    const mask = (line, i) => (horiz ? masks[line][i] : masks[i][line]);
    const pos = (line, i) => (horiz ? [line, i] : [i, line]);
    for (let line = 0; line < SIZE; line++) {
      for (let s = 0; s < SIZE; s++) {
        if (s > 0 && cell(line, s - 1)) continue;
        // only start if an anchor is reachable using at most RACK_SIZE new tiles
        let ok = false;
        for (let i = s, e = 0; i < SIZE && e <= RACK_SIZE; i++) { if (!cell(line, i)) { if (isAnchor(line, i)) { ok = true; break; } e++; } else if (!empty) { ok = true; break; } }
        if (!ok) continue;
        const placed = [];
        const dfs = (i, node, touched) => {
          const cur = i < SIZE ? cell(line, i) : null;
          if (!cur && placed.length && touched && i - s >= 2 && dict.term[node]) {
            const key = placed.map((p) => `${p.r},${p.c},${p.letter}${p.isBlank ? '*' : ''}`).sort().join('|');
            if (!found.has(key)) found.set(key, placed.map((p) => ({ id: p.id, r: p.r, c: p.c, ...(p.isBlank ? { letter: p.letter } : {}) })));
          }
          if (i >= SIZE) return;
          if (cur) {
            const k = dict.child(node, cur.letter.charCodeAt(0) - 65);
            if (k !== -1) dfs(i + 1, k, true);
            return;
          }
          if (placed.length >= rack.length) return;
          const m = mask(line, i), [r, c] = pos(line, i), anc = touched || isAnchor(line, i);
          for (let k = dict.first[node]; k !== -1; k = dict.next[k]) {
            const L = dict.ch[k];
            if (!(m & (1 << L))) continue;
            const letter = String.fromCharCode(65 + L);
            const ids = counts.get(letter);
            if (ids && ids.length) {
              const id = ids.pop(); placed.push({ id, r, c, letter });
              dfs(i + 1, k, anc);
              placed.pop(); ids.push(id);
            }
            const bl = counts.get('?');
            if (bl && bl.length) {
              const id = bl.pop(); placed.push({ id, r, c, letter, isBlank: true });
              dfs(i + 1, k, anc);
              placed.pop(); bl.push(id);
            }
          }
        };
        dfs(s, 0, false);
      }
    }
  }
  const moves = [];
  for (const placements of found.values()) {
    const ev = evaluateMove(board, rack, placements, dict, { checkWords: false });
    if (ev.ok) moves.push({ placements, score: ev.score, words: ev.words, blanks: placements.filter((p) => p.letter).length });
  }
  moves.sort((a, b) => b.score - a.score);
  return limit ? moves.slice(0, limit) : moves;
}

/** Greedy choice: best score, but don't burn a blank for less than +20 points over the best blank-free move. */
function bestMove(board, rack, dict) {
  const moves = generateMoves(board, rack, dict, { limit: 200 });
  if (!moves.length) return null;
  const best = moves[0], noBlank = moves.find((m) => m.blanks === 0);
  if (best.blanks && noBlank && best.score - noBlank.score < 20) return noBlank;
  return best;
}

/** Tiles a bot would swap: awkward letters and duplicates. */
function exchangeChoice(rack) {
  const keep = new Set(); const out = [];
  for (const t of rack) {
    const good = '?ESARTINLO'.includes(t.letter) && !keep.has(t.letter);
    if (good) keep.add(t.letter); else out.push(t.id);
  }
  return out.length ? out : rack.map((t) => t.id);
}

module.exports = { generateMoves, bestMove, exchangeChoice, crossMasks };
