'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, filterProfanity, RateLimiter } = require('../server/chat');
const { parseMessage } = require('../server/rooms');

test('chat text validation', () => {
  assert.equal(cleanText('  hello   world '), 'hello world');
  assert.equal(cleanText(''), null);
  assert.equal(cleanText('x'.repeat(301)), null);
  assert.equal(cleanText('x'.repeat(300)).length, 300);
  assert.equal(cleanText(42), null);
  assert.equal(cleanText('a\u202eb\u0000c'), 'a b c');
  assert.equal(cleanText('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>'); // literal text; client uses textContent
});

test('profanity filter', () => {
  assert.equal(filterProfanity('what the fuck'), 'what the f***');
  assert.equal(filterProfanity('class assessment scunthorpe'), 'class assessment scunthorpe');
});

test('rate limiter: 5 per 5s', () => {
  const r = new RateLimiter(5, 5000);
  for (let i = 0; i < 5; i++) assert.ok(r.allow(1000 + i));
  assert.equal(r.allow(1010), false);
  assert.ok(r.allow(6001));
});

test('websocket payload validation', () => {
  const P = (o) => parseMessage(typeof o === 'string' ? o : JSON.stringify(o));
  assert.equal(P('not json'), null);
  assert.equal(P('[]'), null);
  assert.equal(P({ t: 'hack' }), null);
  assert.equal(P({ t: 'chat', text: 5 }), null);
  assert.equal(P('{"t":"chat","text":"hi","__proto__":{"x":1}}'), null);
  assert.equal(P({ t: 'rejoin', code: 'ABCDEF', token: 'short' }), null);
  assert.equal(P({ t: 'settings', turnTime: 7 }), null);
  assert.equal(P({ t: 'mute', seat: 7, muted: true }), null);
  assert.equal(P({ t: 'addBot', seat: 4 }), null);
  assert.equal(P({ t: 'act', a: 'play', placements: [] }), null);
  assert.equal(P({ t: 'act', a: 'play', placements: [{ id: 1, r: 15, c: 0 }] }), null);
  assert.equal(P({ t: 'act', a: 'play', placements: [{ id: 1, r: 1, c: 0, letter: 'ab' }] }), null);
  assert.equal(P({ t: 'act', a: 'play', placements: [{ id: 1, r: 1, c: 0, evil: 1 }] }), null);
  assert.equal(P({ t: 'act', a: 'play', placements: Array(8).fill({ id: 1, r: 1, c: 1 }) }), null);
  assert.equal(P({ t: 'act', a: 'exchange', ids: [] }), null);
  assert.equal(P({ t: 'act', a: 'exchange', ids: [100] }), null);
  assert.equal(P({ t: 'act', a: 'pass', ids: [1] }), null);
  assert.equal(P({ t: 'act', a: 'nuke' }), null);
  assert.ok(P({ t: 'act', a: 'play', placements: [{ id: 1, r: 7, c: 7 }, { id: 2, r: 7, c: 8, letter: 'Q' }] }));
  assert.ok(P({ t: 'act', a: 'exchange', ids: [0, 99] }));
  assert.ok(P({ t: 'act', a: 'hint' }));
  assert.ok(P({ t: 'settings', turnTime: 120, profanity: false }));
  assert.ok(P({ t: 'chat', text: 'hello' }));
  assert.equal(P('x'.repeat(5000)), null);
});
