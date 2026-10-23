'use strict';
// Chat helpers: validation, sanitising, profanity filter, rate limiting. Nothing is ever written to disk.
const MAX_LEN = 300;
const WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'bastard', 'dick', 'pussy', 'slut', 'whore', 'wanker', 'bollocks',
  'prick', 'twat', 'motherfucker', 'nigger', 'faggot', 'retard', 'kanina', 'chibai', 'cheebye', 'lanjiao', 'nabei'];
const PROFANITY_RE = new RegExp(`\\b(${WORDS.join('|')})\\w*`, 'gi');

/** Strip control / bidi-override chars, collapse whitespace, trim. Returns null if invalid. */
function cleanText(raw, max = MAX_LEN) {
  if (typeof raw !== 'string') return null;
  let s = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || [...s].length > max) return null;
  return s;
}

function filterProfanity(s) { return s.replace(PROFANITY_RE, (m) => m[0] + '*'.repeat(m.length - 1)); }

/** Sliding window limiter: max `n` events per `ms`. */
class RateLimiter {
  constructor(n, ms) { this.n = n; this.ms = ms; this.hits = []; }
  allow(now = Date.now()) {
    this.hits = this.hits.filter((t) => now - t < this.ms);
    if (this.hits.length >= this.n) return false;
    this.hits.push(now); return true;
  }
}

module.exports = { cleanText, filterProfanity, RateLimiter, MAX_LEN };
