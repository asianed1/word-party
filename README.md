# Word Party 🔤

<p><img src="public/img/crow-new-media-logo.png" alt="Crow New Media" width="240"></p>

**Published by Crow New Media.** © 2026 Crow New Media.

A friendly online **crossword tile game for 2-4 players**. Make a private room, share the link,
add bots if you are short of players, and chat while you play. Works on desktop and phones.

> Word Party is an independent project. It is not affiliated with, endorsed by or connected to any
> commercial word-game brand.

## Run it

```bash
npm ci            # or: npm install
npm start         # http://localhost:3000  (PORT env var to change)
npm test          # unit tests + headless 2/3/4-bot game simulations
npm run smoke     # 2 WebSocket clients against a running server (default http://localhost:3000)
node scripts/smoke.js https://your-host     # smoke test a deployed copy
# optional layout check (needs playwright-core + Chrome):
PW=/path/to/playwright-core CHROME=/usr/bin/google-chrome node scripts/browser-check.js http://localhost:3000
PW=/path/to/playwright-core CHROME=/usr/bin/google-chrome node scripts/error-check.js http://localhost:3000  # placement-error UX
```

Node 18+. Dependencies: `express`, `ws`, `helmet`. No database: rooms live in memory.

## How to play

* Everyone gets **7 letter tiles**. On your turn, make a word on the 15×15 board crossword-style.
* Place tiles by **dragging** them, or **tap a tile then tap a square**. Tap a placed tile to take it back.
* New tiles go in **one row or one column**, with no gaps, and must **touch tiles already on the board**.
  The first word must cover the **★ centre** (which doubles it).
* **Score** = letter values of every word you formed (the main word and any cross-words).
  Premium squares only count when you cover them: 2×/3× letter, 2×/3× word. Using all 7 tiles = **+50 bingo**.
* **Blank tiles** can be any letter (you pick it) and score 0.
* Buttons: **Check** (validate + show score before committing), **Play**, **Recall**, **Shuffle**,
  **Hint** (suggests the best move it finds), **Swap** (exchange 1-7 tiles; only while the bag has 7+), **Pass**.
* **Game end:** the bag is empty and a player uses their last tile (they gain everyone else's leftover
  tile values, others lose theirs), or **6 scoreless turns in a row** (everyone loses their own leftover values).
* Optional **turn timer** (1/2/3/5 min, off by default) - running out passes your turn.
* 100 tiles, standard English distribution and values (incl. 2 blanks), standard premium-square layout.

## Friendly placement errors

Placement rules live in `public/placement.js`, shared by the server (authoritative) and the browser (live hints).
The server answers a bad move with a code, the offending squares and a plain-English message:

| Code | When | What lights up |
|---|---|---|
| `NOT_IN_LINE` | tiles placed both across and down | the odd-one-out tiles (those outside the line holding the most new tiles) |
| `GAP` | an empty square between your tiles | the empty square(s) |
| `FIRST_CENTER` | first word misses the ★ | the star pulses |
| `NOT_CONNECTED` | word doesn't touch existing tiles | your placed tiles pulse |
| `INVALID_WORDS` | e.g. "ZORP isn't in the dictionary." | the squares of each bad word |

While you place tiles the same checks run in the browser and show a soft tip (and a Play-button tooltip) before you press Play.

## Rooms, bots and reconnecting

* **Create** a room → 6-character code + share link (`/?room=CODE`). 2-4 seats.
* The host can **add/remove bots** in empty seats and **start once 2+ seats are filled**.
* **Bots** use the same move generator as Hint and play the highest-scoring move (they avoid wasting a blank
  on a small gain); with no move they swap awkward tiles or pass.
* **Refresh / lost connection:** the browser keeps a secret session token and silently rejoins your seat.
  While you are away your turns are skipped after 45 s.
* A friend arriving mid-game can **take over a bot's seat**. If a player leaves mid-game, a bot takes over.
* **Play again** after a game (host) keeps the same seats; "Seats & settings" goes back to the lobby.

## Chat

* Below the board on every screen size. Each message is labelled with **name + seat number**
  (e.g. "Sam 1", "Alice 2", "Bot 3"), matching the numbered badges on the scoreboard.
* Room-scoped, never stored, max 300 characters, max 5 messages per 5 seconds per player.
* Rendered as plain text only (`textContent`, never `innerHTML`), control/bidi characters stripped.
* Profanity filter (host toggle, on by default) and host **mute** per player.

## Architecture

```
server/
  index.js    Express + helmet (CSP etc.), static files, WebSocket upgrade with same-origin check, per-IP limits
  rooms.js    rooms, seats, session tokens, payload validation, chat, host controls
  game.js     server-authoritative game state: turns, play/exchange/pass, timers, end game, per-seat views
  rules.js    tile bag, premium layout, placement validation and scoring
  movegen.js  anchor-based move generator over the word trie with cross-checks (bots + Hint)
  dict.js     compact typed-array trie built from data/enable1.txt (+ data/extra-words.txt)
  chat.js     text cleaning, profanity filter, rate limiter
public/       index.html, style.css, app.js (vanilla JS, no build step)
test/         node:test unit tests + headless bot games
scripts/      smoke.js (2 socket clients), browser-check.js (desktop + phone headless Chrome)
```

* The **server is authoritative**: clients only send intents (`{t:'act', a:'play', placements:[{id,r,c,letter?}]}`).
  Every formed word is checked against the dictionary on the server; invalid words are named in the reply.
  Players only ever receive their own rack.
* Messages are JSON, max 4 KB, whitelisted keys and per-type validation; anything else is rejected.
* Every in-room message re-validates the seat's session token (48 hex chars, compared in constant time).
* The dictionary (~168k words) loads in ~0.1 s into a trie; move generation takes a few ms to ~100 ms.

## Security notes

* Serve over **HTTPS**; the client automatically uses **WSS** on HTTPS pages. Render/most PaaS terminate TLS for you.
* helmet sets CSP (`default-src 'self'`, no inline scripts), `X-Content-Type-Options`, `frame-ancestors 'none'`, etc.
* WebSocket upgrades must come from the same origin (blocks cross-site WebSocket hijacking), only on `/ws`.
* Limits: 10 rooms/min and 20 sockets per IP, 2000 sockets total, 30 messages/3 s per socket,
  3 hints/10 s, 500 rooms; idle rooms are removed after 30 minutes.
* `trust proxy` is `1` on Render (`RENDER` env var), loopback otherwise. On Render, per-IP limits use the
  client address reported by the proxy (X-Forwarded-For), which a client could spoof - that only weakens the
  soft per-IP limits; the global caps still apply.

## Deploying

Any Node host works: `npm ci --omit=dev && npm start`, listen on `$PORT`. On Render: a free web service,
runtime Node, build `npm ci --omit=dev`, start `npm start`, env `NODE_ENV=production`.
Note: free instances sleep when idle (first visit can take ~30-60 s) and rooms are lost on restart.

## Word list

`data/enable1.txt` is the **ENABLE** word list, which is in the **public domain**; `data/extra-words.txt` adds 11
common modern two-letter words (QI, ZA, …) that ENABLE predates. See `data/README.md`.
Some words accepted in commercial tournament lists are not in ENABLE, and vice versa.

## License

Code: MIT (see LICENSE). Word list: public domain.
