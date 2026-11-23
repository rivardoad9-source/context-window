# CONTEXT WINDOW

A tiny browser game built from one prompt, for the make.fun bounty
*"The agent builds a game from one prompt"*.

You are the cursor inside a chat window. Cyan **context tokens** drift in —
collect them to score and to refill your context bar. Magenta **hallucination
blobs** chase you and burn context on contact. When the context bar empties the
window collapses and the run is over. Runs last 45 seconds.

Everything lives in two files: no build step, no dependencies, no network, no
assets. Open `index.html` in a browser and play.

```
game.js      the whole simulation and renderer (plain script, exposes window.CW)
index.html   one page, inline styles, requestAnimationFrame loop, input handling
```

## How to play

- **Move:** arrow keys or WASD, or just move the mouse / a finger — the cursor
  follows the pointer.
- **Restart:** `R`, or click / tap once the window has collapsed.
- **Score:** 10 points per token, times a combo multiplier that builds while you
  keep collecting tokens within 2 seconds of each other.
- **Danger:** context drains all run long, faster as the run goes on. Every
  hallucination hit takes a bigger bite. Best score lives in `localStorage`.

## Run it locally

```sh
open index.html          # macOS
xdg-open index.html      # Linux
```

Or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
```

## The engine is deterministic

The simulation is seeded and stepped at a fixed 1/120 s, so a seed plus a
sequence of `step(dt, input)` calls always produces the same run — the browser
and the offline renderer share it.

```js
CW.create(seed)      // reset, returns the state object
CW.step(dt, input)   // input: { ax, ay }, each -1..1 (analog)
CW.draw(ctx)         // paints the current state at any canvas size (9:16)
CW.state()           // live state: score, context, tokens, hazards, combo…
```

`index.html` drives that with `requestAnimationFrame`. The entry's video stepped
the same `game.js` at a fixed 1/60 s with a scripted autopilot, so the footage is
the real game, not a mock-up.

## What `main.ts` does

The entry for this bounty is the X post itself, so the program's only job is to
copy `POST.json` from `MAKEFUN_BOT_DIR` (default `/bot`) to
`MAKEFUN_OUTPUT_DIR` (default `/output`), where the gate reads the post's
address. Node 22, standard library only:

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

## The entry

- Post text carries the play code `makefun-wicker-glove-lentil` and
  https://make.fun/bounty/post-x-the-agent-builds-a-game-from-20261122-1709
- The video ends on make.fun's 9:16 referral end card with `a8dvmwfr` in its
  field
- Wallet: `.makefun/owner.json`
- `POST.json` holds the post's address — a placeholder until the post is up,
  and the gate refuses a placeholder on purpose

## Licence

MIT — see `LICENSE`.
