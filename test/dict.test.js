'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../server/dict');

const REJECT = ['GAED', 'FEIRIE', 'QAT', 'QATS', 'ZA', 'QI', 'XU', 'AA', 'KAT', 'KHAT', 'MU', 'NU', 'ES', 'EM'];
const ACCEPT = ['HOSE', 'TEE', 'CAT', 'RUNNING', 'QUEEN', 'BOXES', 'JUMPED', 'FAIRY', 'OK', 'COLOUR', 'COLOR', 'TALLER', 'QUIZ'];
const EVERYDAY_TWO = 'AM AN AS AT BE BY DO GO HE HI IF IN IS IT ME MY NO OF OH OK ON OR OX SO TO UP US WE AH AX EH UM'.split(' ');

test('common (default) list rejects obscure words', () => {
  const d = load();
  for (const w of REJECT) assert.equal(d.has(w), false, w);
});

test('common list accepts everyday words, including inflections and UK/US spellings', () => {
  const d = load();
  for (const w of ACCEPT) assert.ok(d.has(w), w);
  for (const w of EVERYDAY_TWO) assert.ok(d.has(w), w);
  assert.ok(d.count > 60000 && d.count < 70000, String(d.count));
  assert.equal(load('common'), d, 'cached');
});

test('slurs are blocked in both lists; expert is a superset of common', () => {
  const c = load(), e = load('expert');
  for (const w of ['NIGGER', 'FAGGOT', 'KIKE', 'SPIC', 'CHINK']) { assert.equal(c.has(w), false, w); assert.equal(e.has(w), false, w); }
  for (const w of [...ACCEPT, ...EVERYDAY_TWO]) assert.ok(e.has(w), w);
  for (const w of ['GAED', 'FEIRIE', 'QAT', 'KHAT', 'AA', 'XU']) assert.ok(e.has(w), w);
  assert.throws(() => load('nope'));
});
