'use strict';
const { EventEmitter } = require('events');
const crypto = require('crypto');
const R = require('./rules');
const MG = require('./movegen');

const MAX_SCORELESS = 6;

class Game extends EventEmitter {
  /**
   * seats: array(4) of null | {name, isBot}. At least 2 non-null.
   * opts: dict (required), turnTime ms (0 = off), botDelay, awayGrace, randInt (tests)
   */
  constructor(seats, opts = {}) {
    super();
    this.opts = Object.assign({ turnTime: 0, botDelay: 1200, awayGrace: 45000, randInt: (n) => crypto.randomInt(n) }, opts);
    if (!this.opts.dict) throw new Error('dict required');
    this.dict = this.opts.dict;
    this.players = seats.map((s) => (s ? { name: s.name, isBot: !!s.isBot, away: false, score: 0, rack: [] } : null));
    this.order = this.players.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    if (this.order.length < 2 || this.order.length > 4) throw new Error('need 2-4 players');
    this.board = R.emptyBoard();
    this.phase = 'init'; this.scoreless = 0; this.moveNo = 0; this.log = []; this.lastMove = null;
    this.timers = []; this.deadline = null; this.token = 0; this.result = null;
  }

  later(ms, fn) {
    const tok = this.token;
    this.timers.push(setTimeout(() => { if (tok === this.token && !this.destroyed) { try { fn(); } catch (e) { this.emit('error', e); } } }, ms));
  }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; this.deadline = null; this.token++; }
  destroy() { this.destroyed = true; this.clearTimers(); this.removeAllListeners(); }
  changed() { this.emit('update'); }
  automated(seat) { const p = this.players[seat]; return p && (p.isBot); }

  draw(p, n) { while (n-- > 0 && this.bag.length) p.rack.push(this.bag.pop()); }

  start() {
    this.bag = R.makeBag(this.opts.randInt);
    for (const s of this.order) this.draw(this.players[s], R.RACK_SIZE);
    this.turn = this.order[this.opts.randInt(this.order.length)];
    this.phase = 'play';
    this.addLog({ type: 'start', text: `${this.players[this.turn].name} goes first` });
    this.kick(); this.changed();
  }

  addLog(entry) { this.log.push(entry); if (this.log.length > 30) this.log.shift(); this.emit('event', entry); }

  kick() {
    this.clearTimers();
    if (this.phase !== 'play') return;
    const s = this.turn, p = this.players[s];
    if (p.isBot) this.later(this.opts.botDelay, () => this.botTurn(s));
    else if (p.away) { this.deadline = Date.now() + this.opts.awayGrace; this.later(this.opts.awayGrace, () => this.pass(s, 'away')); }
    else if (this.opts.turnTime > 0) { this.deadline = Date.now() + this.opts.turnTime; this.later(this.opts.turnTime, () => this.pass(s, 'timeout')); }
  }

  botTurn(seat) {
    if (this.phase !== 'play' || this.turn !== seat) return;
    const p = this.players[seat];
    const mv = MG.bestMove(this.board, p.rack, this.dict);
    if (mv) { const r = this.play(seat, mv.placements); if (r.ok) return; this.emit('error', new Error('bot produced illegal move: ' + r.error)); }
    if (this.bag.length >= R.RACK_SIZE) this.exchange(seat, MG.exchangeChoice(p.rack));
    else this.pass(seat);
  }

  nextTurn() {
    const i = this.order.indexOf(this.turn);
    this.turn = this.order[(i + 1) % this.order.length];
    this.moveNo++;
    this.kick(); this.changed();
  }

  act(seat, m) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'bad move' };
    switch (m.a) {
      case 'play': return this.play(seat, m.placements);
      case 'preview': return this.preview(seat, m.placements);
      case 'exchange': return this.exchange(seat, m.ids);
      case 'pass': return this.pass(seat);
      case 'hint': return this.hint(seat);
      default: return { ok: false, error: 'unknown action' };
    }
  }

  checkTurn(seat) {
    if (this.phase !== 'play') return 'The game is not running';
    if (this.turn !== seat) return 'Wait for your turn';
    return null;
  }

  preview(seat, placements) {
    const p = this.players[seat]; if (!p) return { ok: false, error: 'no seat' };
    const ev = R.evaluateMove(this.board, p.rack, placements, this.dict);
    return { ok: true, preview: { valid: ev.ok, error: ev.error || null, code: ev.code || null, cells: ev.cells || [], mark: ev.mark || null, invalid: ev.invalid || [], score: ev.ok ? ev.score : null, bingo: !!ev.bingo, words: (ev.words || []).map((w) => ({ word: w.word, score: w.score })) } };
  }

  hint(seat) {
    const e = this.checkTurn(seat); if (e) return { ok: false, error: e };
    const mv = MG.bestMove(this.board, this.players[seat].rack, this.dict);
    if (!mv) return { ok: true, hint: null };
    return { ok: true, hint: { placements: mv.placements, score: mv.score, words: mv.words.map((w) => w.word) } };
  }

  play(seat, placements) {
    const e = this.checkTurn(seat); if (e) return { ok: false, error: e };
    const p = this.players[seat];
    const ev = R.evaluateMove(this.board, p.rack, placements, this.dict);
    if (!ev.ok) return { ok: false, error: ev.error, code: ev.code, cells: ev.cells, mark: ev.mark, invalid: ev.invalid };
    for (const t of ev.tiles) this.board[t.r][t.c] = { letter: t.letter, blank: t.blank };
    const usedIds = new Set(ev.tiles.map((t) => t.id));
    p.rack = p.rack.filter((t) => !usedIds.has(t.id));
    p.score += ev.score;
    this.draw(p, R.RACK_SIZE - p.rack.length);
    this.scoreless = ev.score > 0 ? 0 : this.scoreless + 1;
    this.lastMove = { type: 'play', seat, score: ev.score, bingo: ev.bingo, cells: ev.tiles.map((t) => [t.r, t.c]), words: ev.words.map((w) => ({ word: w.word, score: w.score })) };
    this.addLog({ type: 'play', seat, text: `${p.name} played ${ev.words.map((w) => w.word).join(', ')} for ${ev.score}${ev.bingo ? ' (BINGO! +50)' : ''}`, score: ev.score, bingo: ev.bingo });
    if (p.rack.length === 0 && this.bag.length === 0) return this.endGame(seat), { ok: true };
    if (this.scoreless >= MAX_SCORELESS) return this.endGame(null), { ok: true };
    this.nextTurn();
    return { ok: true };
  }

  exchange(seat, ids) {
    const e = this.checkTurn(seat); if (e) return { ok: false, error: e };
    if (this.bag.length < R.RACK_SIZE) return { ok: false, error: 'You can only exchange while the bag has 7 or more tiles' };
    const p = this.players[seat];
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > R.RACK_SIZE || new Set(ids).size !== ids.length || !ids.every((id) => p.rack.some((t) => t.id === id))) return { ok: false, error: 'Pick 1-7 tiles from your rack to exchange' };
    const out = p.rack.filter((t) => ids.includes(t.id));
    p.rack = p.rack.filter((t) => !ids.includes(t.id));
    this.draw(p, out.length);
    this.bag.push(...out);
    for (let i = this.bag.length - 1; i > 0; i--) { const j = this.opts.randInt(i + 1); [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]]; }
    this.scoreless++;
    this.lastMove = { type: 'exchange', seat, count: out.length, cells: [] };
    this.addLog({ type: 'exchange', seat, text: `${p.name} exchanged ${out.length} tile${out.length > 1 ? 's' : ''}` });
    if (this.scoreless >= MAX_SCORELESS) return this.endGame(null), { ok: true };
    this.nextTurn();
    return { ok: true };
  }

  pass(seat, why) {
    const e = this.checkTurn(seat); if (e) return { ok: false, error: e };
    const p = this.players[seat];
    this.scoreless++;
    this.lastMove = { type: 'pass', seat, cells: [] };
    this.addLog({ type: 'pass', seat, text: `${p.name} ${why === 'timeout' ? 'ran out of time' : why === 'away' ? 'is away - turn skipped' : 'passed'}` });
    if (this.scoreless >= MAX_SCORELESS) return this.endGame(null), { ok: true };
    this.nextTurn();
    return { ok: true };
  }

  endGame(outSeat) {
    this.clearTimers();
    const adjust = {};
    let bonus = 0;
    for (const s of this.order) {
      const p = this.players[s], v = R.rackValue(p.rack);
      if (s === outSeat) continue;
      adjust[s] = -v; p.score -= v; bonus += v;
    }
    if (outSeat != null) { adjust[outSeat] = bonus; this.players[outSeat].score += bonus; }
    const top = Math.max(...this.order.map((s) => this.players[s].score));
    this.result = {
      reason: outSeat != null ? 'out' : 'scoreless', outSeat, adjust,
      racks: Object.fromEntries(this.order.map((s) => [s, this.players[s].rack.map((t) => t.letter)])),
      scores: Object.fromEntries(this.order.map((s) => [s, this.players[s].score])),
      winners: this.order.filter((s) => this.players[s].score === top),
    };
    this.phase = 'over';
    this.addLog({ type: 'end', text: outSeat != null ? `${this.players[outSeat].name} went out - game over!` : `${MAX_SCORELESS} scoreless turns in a row - game over!` });
    this.emit('gameOver', this.result);
    this.changed();
  }

  setAway(seat, away) {
    const p = this.players[seat]; if (!p || p.away === away) return;
    p.away = away;
    if (this.phase === 'play' && this.turn === seat) this.kick();
    this.changed();
  }

  toBot(seat, name) {
    const p = this.players[seat]; if (!p) return;
    p.isBot = true; p.away = false; p.name = name;
    if (this.phase === 'play' && this.turn === seat) this.kick();
    this.changed();
  }

  viewFor(seat) {
    return {
      phase: this.phase, turn: this.turn, moveNo: this.moveNo, bag: this.bag ? this.bag.length : 0, scoreless: this.scoreless,
      turnTime: this.opts.turnTime, remainingMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
      board: this.board.map((row) => row.map((x) => (x ? (x.blank ? x.letter.toLowerCase() : x.letter) : ''))),
      players: this.players.map((p, i) => (p ? { seat: i, name: p.name, isBot: p.isBot, away: p.away, score: p.score, rackCount: p.rack.length } : null)),
      lastMove: this.lastMove, log: this.log.slice(-12), result: this.result,
      you: seat, rack: seat != null && this.players[seat] ? this.players[seat].rack.map((t) => ({ id: t.id, letter: t.letter })) : [],
      canExchange: !!this.bag && this.bag.length >= R.RACK_SIZE,
    };
  }
}

module.exports = { Game, MAX_SCORELESS };
