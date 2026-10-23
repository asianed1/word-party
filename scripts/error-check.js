'use strict';
// Headless-browser check of the friendly placement errors (desktop + phone). Dev only: needs playwright-core + Chrome.
// Reproduces the reported L-shape (blank-as-O + S across, then T, E, E down), plus a gap and (if possible) the star rule.
// Usage: PW=/tmp/pw/node_modules/playwright-core CHROME=/usr/bin/google-chrome node scripts/error-check.js [http://localhost:3100]
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
    console.log(`${tag}: L-shape`);
    const ctx = await browser.newContext(opts); const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    const press = (sel) => (tag === 'phone' ? p.tap(sel) : p.click(sel));
    await p.goto(base + '/');
    await p.fill('#nameInput', tag === 'phone' ? 'Alice' : 'Sam'); await press('#createBtn');
    await p.waitForSelector('#lobby:not(.hidden)'); await press('#helpClose');
    await press('#seatList li:nth-child(2) .seat-btn');
    await p.waitForFunction(() => document.querySelector('#seatList li:nth-child(2)').textContent.includes('Bot 2'));
    await press('#startBtn');
    await p.waitForSelector('#status.myturn', { timeout: 20000 });
    const boardEmpty = await p.evaluate(() => !document.querySelector('#board .tile:not(.pending)'));

    // Choose an empty area: around the star if the board is empty, otherwise the top-left corner.
    const [r0, c0] = boardEmpty ? [7, 6] : [1, 1];
    const cells = [[r0, c0], [r0, c0 + 1], [r0 + 1, c0 + 1], [r0 + 2, c0 + 1], [r0 + 3, c0 + 1]]; // O S across, T E E down
    // Put a blank first (as "O") if the rack has one, like the user's move.
    const order = await p.evaluate(() => {
      const ts = [...document.querySelectorAll('#rack .tile[data-id]')].map((t) => ({ id: t.dataset.id, blank: t.getAttribute('aria-label') === 'blank tile' }));
      return ts.filter((t) => t.blank).concat(ts.filter((t) => !t.blank)).map((t) => t.id);
    });
    for (let i = 0; i < cells.length; i++) {
      const [r, c] = cells[i];
      await press(`#rack .tile[data-id="${order[i]}"]`);
      await press(`.cell[data-r="${r}"][data-c="${c}"]`);
      if (await p.isVisible('#blankPopup')) await press('#letterGrid button:has-text("O")');
    }
    await sleep(150);
    const liveHint = await p.textContent('#placeHint');
    ok(await p.isVisible('#placeHint') && /one straight line/.test(liveHint), `${tag}: live hint before Play: "${liveHint.trim()}"`);
    ok(/Not quite yet/.test(await p.getAttribute('#playBtn', 'title')), `${tag}: Play button tooltip explains the problem`);
    ok(await p.$(`.cell[data-r="${r0}"][data-c="${c0}"] .tile.odd-soft`) != null, `${tag}: odd tile softly marked while placing`);
    const softCount = await p.$$eval('.tile.odd-soft', (e) => e.length);
    ok(softCount === 1, `${tag}: only the out-of-line tile is marked (${softCount})`);
    await p.screenshot({ path: `screenshots/error-lshape-live-${tag}.png` });

    await press('#playBtn');
    await p.waitForSelector('#preview.bad:not(.hidden)');
    const msg = (await p.textContent('#preview')).trim();
    ok(/see the tip below/.test(await p.textContent('#status')), `${tag}: status line points to the tip`);
    ok(/single straight line, across OR down/.test(msg) && /Recall/.test(msg) && !/one row or one column/.test(msg), `${tag}: friendly message: "${msg.slice(0, 90)}…"`);
    ok(await p.$(`.cell[data-r="${r0}"][data-c="${c0}"] .tile.odd`) != null, `${tag}: odd-one-out tile flashes red after Play`);
    ok(!(await p.isVisible('#placeHint')), `${tag}: soft hint hidden while the full message shows (no duplicate)`);
    const box = await p.evaluate(() => {
      const e = document.getElementById('preview'), b = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { font: parseFloat(cs.fontSize), right: b.right, vw: innerWidth, sw: document.documentElement.scrollWidth, color: cs.color, bg: cs.backgroundColor };
    });
    ok(box.font >= 15 && box.right <= box.vw + 1 && box.sw <= box.vw, `${tag}: message box readable (${box.font}px, fits ${Math.round(box.right)}<=${box.vw})`);
    const clip = await p.evaluate(() => { const top = document.querySelector('#scores').getBoundingClientRect().top + scrollY; const bot = document.querySelector('#controls').getBoundingClientRect().bottom + scrollY; return { x: 0, y: Math.max(0, top - 8), width: innerWidth, height: bot - top + 16 }; });
    if (tag === 'phone') await p.screenshot({ path: `screenshots/error-lshape-${tag}.png`, fullPage: true, clip });
    else { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: `screenshots/error-lshape-${tag}.png` }); }
    await sleep(2500);
    ok((await p.$$('.tile.odd')).length === 0, `${tag}: red flash clears after ~2s`);

    console.log(`${tag}: gap`);
    await press('#recallBtn');
    // tiles either side of an empty square (on move 1 the left tile sits on the star)
    await press(`#rack .tile[data-id="${order[1]}"]`); await press(`.cell[data-r="${r0}"][data-c="${c0 + 1}"]`);
    await press(`#rack .tile[data-id="${order[2]}"]`); await press(`.cell[data-r="${r0}"][data-c="${c0 + 3}"]`);
    ok(/gap/.test(await p.textContent('#placeHint')) && (await p.$(`.cell.gap-soft[data-r="${r0}"][data-c="${c0 + 2}"]`)) != null, `${tag}: live gap hint + empty square outlined`);
    await press('#checkBtn');
    await p.waitForSelector('#preview.bad:not(.hidden)');
    ok(/gap/.test(await p.textContent('#preview')) && (await p.$(`.cell.gap-flash[data-r="${r0}"][data-c="${c0 + 2}"]`)) != null, `${tag}: Check explains the gap and flashes the empty square`);
    await p.screenshot({ path: `screenshots/error-gap-${tag}.png` });

    if (boardEmpty) {
      console.log(`${tag}: star`);
      await press('#recallBtn');
      await press(`#rack .tile[data-id="${order[1]}"]`); await press('.cell[data-r="2"][data-c="2"]');
      await press(`#rack .tile[data-id="${order[2]}"]`); await press('.cell[data-r="2"][data-c="3"]');
      ok(/star/.test(await p.textContent('#placeHint')), `${tag}: live hint mentions the ★ star`);
      await press('#playBtn');
      await p.waitForSelector('#preview.bad:not(.hidden)');
      ok(/★ star/.test(await p.textContent('#preview')) && (await p.$('.cell.star-pulse[data-r="7"][data-c="7"]')) != null, `${tag}: first-move message + star pulses`);
      await p.screenshot({ path: `screenshots/error-star-${tag}.png` });
    } else {
      console.log(`${tag}: not connected`);
      await press('#recallBtn');
      await press(`#rack .tile[data-id="${order[1]}"]`); await press('.cell[data-r="13"][data-c="1"]');
      await press(`#rack .tile[data-id="${order[2]}"]`); await press('.cell[data-r="13"][data-c="2"]');
      ok(/touch tiles already on the board/.test(await p.textContent('#placeHint')), `${tag}: live hint says the word must touch existing tiles`);
      await press('#playBtn');
      await p.waitForSelector('#preview.bad:not(.hidden)');
      ok(/join onto tiles/.test(await p.textContent('#preview')) && (await p.$$('.tile.odd-pulse')).length === 2, `${tag}: not-connected message + placed tiles pulse`);
      await p.screenshot({ path: `screenshots/error-connect-${tag}.png` });
    }
    await ctx.close();
  }
  ok(errors.length === 0, `no console/CSP errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(fails ? `ERROR CHECK FAILED (${fails})` : 'ERROR CHECK PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
