'use strict';
// Compact trie over the ENABLE word list (public domain), stored in typed arrays.
// Node layout: first child / next sibling linked lists. ~390k nodes ≈ 4 MB.
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

let cached = null;
const DATA = path.join(__dirname, '..', 'data');
// enable1.txt = the public-domain ENABLE list; extra-words.txt = a few common modern 2-letter words ENABLE lacks (QI, ZA, ...)
function load(files = [path.join(DATA, 'enable1.txt'), path.join(DATA, 'extra-words.txt')]) {
  if (cached) return cached;
  const t = new Trie();
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const w = line.trim().toUpperCase();
      if (w.length >= 2 && w.length <= 15 && /^[A-Z]+$/.test(w) && !t.has(w)) t.insert(w);
    }
  }
  cached = t; return t;
}

function fromWords(words) { const t = new Trie(1024); words.forEach((w) => t.insert(w.toUpperCase())); return t; }

module.exports = { Trie, load, fromWords };
