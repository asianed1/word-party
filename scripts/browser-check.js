'use strict';
// Headless-browser layout + interaction check (desktop + phone). Dev only: needs playwright-core and Chrome.
// Usage: PW=/tmp/pw/node_modules/playwright-core CHROME=/usr/bin/google-chrome node scripts/browser-check.js [http://localhost:3100]
const { chromium } = require(process.env.PW || 'playwright-core');
const base = process.argv[2] || 'http://localhost:3100';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL', m); if (!c) fails++; };

async function layout(page, tag) {
  return page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y + scrollY, w: b.width, h: b.height, bottom: b.bottom + scrollY, right: b.right }; };
    return {
      vw: innerWidth, sw: document.documentElement.scrollWidth,
      board: r('#board'), chat: r('#chat'), rack: r('#rack'), scores: r('#scores'), controls: r('#controls'), side: r('.side'),
      cell: r('.cell'), rackTile: r('#rack .tile'), badges: document.querySelectorAll('#scores .seatnum').length,
      buttonsOverflow: [...document.querySelectorAll('#controls .big-btn')].some((b) => b.getBoundingClientRect().right > innerWidth + 1),
    };
  });
}

async function waitTurn(page, ms = 20000) { await page.waitForSelector('#status.myturn', { timeout: ms }); }

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errors = [];
  const mk = async (opts, name) => {
    const ctx = await browser.newContext(opts); const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    return p;
  };
  const desk = await mk({ viewport: { width: 1280, height: 860 } }, 'desktop');
  const phone = await mk({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'phone');

  console.log('Desktop: create room');
  await desk.goto(base + '/');
  await desk.fill('#nameInput', 'Sam'); await desk.click('#createBtn');
  await desk.waitForSelector('#lobby:not(.hidden)');
  await desk.click('#helpClose');
  const code = (await desk.textContent('#lobbyCode')).trim();
  ok(/^[A-Z2-9]{6}$/.test(code), `room code ${code}`);
  await desk.screenshot({ path: 'screenshots/desktop-lobby.png' });

  console.log('Phone: join via share link');
  await phone.goto(`${base}/?room=${code}`);
  ok((await phone.inputValue('#codeInput')) === code, 'share link pre-fills the room code');
  await phone.fill('#nameInput', 'Alice'); await phone.tap('#joinBtn');
  await phone.waitForSelector('#lobby:not(.hidden)');
  await phone.tap('#helpClose');
  await desk.waitForFunction(() => document.querySelectorAll('#seatList li').length === 4 && document.querySelector('#seatList li:nth-child(2)').textContent.includes('Alice'));
  // add a bot to seat 3
  await desk.click('#seatList li:nth-child(3) .seat-btn');
  await desk.waitForFunction(() => document.querySelector('#seatList li:nth-child(3)').textContent.includes('Bot 3'));
  ok(true, 'host added Bot 3 from the lobby');
  const pl = await layout(phone);
  ok(pl.sw <= pl.vw, `phone lobby has no horizontal scroll (${pl.sw} <= ${pl.vw})`);
  await phone.screenshot({ path: 'screenshots/phone-lobby.png', fullPage: true });

  await desk.click('#startBtn');
  await desk.waitForSelector('#game:not(.hidden)'); await phone.waitForSelector('#game:not(.hidden)');
  await sleep(400);

  for (const [p, tag] of [[desk, 'desktop'], [phone, 'phone']]) {
    const L = await layout(p);
    ok(L.sw <= L.vw, `${tag}: no horizontal scroll (${L.sw} <= ${L.vw})`);
    ok(Math.abs(L.board.w - L.board.h) < 2, `${tag}: board is square (${Math.round(L.board.w)}px)`);
    ok(L.board.right <= L.vw + 1, `${tag}: board fits the screen`);
    ok(L.chat.y > L.board.bottom && L.chat.y > L.rack.bottom, `${tag}: chat is below the board and rack`);
    ok(L.badges >= 3, `${tag}: scoreboard shows seat badges (${L.badges})`);
    ok(L.cell.w >= (tag === 'phone' ? 20 : 30), `${tag}: board squares are ${L.cell.w.toFixed(1)}px wide`);
    ok(L.rackTile.w >= (tag === 'phone' ? 40 : 48), `${tag}: rack tiles are ${L.rackTile.w.toFixed(1)}px wide`);
    ok(!L.buttonsOverflow, `${tag}: control buttons stay on screen`);
    ok((await p.$$('#rack .tile')).length === 7, `${tag}: 7 tiles on rack`);
    if (tag === 'phone') ok(L.scores.bottom <= L.board.y + 1, 'phone: scoreboard above the board');
    else ok(L.side.x > L.board.right - 1, 'desktop: move log beside the board');
  }

  // Play a few human turns on whichever device is up, using the UI.
  const pages = { desktop: desk, phone };
  let played = 0, tapTested = false, dragTested = false;
  const deadline = Date.now() + 90000;
  while (played < 4 && Date.now() < deadline) {
    let who = null;
    for (const [tag, p] of Object.entries(pages)) if (await p.$('#status.myturn')) who = tag;
    if (!who) { await sleep(300); continue; }
    const p = pages[who];
    const click = (sel) => (who === 'phone' ? p.tap(sel) : p.click(sel));
    const before = Number(await p.evaluate(() => [...document.querySelectorAll('#scores .score-card')].find((c) => c.textContent.includes('(you)')).querySelector('.pts').textContent));
    if (!tapTested && who === 'phone') {
      // tap-to-place: tap a non-blank rack tile, then an empty square; then Recall
      const idx = await p.evaluate(() => [...document.querySelectorAll('#rack .tile')].findIndex((t) => !t.classList.contains('blank')));
      await p.locator('#rack .tile').nth(idx).tap();
      const empty = await p.evaluate(() => { const cs = [...document.querySelectorAll('.cell')]; return cs.findIndex((c) => !c.querySelector('.tile')); });
      await p.locator('.cell').nth(empty).tap();
      ok(await p.locator('.cell .tile.pending').count() === 1, 'phone: tap tile + tap square places a tile');
      await click('#recallBtn');
      ok(await p.locator('.cell .tile.pending').count() === 0, 'phone: Recall returns tiles to the rack');
      tapTested = true;
    }
    if (!dragTested && who === 'desktop') {
      const idx = await p.evaluate(() => [...document.querySelectorAll('#rack .tile')].findIndex((t) => !t.classList.contains('blank')));
      const src = await p.locator('#rack .tile').nth(idx).boundingBox();
      const empty = await p.evaluate(() => [...document.querySelectorAll('.cell')].findIndex((c) => !c.querySelector('.tile')));
      const dst = await p.locator('.cell').nth(empty).boundingBox();
      await p.mouse.move(src.x + src.width / 2, src.y + src.height / 2); await p.mouse.down();
      await p.mouse.move(src.x + 30, src.y - 30, { steps: 4 }); await p.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 8 }); await p.mouse.up();
      ok(await p.locator('.cell .tile.pending').count() === 1, 'desktop: drag & drop places a tile on the board');
      await click('#recallBtn');
      dragTested = true;
    }
    await click('#hintBtn');
    await p.waitForFunction(() => document.querySelectorAll('.cell .tile.pending').length > 0 || /No playable/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    if (await p.locator('.cell .tile.pending').count() === 0) { await click('#passBtn'); continue; }
    await click('#checkBtn');
    await p.waitForSelector('#preview:not(.hidden)');
    const pv = await p.textContent('#preview');
    ok(/points/.test(pv), `${who}: Check shows "${pv.trim()}"`);
    const pts = Number((pv.match(/= (\d+) points/) || [])[1]);
    if (played === 0) await p.screenshot({ path: `screenshots/${who}-check.png`, fullPage: true });
    await click('#playBtn');
    await p.waitForFunction((b) => Number([...document.querySelectorAll('#scores .score-card')].find((c) => c.textContent.includes('(you)')).querySelector('.pts').textContent) !== b, before, { timeout: 8000 });
    const afterPts = Number(await p.evaluate(() => [...document.querySelectorAll('#scores .score-card')].find((c) => c.textContent.includes('(you)')).querySelector('.pts').textContent));
    ok(afterPts - before === pts, `${who}: played for ${pts} points (score ${before} → ${afterPts})`);
    ok(await p.locator('.cell .tile.recent').count() > 0, `${who}: last move is highlighted`);
    played++;
  }
  ok(played >= 2, `played ${played} human turns through the UI`);
  ok(dragTested && tapTested, 'tested drag-and-drop (desktop) and tap-to-place (phone)');

  // chat both ways, labels with seat numbers
  await desk.fill('#chatInput', 'Nice word! <b>bold?</b>'); await desk.press('#chatInput', 'Enter');
  await phone.waitForFunction(() => [...document.querySelectorAll('.chat-msg')].some((m) => m.textContent.includes('Sam 1:') && m.textContent.includes('<b>bold?</b>')));
  ok(true, 'phone sees "Sam 1: Nice word! <b>bold?</b>" as plain text');
  ok(await phone.locator('.chat-msg b').count() === 0, 'no HTML injected into chat');
  await phone.fill('#chatInput', 'thanks'); await phone.tap('#chatForm button');
  await desk.waitForFunction(() => [...document.querySelectorAll('.chat-msg')].some((m) => m.textContent.includes('Alice 2:')));
  ok(true, 'desktop sees "Alice 2: thanks"');

  // help overlay + sound toggle
  await phone.tap('#helpBtn'); await phone.waitForSelector('#helpPopup:not(.hidden)');
  const hb = await phone.locator('#helpPopup .popup-card').boundingBox();
  ok(hb.width <= 390 && hb.x >= 0, 'phone: How-to-play overlay fits the screen');
  await phone.screenshot({ path: 'screenshots/phone-help.png' });
  await phone.tap('#helpClose');
  await desk.click('#soundBtn'); ok((await desk.textContent('#soundBtn')) === '🔇', 'sound toggle works');

  await sleep(300);
  await desk.screenshot({ path: 'screenshots/desktop-game.png', fullPage: true });
  await phone.screenshot({ path: 'screenshots/phone-game.png', fullPage: true });
  await phone.screenshot({ path: 'screenshots/phone-game-viewport.png' });

  // refresh on phone keeps the seat
  await phone.reload(); await phone.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  ok((await phone.locator('#rack .tile').count()) === 7, 'phone: page refresh rejoins the same seat with the rack');

  // Game-over screen: new room with two humans who pass 3 times each (6 scoreless turns).
  console.log('Game over flow');
  for (const p of [desk, phone]) { p.on('dialog', (d) => d.accept()); }
  await desk.evaluate(() => localStorage.removeItem('wp_session')); await phone.evaluate(() => localStorage.removeItem('wp_session'));
  await desk.goto(base + '/'); await desk.fill('#nameInput', 'Sam'); await desk.click('#createBtn');
  await desk.waitForSelector('#lobby:not(.hidden)');
  const code2 = (await desk.textContent('#lobbyCode')).trim();
  await phone.goto(`${base}/?room=${code2}`); await phone.fill('#nameInput', 'Alice'); await phone.tap('#joinBtn');
  await desk.waitForFunction(() => document.querySelector('#seatList li:nth-child(2)').textContent.includes('Alice'));
  await desk.click('#startBtn');
  for (let i = 0; i < 6; i++) {
    let p = null;
    for (let k = 0; k < 50 && !p; k++) { for (const q of [desk, phone]) if (await q.$('#status.myturn')) p = q; if (!p) await sleep(100); }
    if (!p) break;
    await (p === phone ? p.tap('#passBtn') : p.click('#passBtn'));
    await p.waitForFunction(() => !document.querySelector('#status.myturn'));
  }
  await phone.waitForSelector('#resultPopup:not(.hidden)', { timeout: 5000 });
  await desk.waitForSelector('#resultPopup:not(.hidden)', { timeout: 5000 });
  ok(/scoreless/i.test(await phone.textContent('#resultCard')), 'game ends after 6 scoreless turns with a final-scores overlay');
  const rc = await phone.locator('#resultCard').boundingBox();
  ok(rc.x >= 0 && rc.x + rc.width <= 390, 'phone: final-scores overlay fits the screen');
  ok(await desk.locator('#resultCard button', { hasText: 'Play again' }).count() === 1, 'host gets a Play again button');
  await phone.screenshot({ path: 'screenshots/phone-gameover.png' });
  await desk.click('#resultCard button:has-text("Play again")');
  await phone.waitForSelector('#resultPopup.hidden', { state: 'attached', timeout: 5000 });
  ok((await phone.locator('#rack .tile').count()) === 7, 'Play again deals a fresh game');

  const real = errors.filter((e) => !/favicon/.test(e));
  ok(real.length === 0, `no console/CSP errors${real.length ? ': ' + real.join(' | ') : ''}`);
  await browser.close();
  console.log(fails ? `BROWSER CHECK: ${fails} FAILED` : 'BROWSER CHECK PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
