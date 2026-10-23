'use strict';
// Smoke test: two socket clients create/join a room, add a bot, chat, play a real move, and rejoin with a session token.
// Usage: node scripts/smoke.js [http://localhost:3000]
const WebSocket = require('ws');
const base = process.argv[2] || 'http://localhost:3000';
const wsUrl = base.replace(/^http/, 'ws') + '/ws';
const origin = base;

function client(label) {
  const ws = new WebSocket(wsUrl, { headers: { Origin: origin } });
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    inbox.push(m);
    for (const w of waiters.slice()) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const c = {
    ws, inbox, label,
    open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); }),
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 5000) => {
      const hit = inbox.find(pred); if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: (m) => { clearTimeout(t); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`${label}: timeout waiting`)); }, ms);
        waiters.push(w);
      });
    },
  };
  return c;
}

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('  ✓', msg); };

(async () => {
  console.log(`Smoke test against ${base}`);
  const res = await fetch(base + '/');
  ok(res.status === 200, 'GET / returns 200');
  const html = await res.text();
  ok(html.includes('Word Party'), 'page title is Word Party');
  ok((res.headers.get('content-security-policy') || '').includes("default-src 'self'"), 'CSP header present');
  ok(res.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
  ok((await fetch(base + '/healthz')).status === 200, '/healthz ok');
  const word = async (w) => (await (await fetch(base + '/api/word?w=' + w)).json()).valid;
  for (const w of ['GAED', 'FEIRIE', 'QAT', 'QI', 'ZA']) ok((await word(w)) === false, `everyday list rejects ${w}`);
  for (const w of ['HOSE', 'TEE', 'QUEEN', 'JUMPED']) ok((await word(w)) === true, `everyday list accepts ${w}`);
  ok(/Everyday English words only \(standard dictionary\)/.test(html), 'How to play says "Everyday English words only (standard dictionary)"');

  const A = client('Sam'), B = client('Alice');
  await A.open(); await B.open();
  A.send({ t: 'create', name: 'Sam' });
  const ja = await A.wait((m) => m.t === 'joined');
  ok(/^[A-Z2-9]{6}$/.test(ja.code) && ja.seat === 0, `room created: ${ja.code}, Sam in seat 1`);

  A.send({ t: 'start' });
  ok(!!(await A.wait((m) => m.t === 'error' && /at least 2/.test(m.msg))), 'cannot start with only 1 player');

  B.send({ t: 'join', code: ja.code.toLowerCase(), name: 'Alice' });
  const jb = await B.wait((m) => m.t === 'joined');
  ok(jb.seat === 1, 'Alice joined seat 2 (code is case-insensitive)');
  const room = await A.wait((m) => m.t === 'room' && m.seats[1] && m.seats[1].human);
  ok(room.seats[1].label === 'Alice 2' && room.seats[2] === null && room.seats[3] === null, `room lists Alice as "${room.seats[1].label}", seats 3-4 empty`);

  ok(room.settings.expertWords === false, 'Expert words is off by default');
  B.send({ t: 'settings', expertWords: true });
  ok(!!(await B.wait((m) => m.t === 'error' && /host can change/.test(m.msg))), 'only the host can turn on Expert words');
  A.send({ t: 'settings', expertWords: true });
  ok((await B.wait((m) => m.t === 'room' && m.settings.expertWords === true)).settings.expertWords, 'host can turn Expert words on');
  A.send({ t: 'settings', expertWords: false });
  ok((await B.wait((m) => m.t === 'room' && m.settings.expertWords === false)), 'and back off');

  B.send({ t: 'addBot', seat: 2 });
  ok(!!(await B.wait((m) => m.t === 'error' && /host can add/.test(m.msg))), 'non-host cannot add bots');
  A.send({ t: 'addBot', seat: 2 });
  const rb = await B.wait((m) => m.t === 'room' && m.seats[2] && !m.seats[2].human);
  ok(rb.seats[2].label === 'Bot 3', 'host added "Bot 3"');

  A.send({ t: 'chat', text: 'Hello <b>Alice</b> <script>alert(1)</script>' });
  const cb = await B.wait((m) => m.t === 'chat');
  ok(cb.label === 'Sam 1' && cb.seat === 0, `chat labelled "${cb.label}"`);
  ok(cb.text === 'Hello <b>Alice</b> <script>alert(1)</script>', 'chat text delivered verbatim as data (rendered via textContent)');

  B.send({ t: 'chat', text: 'what the fuck' });
  const pf = await A.wait((m) => m.t === 'chat' && m.seat === 1);
  ok(pf.text === 'what the f***' && pf.label === 'Alice 2', 'profanity filter on by default; label "Alice 2"');

  B.send({ t: 'chat', text: 'x'.repeat(301) });
  ok(!!(await B.wait((m) => m.t === 'error' && m.msg.includes('300'))), '301-char message rejected');

  for (let i = 0; i < 6; i++) A.send({ t: 'chat', text: `spam ${i}` });
  ok(!!(await A.wait((m) => m.t === 'error' && /Chat limit/.test(m.msg))), 'chat rate limit kicks in after 5 messages / 5s');

  A.send({ t: 'chat', text: 'x', seat: 3, extra: 1 });
  ok(!!(await A.wait((m) => m.t === 'error' && m.msg === 'Invalid message')), 'unexpected payload fields rejected');
  A.send({ t: 'act', a: 'play', placements: [{ id: 1, r: 99, c: 0 }] });
  ok(!!(await A.wait((m) => m.t === 'error' && m.msg === 'Invalid message')), 'out-of-range placement rejected by the validator');

  B.send({ t: 'mute', seat: 0, muted: true });
  ok(!!(await B.wait((m) => m.t === 'error' && /host can mute/.test(m.msg))), 'non-host cannot mute');
  A.send({ t: 'mute', seat: 1, muted: true });
  await A.wait((m) => m.t === 'room' && m.seats[1] && m.seats[1].muted);
  B.send({ t: 'chat', text: 'can you hear me' });
  ok(!!(await B.wait((m) => m.t === 'error' && /muted/.test(m.msg))), 'host muted Alice; her chat is blocked');
  A.send({ t: 'mute', seat: 1, muted: false });

  B.send({ t: 'start' });
  ok(!!(await B.wait((m) => m.t === 'error' && /host can start/.test(m.msg))), 'only host can start');
  A.send({ t: 'start' });
  const sa = await A.wait((m) => m.t === 'state');
  const sb = await B.wait((m) => m.t === 'state');
  ok(sa.v.players[2].isBot && sa.v.players[3] === null, 'game started with 3 seats (Bot 3), seat 4 empty');
  ok(sa.v.rack.length === 7 && sa.v.players.every((p) => !p || p.rack === undefined), 'each client sees only its own 7-tile rack');
  ok(sa.v.you === 0 && sb.v.you === 1 && sa.v.bag === 100 - 21, 'own seat views; 79 tiles left in the bag');

  // Wait until it's a human's turn (the bot may go first), then play the hinted move.
  const clients = { 0: A, 1: B };
  let st = sa.v;
  const freshState = async (c, pred, ms = 15000) => { for (;;) { const m = await c.wait((x) => x.t === 'state', ms); if (pred(m.v)) return m.v; } };
  if (st.turn === 2) st = await freshState(A, (v) => v.turn !== 2);
  const P = clients[st.turn], seat = st.turn;
  P.inbox.splice(0); // drop stale states
  P.send({ t: 'act', a: 'hint' });
  const hint = await P.wait((m) => m.t === 'hint');
  ok(hint.h && hint.h.placements.length > 0 && hint.h.score > 0, `hint suggests ${hint.h.words.join(', ')} for ${hint.h.score}`);
  P.send({ t: 'act', a: 'preview', placements: hint.h.placements });
  const pv = await P.wait((m) => m.t === 'preview');
  ok(pv.p.valid && pv.p.score === hint.h.score, `Check preview: valid, ${pv.p.score} points`);
  // The reported L-shape (2 across + 2 more down) must come back as a structured, friendly error.
  const ids = (seat === 0 ? sa.v.rack : sb.v.rack).slice(0, 4).map((t) => t.id); // racks only change when their owner plays
  const lShape = [[0, 0], [0, 1], [1, 1], [2, 1]].map(([r, c], i) => ({ id: ids[i], r, c, letter: 'E' }));
  P.send({ t: 'act', a: 'play', placements: lShape });
  const le = await P.wait((m) => m.t === 'error' && m.code);
  ok(le.code === 'NOT_IN_LINE' && JSON.stringify(le.cells) === '[[0,0]]' && /single straight line/.test(le.msg), 'L-shape rejected as NOT_IN_LINE with the odd tile (0,0) flagged');
  const gr = st.board.flat().some(Boolean) ? 0 : 7, gc = gr ? 7 : 0; // on move 1 the left tile must sit on the star
  P.send({ t: 'act', a: 'preview', placements: [[gr, gc], [gr, gc + 2]].map(([r, c], i) => ({ id: ids[i], r, c, letter: 'E' })) });
  const gp = await P.wait((m) => m.t === 'preview');
  ok(!gp.p.valid && gp.p.code === 'GAP' && JSON.stringify(gp.p.cells) === JSON.stringify([[gr, gc + 1]]), 'Check reports GAP with the empty square');
  const other = clients[seat === 0 ? 1 : 0];
  other.send({ t: 'act', a: 'play', placements: hint.h.placements });
  ok(!!(await other.wait((m) => m.t === 'error' && /turn|rack/.test(m.msg))), 'other player cannot play out of turn');
  P.send({ t: 'act', a: 'play', placements: hint.h.placements });
  const after = await freshState(P, (v) => v.lastMove && v.lastMove.type === 'play' && v.lastMove.seat === seat);
  ok(after.players[seat].score === hint.h.score && after.rack.length === 7, `move played: score ${after.players[seat].score}, rack refilled`);
  const boardLetters = after.board.flat().filter(Boolean).length;
  ok(boardLetters >= hint.h.placements.length, 'tiles appear on the shared board');

  // Simulate a page refresh: drop Alice's socket and rejoin with her token
  B.ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const B2 = client('Alice-again'); await B2.open();
  B2.send({ t: 'rejoin', code: ja.code, token: jb.token });
  const rj = await B2.wait((m) => m.t === 'joined');
  ok(rj.seat === 1, 'Alice rejoined her seat after "refresh" with her session token');
  ok((await B2.wait((m) => m.t === 'state')).v.you === 1, 'rejoined client receives game state');

  const C = client('Mallory'); await C.open();
  C.send({ t: 'rejoin', code: ja.code, token: 'ab'.repeat(24) });
  ok(!!(await C.wait((m) => m.t === 'rejoinFailed')), 'forged token rejected');
  C.send({ t: 'chat', text: 'hi' });
  ok((await C.wait((m) => m.t === 'error')).msg === 'Not in a room', 'chat without a seat token is rejected');
  C.send({ t: 'join', code: ja.code, name: 'Carol' });
  const jc = await C.wait((m) => m.t === 'joined');
  ok(jc.seat === 2, 'a late friend joining mid-game takes over Bot 3\'s seat');
  ok(!!(await A.wait((m) => m.t === 'system' && /Carol takes over seat 3/.test(m.text))), 'everyone is told "Carol takes over seat 3"');
  const D = client('Dave'); await D.open();
  D.send({ t: 'join', code: ja.code, name: 'Dave' });
  ok(!!(await D.wait((m) => m.t === 'error' && /every seat/.test(m.msg))), 'cannot join a running game once no bot seat is left');
  D.ws.close();

  const evil = new WebSocket(wsUrl, { headers: { Origin: 'https://evil.example' } });
  const refused = await new Promise((r) => { evil.on('open', () => r(false)); evil.on('error', () => r(true)); evil.on('unexpected-response', () => r(true)); });
  ok(refused, 'cross-origin WebSocket refused');

  B2.send({ t: 'chat', text: 'back!' });
  const back = await A.wait((m) => m.t === 'chat' && m.text === 'back!');
  ok(back.label === 'Alice 2', 'chat works after rejoin');

  A.send({ t: 'leave' }); B2.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 200));
  [A, B2, C].forEach((c) => c.ws.close());
  console.log('SMOKE TEST PASSED');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
