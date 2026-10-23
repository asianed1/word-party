'use strict';
const crypto = require('crypto');
const { Game } = require('./game');
const { cleanText, filterProfanity, RateLimiter, MAX_LEN } = require('./chat');
const dict = require('./dict');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 500;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const TURN_TIMES = [0, 60, 120, 180, 300];

const rooms = new Map();

function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}
const newToken = () => crypto.randomBytes(24).toString('hex');
const tokenEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); };
const isHuman = (s) => !!(s && !s.bot);

class Room {
  constructor(opts = {}) {
    this.code = newCode();
    this.seats = [null, null, null, null]; // null | {bot:true} | {token, name, ws, muted, chat}
    this.host = 0;
    this.settings = { turnTime: 0, profanity: true };
    this.game = null; this.lastActive = Date.now();
    this.gameOpts = opts.gameOpts || {};
  }
  running() { return !!(this.game && this.game.phase === 'play'); }
  label(i) { const s = this.seats[i]; return isHuman(s) ? `${s.name} ${i + 1}` : `Bot ${i + 1}`; }
  humans() { return this.seats.map((s, i) => (isHuman(s) ? i : -1)).filter((i) => i >= 0); }
  filled() { return this.seats.filter(Boolean).length; }

  addHuman(name, ws) {
    let seat;
    if (this.running()) seat = this.seats.findIndex((s) => s && s.bot); // take over a bot mid-game
    else { seat = this.seats.findIndex((s) => !s); if (seat < 0) seat = this.seats.findIndex((s) => s && s.bot); }
    if (seat < 0) return { error: this.running() ? 'Game in progress and every seat is taken' : 'Room is full (max 4 players)' };
    const token = newToken();
    this.seats[seat] = { token, name, ws, muted: false, chat: new RateLimiter(5, 5000) };
    if (this.running()) {
      const p = this.game.players[seat]; p.isBot = false; p.name = name; p.away = false;
      this.game.setAway(seat, false); this.game.kick();
      this.system(`${name} takes over seat ${seat + 1}`);
    } else this.system(`${name} joined seat ${seat + 1}`);
    return { seat, token };
  }

  findByToken(token) { return this.seats.findIndex((s) => isHuman(s) && tokenEq(s.token, token)); }

  lobbyState(forSeat) {
    return {
      t: 'room', code: this.code, host: this.host, you: forSeat, started: !!this.game, running: this.running(), settings: this.settings,
      seats: this.seats.map((s, i) => (!s ? null : s.bot ? { name: 'Bot', label: `Bot ${i + 1}`, human: false }
        : { name: s.name, label: this.label(i), human: true, connected: !!(s.ws && s.ws.readyState === 1), muted: s.muted })),
    };
  }
  broadcastRoom() { this.seats.forEach((s, i) => isHuman(s) && send(s.ws, this.lobbyState(i))); }
  broadcastState() { if (this.game) this.seats.forEach((s, i) => isHuman(s) && s.ws && send(s.ws, { t: 'state', v: this.game.viewFor(i) })); }
  broadcast(msg) { this.seats.forEach((s) => isHuman(s) && send(s.ws, msg)); }
  system(text) { this.broadcast({ t: 'system', text }); }

  start() {
    const players = this.seats.map((s, i) => (!s ? null : s.bot ? { name: `Bot ${i + 1}`, isBot: true } : { name: s.name, isBot: false }));
    if (this.game) this.game.destroy();
    this.game = new Game(players, Object.assign({ dict: dict.load(), turnTime: this.settings.turnTime * 1000 }, this.gameOpts));
    this.game.on('update', () => this.broadcastState());
    this.game.on('event', (e) => this.broadcast({ t: 'event', e }));
    this.game.on('error', (e) => console.error('[game]', this.code, e));
    this.seats.forEach((s, i) => { if (isHuman(s) && !(s.ws && s.ws.readyState === 1)) this.game.players[i].away = true; });
    this.broadcastRoom();
    this.game.start();
  }

  destroy() { if (this.game) this.game.destroy(); }
}

// ------------------------------------------------------------ message validation
const isSeat = (n) => Number.isInteger(n) && n >= 0 && n < 4;
const isId = (n) => Number.isInteger(n) && n >= 0 && n < 100;
const PLACEMENT_KEYS = new Set(['id', 'r', 'c', 'letter']);
const validPlacements = (p) => Array.isArray(p) && p.length >= 1 && p.length <= 7 && p.every((x) => x && typeof x === 'object' && !Array.isArray(x)
  && Object.keys(x).every((k) => PLACEMENT_KEYS.has(k)) && isId(x.id) && Number.isInteger(x.r) && x.r >= 0 && x.r < 15 && Number.isInteger(x.c) && x.c >= 0 && x.c < 15
  && (x.letter === undefined || (typeof x.letter === 'string' && /^[A-Z]$/.test(x.letter))));
const VALID = {
  create: (m) => typeof m.name === 'string',
  join: (m) => typeof m.code === 'string' && typeof m.name === 'string',
  rejoin: (m) => typeof m.code === 'string' && typeof m.token === 'string' && /^[0-9a-f]{48}$/.test(m.token),
  start: () => true,
  addBot: (m) => m.seat === undefined || isSeat(m.seat),
  removeBot: (m) => isSeat(m.seat),
  settings: (m) => (m.turnTime === undefined || TURN_TIMES.includes(m.turnTime)) && (m.profanity === undefined || typeof m.profanity === 'boolean'),
  act: (m) => {
    if (m.a === 'play' || m.a === 'preview') return validPlacements(m.placements) && m.ids === undefined;
    if (m.a === 'exchange') return Array.isArray(m.ids) && m.ids.length >= 1 && m.ids.length <= 7 && m.ids.every(isId) && m.placements === undefined;
    return (m.a === 'pass' || m.a === 'hint') && m.ids === undefined && m.placements === undefined;
  },
  chat: (m) => typeof m.text === 'string' && m.text.length <= MAX_LEN * 4,
  mute: (m) => isSeat(m.seat) && typeof m.muted === 'boolean',
  leave: () => true,
  ping: () => true,
};
const ALLOWED_KEYS = new Set(['t', 'name', 'code', 'token', 'turnTime', 'profanity', 'a', 'placements', 'ids', 'text', 'seat', 'muted']);

function parseMessage(raw) {
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let m; try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string' || !Object.hasOwn(VALID, m.t)) return null;
  for (const k of Object.keys(m)) if (!ALLOWED_KEYS.has(k)) return null;
  try { return VALID[m.t](m) ? m : null; } catch { return null; }
}

const cleanName = (n) => cleanText(n, 16);

function attach(ws, ip, roomLimiter) {
  const ctx = { room: null, seat: -1, token: null };
  const limiter = new RateLimiter(30, 3000);
  const hintLimiter = new RateLimiter(3, 10000);
  const err = (msg, extra) => send(ws, Object.assign({ t: 'error', msg }, extra));

  const bind = (room, seat, token) => {
    const s = room.seats[seat];
    if (s.ws && s.ws !== ws) { send(s.ws, { t: 'error', msg: 'You opened this seat in another tab.' }); try { s.ws.close(4000, 'replaced'); } catch {} }
    s.ws = ws; ctx.room = room; ctx.seat = seat; ctx.token = token; room.lastActive = Date.now();
    send(ws, { t: 'joined', code: room.code, token, seat });
    if (room.game) room.game.setAway(seat, false);
    room.broadcastRoom();
    if (room.game) send(ws, { t: 'state', v: room.game.viewFor(seat) });
  };

  // Every in-room message re-validates the seat token bound to this socket.
  const authed = () => {
    const { room, seat, token } = ctx;
    if (!room || !rooms.has(room.code) || seat < 0 || !isHuman(room.seats[seat]) || !tokenEq(room.seats[seat].token, token) || room.seats[seat].ws !== ws) { err('Not in a room'); return false; }
    room.lastActive = Date.now();
    return true;
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return ws.close(1003, 'binary not allowed');
    if (!limiter.allow()) { err('Slow down!'); return; }
    const m = parseMessage(data.toString('utf8'));
    if (!m) return err('Invalid message');
    switch (m.t) {
      case 'ping': return send(ws, { t: 'pong' });
      case 'create': {
        if (ctx.room) return err('Already in a room');
        if (!roomLimiter(ip)) return err('Too many rooms created, try again in a minute');
        if (rooms.size >= MAX_ROOMS) return err('Server is busy, try later');
        const name = cleanName(m.name); if (!name) return err('Please enter a name (1-16 characters)');
        const room = new Room(module.exports.defaults); rooms.set(room.code, room);
        const r = room.addHuman(name, ws); room.host = r.seat;
        return bind(room, r.seat, r.token);
      }
      case 'join': {
        if (ctx.room) return err('Already in a room');
        const room = rooms.get(m.code.trim().toUpperCase());
        if (!room) return err('Room not found. Check the code?');
        const name = cleanName(m.name); if (!name) return err('Please enter a name (1-16 characters)');
        const r = room.addHuman(name, ws); if (r.error) return err(r.error);
        return bind(room, r.seat, r.token);
      }
      case 'rejoin': {
        const room = rooms.get(m.code.trim().toUpperCase());
        if (!room) return send(ws, { t: 'rejoinFailed' });
        const seat = room.findByToken(m.token);
        if (seat < 0) return send(ws, { t: 'rejoinFailed' });
        return bind(room, seat, m.token);
      }
    }
    if (!authed()) return;
    const { room, seat } = ctx;
    switch (m.t) {
      case 'start':
        if (seat !== room.host) return err('Only the host can start');
        if (room.running()) return err('Game already running');
        if (room.filled() < 2) return err('Need at least 2 players - invite a friend or add a bot');
        room.system(`${room.label(seat)} started the game`);
        return room.start();
      case 'addBot': {
        if (seat !== room.host) return err('Only the host can add bots');
        if (room.running()) return err('Cannot add bots during a game');
        const target = m.seat !== undefined ? m.seat : room.seats.findIndex((s) => !s);
        if (target < 0 || room.seats[target]) return err('No free seat');
        room.seats[target] = { bot: true };
        room.system(`Bot ${target + 1} joined`);
        return room.broadcastRoom();
      }
      case 'removeBot': {
        if (seat !== room.host) return err('Only the host can remove bots');
        if (room.running()) return err('Cannot remove bots during a game');
        if (!room.seats[m.seat] || !room.seats[m.seat].bot) return err('That seat is not a bot');
        room.seats[m.seat] = null;
        room.system(`Bot ${m.seat + 1} left`);
        return room.broadcastRoom();
      }
      case 'settings':
        if (seat !== room.host) return err('Only the host can change settings');
        if (m.profanity !== undefined) room.settings.profanity = m.profanity;
        if (m.turnTime !== undefined) { if (room.running()) return err('Change the turn timer between games'); room.settings.turnTime = m.turnTime; }
        return room.broadcastRoom();
      case 'act': {
        if (!room.game) return err('Game not started');
        if (m.a === 'hint' && !hintLimiter.allow()) return err('Easy on the hints - try again in a few seconds');
        const r = room.game.act(seat, { a: m.a, placements: m.placements, ids: m.ids });
        if (!r.ok) return err(r.error, r.invalid ? { invalid: r.invalid } : undefined);
        if (r.preview) send(ws, { t: 'preview', p: r.preview });
        if (m.a === 'hint') send(ws, { t: 'hint', h: r.hint });
        return;
      }
      case 'chat': {
        const s = room.seats[seat];
        if (s.muted) return err('The host has muted you');
        if (!s.chat.allow()) return err('Chat limit: 5 messages per 5 seconds');
        let text = cleanText(m.text); if (!text) return err(`Message must be 1-${MAX_LEN} characters`);
        if (room.settings.profanity) text = filterProfanity(text);
        return room.broadcast({ t: 'chat', seat, label: room.label(seat), text, ts: Date.now() });
      }
      case 'mute': {
        if (seat !== room.host) return err('Only the host can mute');
        const target = room.seats[m.seat];
        if (!isHuman(target) || m.seat === seat) return err('Cannot mute that seat');
        target.muted = m.muted;
        room.system(`${room.label(m.seat)} was ${m.muted ? 'muted' : 'unmuted'} by the host`);
        return room.broadcastRoom();
      }
      case 'leave': {
        const name = room.label(seat);
        if (room.running()) { room.seats[seat] = { bot: true }; room.game.toBot(seat, `Bot ${seat + 1}`); }
        else room.seats[seat] = null;
        if (room.host === seat) { const h = room.humans(); if (h.length) room.host = h[0]; }
        room.system(`${name} left`);
        ctx.room = null; ctx.seat = -1; ctx.token = null;
        if (!room.humans().length) { room.destroy(); rooms.delete(room.code); }
        else { room.broadcastRoom(); room.broadcastState(); }
        return send(ws, { t: 'left' });
      }
    }
  });

  ws.on('close', () => {
    const { room, seat } = ctx;
    if (!room || !isHuman(room.seats[seat]) || room.seats[seat].ws !== ws) return;
    room.seats[seat].ws = null;
    if (room.game) room.game.setAway(seat, true); // turns are skipped after a grace period until you reconnect
    room.broadcastRoom();
  });
}

function sweep() {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const anyone = r.seats.some((s) => isHuman(s) && s.ws && s.ws.readyState === 1);
    if (!anyone && now - r.lastActive > ROOM_IDLE_MS) { r.destroy(); rooms.delete(code); }
  }
}

module.exports = { attach, rooms, Room, parseMessage, sweep, defaults: {} };
