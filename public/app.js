'use strict';
/* Word Party client. All user-provided text is rendered with textContent only. */
(function () {
  const $ = (id) => document.getElementById(id);
  const SIZE = 15;
  const VALUES = { A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, '?': 0 };
  const PREMIUM = (() => {
    const g = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null)), L = SIZE - 1;
    const sym = (r, c, v) => [[r, c], [c, r], [L - r, c], [r, L - c], [L - r, L - c], [c, L - r], [L - c, r], [L - c, L - r]].forEach(([a, b]) => { g[a][b] = v; });
    [[0, 0], [0, 7]].forEach(([r, c]) => sym(r, c, 'TW'));
    [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]].forEach(([r, c]) => sym(r, c, 'DW'));
    [[1, 5], [5, 5]].forEach(([r, c]) => sym(r, c, 'TL'));
    [[0, 3], [2, 6], [3, 7], [6, 6]].forEach(([r, c]) => sym(r, c, 'DL'));
    return g;
  })();
  const PLABEL = { TW: '3×W', DW: '2×W', TL: '3×L', DL: '2×L' };

  // ------------------------------------------------------------ small DOM helpers
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function seatBadge(i) { return h('span', `seatnum s${i}`, String(i + 1)); }
  function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms); }
  let screen = 'home';
  function show(id) { screen = id; ['home', 'lobby', 'game'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); $('chat').classList.toggle('hidden', id === 'home'); }
  function makeTile(letter, opts = {}) {
    // letter: 'A'..'Z', '?' (unplayed blank), or lowercase = blank showing that letter
    const blank = letter === '?' || (letter !== letter.toUpperCase()) || !!opts.blank;
    const t = h('div', 'tile' + (blank ? ' blank' : ''));
    const shown = letter === '?' ? '' : letter.toUpperCase();
    t.appendChild(h('span', 'ltr', shown));
    t.appendChild(h('span', 'val', blank ? '' : String(VALUES[shown] || '')));
    return t;
  }

  // ------------------------------------------------------------ sound (WebAudio blips)
  let soundOn = localStorage.getItem('wp_sound') !== 'off', actx = null;
  function blip(freq = 660, dur = 0.08, type = 'sine', vol = 0.15, delay = 0) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* audio not available */ }
  }
  const SFX = {
    place: () => blip(300, 0.05, 'triangle', 0.2),
    play: () => { blip(420, 0.06, 'triangle', 0.2); blip(520, 0.06, 'triangle', 0.18, 0.07); },
    turn: () => { blip(660, 0.08); blip(880, 0.1, 'sine', 0.15, 0.09); },
    bingo: () => [523, 659, 784, 1047, 1319].forEach((f, i) => blip(f, 0.16, 'triangle', 0.2, i * 0.1)),
    bad: () => blip(180, 0.15, 'square', 0.08),
    chat: () => blip(990, 0.05, 'sine', 0.08),
    end: () => [784, 659, 523, 784, 1047].forEach((f, i) => blip(f, 0.2, 'triangle', 0.2, i * 0.14)),
  };
  function renderSoundBtn() { $('soundBtn').textContent = soundOn ? '🔊' : '🔇'; }
  $('soundBtn').onclick = () => { soundOn = !soundOn; localStorage.setItem('wp_sound', soundOn ? 'on' : 'off'); renderSoundBtn(); blip(); };
  renderSoundBtn();

  // ------------------------------------------------------------ help overlay
  const openHelp = () => $('helpPopup').classList.remove('hidden');
  $('helpBtn').onclick = openHelp; $('homeHelp').onclick = openHelp;
  $('helpClose').onclick = () => { $('helpPopup').classList.add('hidden'); localStorage.setItem('wp_seenHelp', '1'); };

  // ------------------------------------------------------------ connection
  let ws = null, session = null, room = null, view = null, retry = 0, pendingAction = null;
  try { session = JSON.parse(localStorage.getItem('wp_session') || 'null'); } catch { session = null; }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      retry = 0;
      if (session && session.code && session.token) send({ t: 'rejoin', code: session.code, token: session.token });
      if (pendingAction) { send(pendingAction); pendingAction = null; }
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
    ws.onclose = (ev) => {
      if (ev.code === 4000) { toast('This seat was opened in another tab.', 6000); return; }
      retry++; setTimeout(connect, Math.min(5000, 500 * retry));
      if (room) toast('Connection lost - reconnecting…');
    };
  }
  function send(msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); else pendingAction = msg; }
  setInterval(() => send({ t: 'ping' }), 25000);

  function onMessage(m) {
    switch (m.t) {
      case 'joined':
        session = { code: m.code, token: m.token, seat: m.seat };
        localStorage.setItem('wp_session', JSON.stringify(session));
        history.replaceState(null, '', `?room=${encodeURIComponent(m.code)}`);
        break;
      case 'rejoinFailed':
        session = null; localStorage.removeItem('wp_session'); room = null; view = null; show('home'); break;
      case 'room': room = m; renderRoom(); break;
      case 'state': onState(m.v); break;
      case 'event': onEvent(m.e); break;
      case 'preview': showPreview(m.p); break;
      case 'hint': applyHint(m.h); break;
      case 'chat': addChat(m.seat, m.label, m.text); if (!session || m.seat !== session.seat) SFX.chat(); break;
      case 'system': addSystem(m.text); break;
      case 'error':
        if (m.code) showProblem({ valid: false, error: m.msg, code: m.code, cells: m.cells, mark: m.mark, invalid: m.invalid || [], words: [] });
        else toast(m.msg, 3500);
        break;
      case 'left':
        session = null; localStorage.removeItem('wp_session'); room = null; view = null;
        history.replaceState(null, '', location.pathname); $('chatLog').replaceChildren(); show('home'); break;
    }
  }

  // ------------------------------------------------------------ home
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (urlRoom) $('codeInput').value = urlRoom;
  $('nameInput').value = localStorage.getItem('wp_name') || '';
  function myName() {
    const n = $('nameInput').value.trim();
    if (!n) { toast('Please type your name first 🙂'); $('nameInput').focus(); return null; }
    localStorage.setItem('wp_name', n); return n;
  }
  $('createBtn').onclick = () => { const n = myName(); if (n) send({ t: 'create', name: n }); };
  $('joinBtn').onclick = () => {
    const n = myName(); if (!n) return;
    const code = $('codeInput').value.trim().toUpperCase();
    if (code.length !== 6) return toast('Room codes have 6 characters');
    if (session && session.code !== code) { session = null; localStorage.removeItem('wp_session'); }
    send({ t: 'join', code, name: n });
  };
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
  $('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('codeInput').value.trim().length === 6 ? $('joinBtn') : $('createBtn')).click(); });

  // ------------------------------------------------------------ lobby
  function renderRoom() {
    const isHost = room.you === room.host;
    $('lobbyCode').textContent = room.code;
    $('shareLink').value = `${location.origin}/?room=${room.code}`;
    const list = $('seatList'); list.replaceChildren();
    room.seats.forEach((s, i) => {
      const li = h('li', !s ? 'empty' : s.human ? '' : 'bot'); li.appendChild(seatBadge(i));
      li.appendChild(h('span', '', !s ? 'Empty seat' : s.human ? s.name : `🤖 Bot ${i + 1}`));
      const tags = [];
      if (s && s.human) { if (i === room.host) tags.push('host'); if (i === room.you) tags.push('you'); if (!s.connected) tags.push('offline'); if (s.muted) tags.push('muted'); }
      if (tags.length) li.appendChild(h('span', 'tag', tags.join(' · ')));
      if (isHost && !room.running && (!s || !s.human)) {
        const b = h('button', 'seat-btn', s ? 'Remove bot' : '+ Add bot');
        b.onclick = () => send(s ? { t: 'removeBot', seat: i } : { t: 'addBot', seat: i });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    $('setTimer').value = String(room.settings.turnTime); $('setProfanity').checked = room.settings.profanity; $('setExpert').checked = !!room.settings.expertWords;
    $('setTimer').disabled = !isHost || room.running; $('setProfanity').disabled = !isHost; $('setExpert').disabled = !isHost || room.running;
    const filled = room.seats.filter(Boolean).length;
    $('startBtn').classList.toggle('hidden', !isHost || room.running);
    $('startBtn').disabled = filled < 2;
    $('startBtn').textContent = room.started ? 'New game ▶' : 'Start game ▶';
    $('backToGame').classList.toggle('hidden', !view);
    $('lobbyNote').textContent = isHost
      ? (filled < 2 ? 'Share the link or code with friends, or add a bot. You need at least 2 players.' : `Ready with ${filled} players. Press Start when everyone is here.`)
      : (room.running ? 'Game in progress…' : 'Waiting for the host to start the game…');
    renderMuteBar();
    if (!room.started) show('lobby');
    else if (room.running && screen !== 'game' && view) show('game');
    else if (screen === 'home') show(view ? 'game' : 'lobby');
    renderTop();
    if (view) renderScores();
    if (!localStorage.getItem('wp_seenHelp')) openHelp();
  }
  $('copyBtn').onclick = async () => { try { await navigator.clipboard.writeText($('shareLink').value); toast('Link copied - send it to your friends!'); } catch { $('shareLink').select(); toast('Press Ctrl+C / long-press to copy'); } };
  $('startBtn').onclick = () => send({ t: 'start' });
  $('backToGame').onclick = () => { if (view) show('game'); };
  $('leaveBtn').onclick = () => { if (confirm('Leave this room?')) send({ t: 'leave' }); };
  $('setTimer').onchange = (e) => send({ t: 'settings', turnTime: Number(e.target.value) });
  $('setProfanity').onchange = (e) => send({ t: 'settings', profanity: e.target.checked });
  $('setExpert').onchange = (e) => send({ t: 'settings', expertWords: e.target.checked });

  function renderMuteBar() {
    const bar = $('muteBar'); bar.replaceChildren();
    if (!room || room.you !== room.host) return;
    room.seats.forEach((s, i) => {
      if (!s || !s.human || i === room.you) return;
      const b = h('button', s.muted ? 'on' : '', `${s.muted ? '🔇 Unmute' : 'Mute'} ${s.label}`);
      b.onclick = () => send({ t: 'mute', seat: i, muted: !s.muted });
      bar.appendChild(b);
    });
  }

  // ------------------------------------------------------------ chat
  function addLine(node) {
    const log = $('chatLog'), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.appendChild(node);
    while (log.children.length > 200) log.removeChild(log.firstChild);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  function addChat(seat, label, text) {
    const row = h('div', 'chat-msg');
    const who = h('span', 'who'); who.appendChild(seatBadge(seat)); who.appendChild(h('span', '', `${label}:`));
    row.appendChild(who); row.appendChild(h('span', 'msg', text));
    addLine(row);
  }
  function addSystem(text) { addLine(h('div', 'chat-msg system', text)); }
  $('chatInput').addEventListener('input', () => { $('chatCount').textContent = `${$('chatInput').value.length}/300`; });
  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim(); if (!text) return;
    send({ t: 'chat', text: text.slice(0, 300) }); $('chatInput').value = ''; $('chatCount').textContent = '0/300';
  };

  // ------------------------------------------------------------ game state (local)
  let pending = new Map();   // tileId -> {r, c, letter?}
  let rackOrder = [];        // local display order of rack tile ids
  let selected = null;       // tile id picked for tap-to-place
  let swapMode = false, swapSel = new Set();
  let hinted = new Set(), lastTurnKey = null, lastPreview = null;
  let flash = null;          // server-confirmed problem: {cells:Set, mark, timer} - shown in red for ~2s
  let live = null;           // live client-side placement check of the pending tiles (soft hint)
  const rackTile = (id) => view && view.rack.find((t) => t.id === id);
  const myTurn = () => view && view.phase === 'play' && view.turn === view.you;
  function pLabel(i) { const p = view && view.players[i]; return !p ? `Seat ${i + 1}` : p.isBot ? `Bot ${i + 1}` : `${p.name} ${i + 1}`; }
  function pendingAt(r, c) { for (const [id, p] of pending) if (p.r === r && p.c === c) return id; return null; }

  function onState(v) {
    const prev = view; view = v;
    // keep local rack order; drop used tiles, append new ones
    const ids = v.rack.map((t) => t.id);
    rackOrder = rackOrder.filter((id) => ids.includes(id)).concat(ids.filter((id) => !rackOrder.includes(id)));
    for (const [id, p] of pending) if (!ids.includes(id) || v.board[p.r][p.c]) pending.delete(id);
    if (selected != null && !ids.includes(selected)) selected = null;
    if (v.phase !== 'play' || !v.canExchange) { swapMode = false; swapSel.clear(); }
    const turnKey = `${v.moveNo}:${v.turn}:${v.phase}`;
    if (turnKey !== lastTurnKey) {
      lastTurnKey = turnKey; clearPreview(); hinted.clear();
      if (prev && v.phase === 'play' && v.turn === v.you && prev.turn !== v.you) SFX.turn();
    }
    if (v.phase === 'over' && (!prev || prev.phase !== 'over')) { renderResult(); $('resultPopup').classList.remove('hidden'); SFX.end(); }
    if (v.phase === 'play' && prev && prev.phase === 'over') $('resultPopup').classList.add('hidden');
    if (v.phase === 'play' && screen !== 'game') show('game');
    if (!prev && screen !== 'game') show('game');
    renderGame();
  }

  const pendingTiles = () => [...pending.values()].map((p) => ({ r: p.r, c: p.c }));
  function liveCheck() {
    live = null;
    if (!view || view.phase !== 'play' || swapMode || !pending.size || !window.Placement) return;
    const res = window.Placement.checkPlacement(view.board, pendingTiles());
    if (!res.ok) live = { code: res.code, short: res.short, mark: res.mark, cells: new Set(res.cells.map(([r, c]) => r * SIZE + c)) };
  }
  function flashCells(cells, mark) {
    if (flash) clearTimeout(flash.timer);
    flash = { mark, cells: new Set((cells || []).map(([r, c]) => r * SIZE + c)) };
    flash.timer = setTimeout(() => { flash = null; if (view) renderBoard(); }, 2200);
  }
  function renderGame() {
    if (!view) return;
    liveCheck();
    renderTop(); renderScores(); renderBoard(); renderRack(); renderControls(); renderSide(); runTimer();
  }

  function renderTop() {
    const t = $('topInfo');
    if (!room) { t.textContent = ''; return; }
    if (!view || screen !== 'game') { t.textContent = `Room ${room.code}`; return; }
    t.textContent = `Room ${room.code} · ${view.phase === 'over' ? 'Game over' : myTurn() ? 'Your turn!' : `${pLabel(view.turn)}'s turn`}`;
  }

  function renderScores() {
    const box = $('scores'); box.replaceChildren();
    if (!view) return;
    view.players.forEach((p, i) => {
      if (!p) return;
      const card = h('div', 'score-card' + (view.phase === 'play' && view.turn === i ? ' turn' : ''));
      card.appendChild(seatBadge(i));
      const who = h('div', 'who');
      who.appendChild(h('span', 'pname', `${p.isBot ? '🤖 ' : ''}${pLabel(i)}${i === view.you ? ' (you)' : ''}`));
      const meta = [`${p.rackCount} tiles`];
      if (p.away) meta.push('away'); if (room && room.host === i && !p.isBot) meta.push('host');
      who.appendChild(h('span', 'meta', meta.join(' · ')));
      card.appendChild(who);
      card.appendChild(h('span', 'pts', String(p.score)));
      box.appendChild(card);
    });
    const bag = h('div', 'bag-card'); bag.appendChild(h('span', '', '👜 Tiles in bag')); bag.appendChild(h('span', 'n', String(view.bag)));
    box.appendChild(bag);
  }

  // board is built once, then updated
  const cells = [];
  (function buildBoard() {
    const b = $('board');
    for (let r = 0; r < SIZE; r++) {
      cells.push([]);
      for (let c = 0; c < SIZE; c++) {
        const p = PREMIUM[r][c];
        const cell = h('div', 'cell' + (p ? ` ${p}` : '') + (r === 7 && c === 7 ? ' star' : ''));
        cell.dataset.r = r; cell.dataset.c = c; cell.setAttribute('role', 'gridcell');
        cells[r].push(cell); b.appendChild(cell);
      }
    }
  })();
  function cellBase(r, c) {
    const cell = cells[r][c]; cell.replaceChildren();
    const p = PREMIUM[r][c];
    if (p && !(r === 7 && c === 7)) cell.appendChild(h('span', 'plabel', PLABEL[p]));
    return cell;
  }
  function renderBoard() {
    const recent = new Set((view.lastMove && view.lastMove.cells || []).map(([r, c]) => r * SIZE + c));
    const canDrop = myTurn() || view.phase === 'play';
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
      const cell = cellBase(r, c), L = view.board[r][c];
      cell.classList.toggle('can-drop', !L && canDrop && selected != null);
      cell.classList.remove('target');
      cell.classList.toggle('star', r === 7 && c === 7 && !L);
      const k = r * SIZE + c;
      const fl = flash && flash.cells.has(k) ? flash.mark : null;
      const lv = !fl && live && live.cells.has(k) ? live.mark : null;
      cell.classList.toggle('gap-flash', fl === 'squares');
      cell.classList.toggle('gap-soft', lv === 'squares');
      cell.classList.toggle('star-pulse', fl === 'star');
      cell.classList.toggle('star-soft', lv === 'star');
      if (L) {
        const t = makeTile(L); if (recent.has(k)) t.classList.add('recent');
        if (fl === 'word') t.classList.add('bad-word-tile');
        cell.appendChild(t); continue;
      }
      const pid = pendingAt(r, c);
      if (pid != null) {
        const p = pending.get(pid), rt = rackTile(pid);
        const t = makeTile(rt.letter === '?' ? (p.letter || '?').toLowerCase() : rt.letter, { blank: rt.letter === '?' });
        t.classList.add('pending'); if (hinted.has(pid)) t.classList.add('hinted');
        if (fl === 'tiles') t.classList.add('odd'); else if (fl === 'pulse') t.classList.add('odd-pulse'); else if (fl === 'word') t.classList.add('bad-word-tile'); else if (lv === 'tiles' || lv === 'pulse') t.classList.add('odd-soft');
        t.dataset.id = pid; t.dataset.from = 'board';
        cell.appendChild(t);
      }
    }
  }

  function renderRack() {
    const rack = $('rack'); rack.replaceChildren();
    for (const id of rackOrder) {
      const t = rackTile(id); if (!t) continue;
      const el = makeTile(t.letter);
      el.dataset.id = id; el.dataset.from = 'rack';
      if (pending.has(id)) el.classList.add('placed');
      if (selected === id) el.classList.add('sel');
      if (swapMode && swapSel.has(id)) el.classList.add('swap');
      el.setAttribute('aria-label', t.letter === '?' ? 'blank tile' : `${t.letter} tile`);
      rack.appendChild(el);
    }
    if (!view.rack.length) rack.appendChild(h('span', 'muted', view.phase === 'over' ? 'Game over' : 'No tiles'));
  }

  function renderControls() {
    const mine = myTurn(), has = pending.size > 0;
    $('controls').classList.toggle('hidden', swapMode);
    $('swapControls').classList.toggle('hidden', !swapMode);
    $('playBtn').disabled = !mine || !has;
    const hint = $('placeHint'), showingProblem = lastPreview && !lastPreview.valid;
    if (live && !showingProblem) { hint.textContent = `⚠ ${live.short}`; hint.classList.remove('hidden'); }
    else hint.classList.add('hidden');
    $('playBtn').title = live ? `Not quite yet: ${live.short}` : 'Play your word';
    $('playBtn').classList.toggle('warn', !!live);
    $('checkBtn').disabled = !has;
    $('recallBtn').disabled = !has;
    $('shuffleBtn').disabled = view.rack.length < 2;
    $('hintBtn').disabled = !mine;
    $('swapBtn').disabled = !mine || !view.canExchange;
    $('swapBtn').title = view.canExchange ? 'Exchange tiles (uses your turn)' : 'You can only swap while 7+ tiles are in the bag';
    $('passBtn').disabled = !mine;
    $('swapConfirm').textContent = swapSel.size ? `Swap ${swapSel.size} tile${swapSel.size > 1 ? 's' : ''}` : 'Swap tiles';
    $('swapConfirm').disabled = !swapSel.size;
    const st = $('status');
    st.classList.toggle('myturn', mine);
    if (view.phase === 'over') st.textContent = 'Game over!';
    else if (mine) st.textContent = swapMode ? 'Pick tiles to swap' : has ? (live || (lastPreview && !lastPreview.valid) ? 'Not quite yet - see the tip below 👇' : 'Press Check or Play ✔') : 'Your turn! Drag or tap tiles onto the board';
    else st.textContent = `Waiting for ${pLabel(view.turn)}…`;
  }

  function renderSide() {
    const lm = $('lastMove'); lm.replaceChildren();
    const m = view.lastMove;
    if (!m) lm.appendChild(h('span', 'muted', view.board.every((r) => r.every((x) => !x)) ? 'First word must cover the ★' : ''));
    else if (m.type === 'play') {
      lm.appendChild(h('span', '', `${pLabel(m.seat)}: `));
      lm.appendChild(h('span', 'words', m.words.map((w) => w.word).join(', ')));
      lm.appendChild(h('span', '', ` +${m.score}${m.bingo ? ' 🎉 BINGO' : ''}`));
    } else lm.appendChild(h('span', '', `${pLabel(m.seat)} ${m.type === 'pass' ? 'passed' : `swapped ${m.count} tile${m.count > 1 ? 's' : ''}`}`));
    const log = $('moveLog'); log.replaceChildren();
    view.log.slice().reverse().forEach((e) => {
      const li = h('li', e.bingo ? 'bingo' : '');
      if (e.seat != null) li.appendChild(seatBadge(e.seat));
      const txt = e.seat != null && view.players[e.seat] ? e.text.replace(view.players[e.seat].name, pLabel(e.seat)) : e.text;
      li.appendChild(h('span', '', txt));
      log.appendChild(li);
    });
    $('resultBtn').classList.toggle('hidden', view.phase !== 'over');
  }

  let timerRaf = null;
  function runTimer() {
    cancelAnimationFrame(timerRaf);
    const wrap = $('timerWrap'), bar = $('turnTimer');
    if (!view || view.phase !== 'play' || view.remainingMs == null) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    const total = view.players[view.turn] && view.players[view.turn].away ? 45000 : view.turnTime || 45000;
    const end = Date.now() + view.remainingMs;
    const step = () => {
      const left = Math.max(0, end - Date.now());
      bar.style.width = `${(100 * left) / total}%`; bar.classList.toggle('low', left < 15000);
      if (left > 0) timerRaf = requestAnimationFrame(step);
    };
    step();
  }

  // ------------------------------------------------------------ placing tiles
  let blankCb = null;
  (function buildLetters() {
    const g = $('letterGrid');
    for (let i = 0; i < 26; i++) {
      const L = String.fromCharCode(65 + i), b = h('button', '', L);
      b.type = 'button'; b.onclick = () => { $('blankPopup').classList.add('hidden'); const cb = blankCb; blankCb = null; if (cb) cb(L); };
      g.appendChild(b);
    }
  })();
  $('blankCancel').onclick = () => { $('blankPopup').classList.add('hidden'); blankCb = null; };

  function placeTile(id, r, c) {
    if (!view || view.phase !== 'play' || view.board[r][c] || pendingAt(r, c) != null) return false;
    const t = rackTile(id); if (!t) return false;
    const finish = (letter) => {
      if (view.board[r][c] || pendingAt(r, c) != null) return;
      pending.set(id, letter ? { r, c, letter } : { r, c });
      selected = null; hinted.delete(id); clearPreview(); SFX.place(); renderGame();
    };
    if (t.letter === '?') { blankCb = finish; $('blankPopup').classList.remove('hidden'); }
    else finish(null);
    return true;
  }
  function unplace(id) { pending.delete(id); hinted.delete(id); clearPreview(); renderGame(); }

  function tapRackTile(id) {
    if (swapMode) { swapSel.has(id) ? swapSel.delete(id) : swapSel.add(id); renderRack(); renderControls(); return; }
    if (pending.has(id)) return;
    selected = selected === id ? null : id; renderBoard(); renderRack();
  }
  function tapCell(r, c) {
    if (!view) return;
    const pid = pendingAt(r, c);
    if (pid != null) { unplace(pid); return; }
    if (selected != null) placeTile(selected, r, c);
    else if (!view.board[r][c] && view.phase === 'play' && !swapMode) {
      // convenience: tap an empty square first, then place the next unplaced tile you tap
      const firstFree = rackOrder.find((id) => !pending.has(id));
      if (firstFree == null) toast('No tiles left on your rack');
      else toast('Tap a tile on your rack first, then a square');
    }
  }

  // Pointer-based drag & drop (mouse + touch). A press without movement counts as a tap.
  let drag = null;
  function targetFromPoint(x, y) {
    const el = document.elementFromPoint(x, y); if (!el) return null;
    const cell = el.closest('.cell'); if (cell) return { cell, r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
    const rk = el.closest('#rack'); if (rk) { const t = el.closest('.tile'); return { rack: true, before: t && t.dataset.id != null ? Number(t.dataset.id) : null }; }
    return null;
  }
  function onDown(e) {
    const tile = e.target.closest('.tile[data-id]');
    if (!tile || !view || e.button > 0) return;
    const id = Number(tile.dataset.id);
    drag = { id, from: tile.dataset.from, x: e.clientX, y: e.clientY, started: false, el: tile, pid: e.pointerId, over: null };
    e.preventDefault();
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 || swapMode) return;
      drag.started = true;
      const t = rackTile(drag.id); const g = $('ghost');
      g.className = 'drag-ghost tile' + (t.letter === '?' ? ' blank' : '');
      g.replaceChildren(h('span', 'ltr', t.letter === '?' ? (pending.get(drag.id) && pending.get(drag.id).letter) || '' : t.letter), h('span', 'val', t.letter === '?' ? '' : String(VALUES[t.letter])));
      drag.el.classList.add('dragging-src'); selected = null;
    }
    const g = $('ghost'); g.style.left = `${e.clientX}px`; g.style.top = `${e.clientY}px`;
    const tg = targetFromPoint(e.clientX, e.clientY);
    if (drag.over) drag.over.classList.remove('target');
    drag.over = tg && tg.cell && !view.board[tg.r][tg.c] ? tg.cell : null;
    if (drag.over) drag.over.classList.add('target');
    e.preventDefault();
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    $('ghost').classList.add('hidden');
    if (d.over) d.over.classList.remove('target');
    d.el.classList.remove('dragging-src');
    if (!d.started) { // tap
      if (d.from === 'rack') tapRackTile(d.id);
      else { const p = pending.get(d.id); if (p) tapCell(p.r, p.c); }
      return;
    }
    const tg = targetFromPoint(e.clientX, e.clientY);
    if (tg && tg.cell) {
      const occupiedBy = pendingAt(tg.r, tg.c);
      if (occupiedBy === d.id) { renderGame(); return; }
      if (view.board[tg.r][tg.c] || occupiedBy != null) { renderGame(); return; }
      const old = pending.get(d.id);
      if (old) { pending.delete(d.id); const t = rackTile(d.id); if (t.letter === '?' && old.letter) { pending.set(d.id, { r: tg.r, c: tg.c, letter: old.letter }); clearPreview(); SFX.place(); renderGame(); return; } }
      if (!placeTile(d.id, tg.r, tg.c)) renderGame();
      return;
    }
    if (tg && tg.rack) {
      pending.delete(d.id);
      if (tg.before != null && tg.before !== d.id) { rackOrder = rackOrder.filter((x) => x !== d.id); rackOrder.splice(rackOrder.indexOf(tg.before), 0, d.id); }
      clearPreview(); renderGame(); return;
    }
    if (d.from === 'board') unplace(d.id); else renderGame();
  }
  document.addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', () => { if (drag) { drag.el.classList.remove('dragging-src'); $('ghost').classList.add('hidden'); drag = null; renderGame(); } });
  $('board').addEventListener('click', (e) => {
    if (e.target.closest('.tile')) return; // handled by pointer logic
    const cell = e.target.closest('.cell'); if (cell) tapCell(Number(cell.dataset.r), Number(cell.dataset.c));
  });

  // ------------------------------------------------------------ buttons
  const placementsMsg = () => [...pending].map(([id, p]) => (p.letter ? { id, r: p.r, c: p.c, letter: p.letter } : { id, r: p.r, c: p.c }));
  $('playBtn').onclick = () => { if (pending.size) { send({ t: 'act', a: 'play', placements: placementsMsg() }); SFX.play(); } };
  $('checkBtn').onclick = () => { if (pending.size) send({ t: 'act', a: 'preview', placements: placementsMsg() }); };
  $('recallBtn').onclick = () => { pending.clear(); hinted.clear(); clearPreview(); renderGame(); };
  $('shuffleBtn').onclick = () => {
    for (let i = rackOrder.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rackOrder[i], rackOrder[j]] = [rackOrder[j], rackOrder[i]]; }
    renderRack();
  };
  $('hintBtn').onclick = () => send({ t: 'act', a: 'hint' });
  $('passBtn').onclick = () => { if (confirm('Pass your turn?')) { pending.clear(); send({ t: 'act', a: 'pass' }); } };
  $('swapBtn').onclick = () => { pending.clear(); clearPreview(); selected = null; swapMode = true; swapSel.clear(); renderGame(); };
  $('swapCancel').onclick = () => { swapMode = false; swapSel.clear(); renderGame(); };
  $('swapConfirm').onclick = () => { if (swapSel.size) { send({ t: 'act', a: 'exchange', ids: [...swapSel] }); swapMode = false; swapSel.clear(); renderGame(); } };
  $('resultBtn').onclick = () => { renderResult(); $('resultPopup').classList.remove('hidden'); };

  function clearPreview() {
    lastPreview = null; $('preview').classList.add('hidden');
    if (flash) { clearTimeout(flash.timer); flash = null; }
  }
  // A server-confirmed problem with the move: explain it in the message box and flash the squares involved.
  function showProblem(p) {
    showPreview(p);
    SFX.bad();
  }
  function showPreview(p) {
    lastPreview = p; const box = $('preview'); box.replaceChildren(); box.classList.remove('hidden');
    box.classList.toggle('bad', !p.valid);
    if (p.valid) {
      box.appendChild(h('span', '', '✔ '));
      p.words.forEach((w, i) => { if (i) box.appendChild(h('span', '', ' + ')); box.appendChild(h('span', '', `${w.word} (${w.score})`)); });
      if (p.bingo) box.appendChild(h('span', '', ' + 50 bingo'));
      box.appendChild(h('b', '', ` = ${p.score} points`));
    } else if (p.invalid && p.invalid.length) {
      box.appendChild(h('span', 'icon', '✖ '));
      p.invalid.forEach((w, i) => {
        if (i) box.appendChild(h('span', '', i === p.invalid.length - 1 ? ' and ' : ', '));
        box.appendChild(h('span', 'bad-word', w));
      });
      box.appendChild(h('span', '', p.invalid.length > 1 ? " aren't in the dictionary." : " isn't in the dictionary."));
    } else {
      box.appendChild(h('span', 'icon', '✖ '));
      box.appendChild(h('span', '', p.error || 'Not a valid move'));
    }
    if (!p.valid && p.cells && p.cells.length) flashCells(p.cells, p.mark);
    if (view) { renderBoard(); renderControls(); }
  }
  function applyHint(hn) {
    if (!hn) { toast('No playable word found - try Swap or Pass.', 3500); return; }
    pending.clear(); hinted.clear(); clearPreview(); selected = null;
    for (const p of hn.placements) { pending.set(p.id, p.letter ? { r: p.r, c: p.c, letter: p.letter } : { r: p.r, c: p.c }); hinted.add(p.id); }
    toast(`💡 Try ${hn.words.join(', ')} for ${hn.score} points`, 3500);
    renderGame();
  }

  // ------------------------------------------------------------ game over
  function renderResult() {
    const res = view.result, card = $('resultCard'); card.replaceChildren();
    if (!res) return;
    const winners = res.winners.map(pLabel);
    card.appendChild(h('div', 'result-head', res.winners.includes(view.you) ? (winners.length > 1 ? '🤝 You tied for the win!' : '🏆 You win!') : `🏆 ${winners.join(' & ')} win${winners.length > 1 ? '' : 's'}!`));
    card.appendChild(h('p', 'muted', res.reason === 'out' ? `${pLabel(res.outSeat)} used their last tile and collects everyone's leftover tile points.` : 'Six scoreless turns in a row - everyone loses the value of their leftover tiles.'));
    const tbl = h('table', 'pay-table');
    const hr = h('tr'); ['Player', 'Leftover tiles', 'Adjust', 'Final'].forEach((x, i) => { const th = h('th', i > 1 ? 'num' : '', x); hr.appendChild(th); }); tbl.appendChild(hr);
    const seats = Object.keys(res.scores).map(Number).sort((a, b) => res.scores[b] - res.scores[a]);
    for (const s of seats) {
      const tr = h('tr', res.winners.includes(s) ? 'win' : '');
      const who = h('td'); const wd = h('span', 'who'); wd.appendChild(seatBadge(s)); wd.appendChild(h('span', '', pLabel(s))); who.appendChild(wd); tr.appendChild(who);
      tr.appendChild(h('td', '', (res.racks[s] || []).map((l) => (l === '?' ? '·' : l)).join(' ') || '-'));
      const a = res.adjust[s] || 0; tr.appendChild(h('td', 'num ' + (a > 0 ? 'plus' : a < 0 ? 'minus' : ''), a > 0 ? `+${a}` : String(a)));
      tr.appendChild(h('td', 'num', String(res.scores[s])));
      tbl.appendChild(tr);
    }
    card.appendChild(tbl);
    const row = h('div', 'row');
    if (room && room.you === room.host) {
      const b = h('button', 'big-btn primary', 'Play again ▶'); b.onclick = () => send({ t: 'start' }); row.appendChild(b);
      const l = h('button', 'big-btn', 'Seats & settings'); l.onclick = () => { $('resultPopup').classList.add('hidden'); show('lobby'); renderTop(); }; row.appendChild(l);
    } else row.appendChild(h('span', 'muted', 'Waiting for the host to start a new game…'));
    const hide = h('button', 'big-btn ghost', 'View board'); hide.onclick = () => $('resultPopup').classList.add('hidden'); row.appendChild(hide);
    card.appendChild(row);
  }

  function onEvent(e) {
    if (e.type === 'play' && (!session || e.seat !== session.seat)) (e.bingo ? SFX.bingo : SFX.play)();
    if (e.type === 'play' && e.bingo && session && e.seat === session.seat) SFX.bingo();
  }

  // ------------------------------------------------------------ boot
  if (session && urlRoom && session.code !== urlRoom) { session = null; localStorage.removeItem('wp_session'); }
  show('home');
  connect();
})();
