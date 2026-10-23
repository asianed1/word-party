'use strict';
// Headless-browser check of the "press Play" nudge (desktop + phone). Dev only: needs playwright-core + Chrome.
// Usage: PW=/tmp/pw/node_modules/playwright-core CHROME=/usr/bin/google-chrome node scripts/play-nudge-check.js [http://localhost:3100]
const { chromium } = require(process.env.PW || 'playwright-core');
const base = process.argv[2] || 'http://localhost:3100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL', m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  for (const [tag, opts] of [
    ['desktop', { viewport: { width: 1280, height: 860 } }],
    ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    console.log(tag);
    const ctx = await browser.newContext(opts); const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    const press = (sel) => (tag === 'phone' ? p.tap(sel) : p.click(sel));
    const st = () => p.evaluate(() => {
      const h = document.getElementById('placeHint'), b = document.getElementById('playBtn'), cs = getComputedStyle(b);
      return { hintVis: getComputedStyle(h).visibility === 'visible' && !h.classList.contains('hidden'), hint: h.textContent, ok: h.classList.contains('ok'),
        ready: b.classList.contains('ready'), anim: cs.animationName, shadow: cs.boxShadow,
        boardTop: Math.round(document.getElementById('board').getBoundingClientRect().top + scrollY),
        rackTop: Math.round(document.getElementById('rack').getBoundingClientRect().top + scrollY),
        sw: document.documentElement.scrollWidth, vw: innerWidth };
    });
    await p.goto(base + '/');
    await p.fill('#nameInput', tag === 'phone' ? 'Alice' : 'Sam'); await press('#createBtn');
    await p.waitForSelector('#lobby:not(.hidden)'); await press('#helpClose');
    await press('#seatList li:nth-child(2) .seat-btn');
    await p.waitForFunction(() => document.querySelector('#seatList li:nth-child(2)').textContent.includes('Bot 2'));
    await press('#startBtn');
    await p.waitForSelector('#status.myturn', { timeout: 20000 });
    const boardEmpty = await p.evaluate(() => !document.querySelector('#board .tile:not(.pending)'));

    const s0 = await st();
    ok(!s0.hintVis && !s0.ready, `${tag}: my turn, no tiles -> hint hidden, no pulse`);

    // invalid: two tiles with a gap
    const ids = await p.$$eval('#rack .tile[data-id]', (ts) => ts.filter((t) => t.getAttribute('aria-label') !== 'blank tile').map((t) => t.dataset.id));
    const [r0, c0] = boardEmpty ? [7, 7] : [1, 1];
    await press(`#rack .tile[data-id="${ids[0]}"]`); await press(`.cell[data-r="${r0}"][data-c="${c0}"]`);
    await press(`#rack .tile[data-id="${ids[1]}"]`); await press(`.cell[data-r="${r0}"][data-c="${c0 + 2}"]`);
    const s1 = await st();
    ok(s1.hintVis && /gap/.test(s1.hint) && !s1.ok && !s1.ready, `${tag}: invalid placement -> friendly error "${s1.hint.trim()}", no pulse`);

    // valid placement (via Hint, which also gives a known score)
    await press('#recallBtn');
    const s2 = await st();
    ok(!s2.hintVis && !s2.ready, `${tag}: after Recall -> hint hidden`);
    await press('#hintBtn');
    await p.waitForFunction(() => document.querySelectorAll('#board .tile.pending').length > 0, null, { timeout: 15000 });
    await sleep(900); // let the hinted-tile pulse finish and the Play glow reach its peak
    const s3 = await st();
    ok(s3.hintVis && s3.ok && /Looks good! Press Play ✔ to score \d+ points?\./.test(s3.hint), `${tag}: valid placement -> "${s3.hint.trim()}"`);
    ok(s3.ready && s3.anim === 'playglow', `${tag}: Play button pulses (${s3.anim})`);
    ok(s3.boardTop === s0.boardTop && s3.rackTop === s0.rackTop && s1.rackTop === s0.rackTop, `${tag}: no layout jump (board ${s0.boardTop}/${s3.boardTop}, rack ${s0.rackTop}/${s1.rackTop}/${s3.rackTop})`);
    ok(s3.sw <= s3.vw, `${tag}: no horizontal overflow`);
    await p.waitForSelector('#toast', { state: 'hidden', timeout: 6000 }); // the Hint toast would cover the buttons
    await p.evaluate(() => new Promise((r) => { const a = document.getAnimations().find((x) => x.animationName === 'playglow'); if (!a) return r(); const t = a.currentTime % 1600; setTimeout(r, (800 - t + 1600) % 1600); }));
    const clip = await p.evaluate((phone) => { const top = phone ? document.querySelector('#scores').getBoundingClientRect().top + scrollY - 8 : 0; const bot = document.querySelector('#controls').getBoundingClientRect().bottom + scrollY; return { x: 0, y: Math.max(0, top), width: innerWidth, height: bot - top + 16 }; }, tag === 'phone');
    if (tag === 'phone') await p.screenshot({ path: `screenshots/play-nudge-${tag}.png`, fullPage: true, clip });
    else { // grow the window so the whole table fits without the sticky top bar overlapping a scrolled capture
      await p.setViewportSize({ width: 1280, height: Math.max(860, Math.ceil(clip.height)) }); await p.evaluate(() => scrollTo(0, 0)); await sleep(1600);
      await p.screenshot({ path: `screenshots/play-nudge-${tag}.png` });
    }

    // moving a tile drops the known score but keeps the nudge if still valid in-line? Just check reduced motion here.
    await p.emulateMedia({ reducedMotion: 'reduce' });
    const s4 = await st();
    ok(s4.ready && s4.anim === 'none' && s4.shadow !== 'none', `${tag}: reduced motion -> static highlight (${s4.anim})`);
    await p.emulateMedia({ reducedMotion: 'no-preference' });

    // play it: turn passes to the bot -> nudge gone
    await press('#playBtn');
    await p.waitForFunction(() => !document.querySelector('#board .tile.pending'), null, { timeout: 10000 });
    const s5 = await st();
    ok(!s5.ready && (!s5.hintVis || !s5.ok), `${tag}: after Play -> no pulse, nudge gone`);
    await ctx.close();
  }
  ok(errors.length === 0, `no console/CSP errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails ? `PLAY NUDGE CHECK FAILED (${fails})` : 'PLAY NUDGE CHECK PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
