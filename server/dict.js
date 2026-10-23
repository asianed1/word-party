'use strict';
// Compact tries over the word lists, stored in typed arrays (first child / next sibling linked lists).
//   common (default): data/common-words.txt - everyday English from SCOWL size 55 ∩ ENABLE (~66k words, ~1.5 MB)
//   expert (opt-in):  data/enable1.txt + data/common-add.txt (~173k words, ~5 MB), loaded lazily on first use
// Slurs in data/blocked-words.txt are never accepted in either list.
const fs = require('fs');
const path = require('path');

class Trie {
  constructor(cap = 1 << 19) {
    this.first = new Int32Array(cap).fill(-1);
    this.next = new Int32Array(cap).fill(-1);
    this.ch = new Uint8Array(cap);
    this.term = new Uint8Array(cap);
    this.size = 1; // node 0 = root
    this.count = 0;
  }
  grow() {
    const n = this.first.length * 2;
    const g = (A, fill) => { const b = new A.constructor(n); if (fill !== undefined) b.fill(fill); b.set(A); return b; };
    this.first = g(this.first, -1); this.next = g(this.next, -1); this.ch = g(this.ch); this.term = g(this.term);
  }
  child(node, c) {
    for (let k = this.first[node]; k !== -1; k = this.next[k]) if (this.ch[k] === c) return k;
    return -1;
  }
  insert(word) {
    let node = 0;
    for (let i = 0; i < word.length; i++) {
      const c = word.charCodeAt(i) - 65;
      let k = this.child(node, c);
      if (k === -1) {
        if (this.size >= this.first.length) this.grow();
        k = this.size++; this.ch[k] = c; this.next[k] = this.first[node]; this.first[node] = k;
      }
      node = k;
    }
    if (!this.term[node]) { this.term[node] = 1; this.count++; }
  }
  /** node index for a prefix (uppercase A-Z), or -1 */
  walk(word, node = 0) {
    for (let i = 0; i < word.length && node !== -1; i++) node = this.child(node, word.charCodeAt(i) - 65);
    return node;
  }
  has(word) {
    if (typeof word !== 'string' || !/^[A-Z]{2,15}$/.test(word)) return false;
    const n = this.walk(word); return n !== -1 && this.term[n] === 1;
  }
}

const DATA = path.join(__dirname, '..', 'data');
const LISTS = {
  common: ['common-words.txt'],
  expert: ['enable1.txt', 'common-add.txt'],
};
const readList = (file) => fs.readFileSync(path.join(DATA, file), 'utf8').split('\n')
  .map((l) => l.trim().toUpperCase()).filter((w) => w && !w.startsWith('#'));
let blocked = null;
const cache = new Map();

/** Load (once) and return the trie for 'common' (default) or 'expert'. */
function load(kind = 'common') {
  if (!Object.hasOwn(LISTS, kind)) throw new Error('unknown word list: ' + kind);
  if (cache.has(kind)) return cache.get(kind);
  if (!blocked) blocked = new Set(readList('blocked-words.txt'));
  const t = new Trie(kind === 'common' ? 1 << 18 : 1 << 19);
  for (const file of LISTS[kind]) {
    for (const w of readList(file)) if (w.length >= 2 && w.length <= 15 && /^[A-Z]+$/.test(w) && !blocked.has(w) && !t.has(w)) t.insert(w);
  }
  t.kind = kind;
  cache.set(kind, t); return t;
}

function fromWords(words) { const t = new Trie(1024); words.forEach((w) => t.insert(w.toUpperCase())); return t; }

module.exports = { Trie, load, fromWords };
