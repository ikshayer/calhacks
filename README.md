# Simthetic — find out who shares it before you post it

Upload a campaign video and watch a town of 300 simulated residents decide, person
by person, whether to watch it through, like it, comment or share. Shares spread to
each resident's connections, round by round, on a 3D island. You see what to change
privately, while there is still time to re-cut.

Small teams get one shot at a campaign video. A weak post costs a week and a budget,
and a stealth company can't test unreleased work in public at all. Our demo customer,
Jim at The Giving Garden, needed volunteers for a harvest, got under half, and
harvested food couldn't be distributed.

**Every number on screen comes from code. Claude only explains it.** These are model
outputs, not measurements or forecasts of real engagement — see
[Honesty and limits](#honesty-and-limits).

---

## What it does

- **Test a video.** Upload a cut and it is analysed privately from its frames and
  speech. The town then decides, person by person, what to do with it, and shares
  cascade through the sharing graph on the island.
- **See the results.** How many residents it reached, actions across 200 trials, and
  which audience groups responded. Click any resident to see their personality,
  connections and predicted chance of each action.
- **Ask the Assistant.** It summarises the report with timestamped feedback and
  rewritten hooks, and answers follow-ups grounded in that specific simulation —
  including questions about individual residents.
- **A/B test.** Run two cuts against the same audience and the same starting
  exposure. A winner is called only when the gap falls outside the simulation's own
  trial range; otherwise the result is "too close to call".
- **No video yet?** Describe an idea and the town answers whether they'd go, with
  expected visits and shares.
- **From ASI:One.** Fetch.ai agents let you run the same simulation from an ASI:One
  chat.

---

## Quick start — no API keys, no backend

The whole simulation also runs in the browser. This is the fastest way to see the app,
and it needs nothing but Node.

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Sign in with any well-formed email and a 6+ character password — authentication is
local-only. Then pick a demo video on the campaigns page.

Leaving `VITE_DATA_SOURCE` unset selects the in-browser mock driver, which generates
the audience, runs the cascade and writes a report from a fixed seed. Its assistant
replies are clearly labelled scripted text, and **idea testing and live AI chat
require the live backend** (the mock says so explicitly rather than faking it).

Requires **Node 22.18+**.

---

## Full setup — the live backend

Three pieces run together:

| Piece              | What it is                                                     | Where it runs                            |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------- |
| SpacetimeDB module | `backend/spacetime` — tables, reducers, the sharing cascade | Maincloud or a local `spacetime start` |
| Node worker        | `backend/worker` — ffmpeg, Whisper, Claude, JEV, Apify      | Your machine (connects outbound)         |
| Frontend           | `frontend` — React + react-three-fiber island               | Vite dev server, or any static host      |

The worker holds every API key and is the only piece that talks to paid services.
**Keys must never reach the module or the browser** — nothing secret belongs in a
`VITE_` variable.

### 1. Prerequisites

- **Node 22.18+**
- **SpacetimeDB CLI 2.13.x** — `spacetime version`
- **ffmpeg and ffprobe on your PATH** — the worker shells out to both to sample
  frames and read durations
- **API keys:** Anthropic (video analysis, reports, chat), JEV / Typesafe (resident
  scoring and the niche relevance filter), and optionally Apify (scraping reference
  reels)

Speech is transcribed locally with `Xenova/whisper-base.en`, which downloads on first
use. No transcription key is needed.

### 2. Configure the environment

```bash
cp .env.example .env     # repo root — the worker reads this file
```

Fill in:

```ini
ANTHROPIC_API_KEY=...
JEV_API_KEY=...
APIFY_TOKEN=...                                   # optional; reference scraping only

SPACETIME_HOST=wss://maincloud.spacetimedb.com    # or ws://127.0.0.1:3000 for local
SPACETIME_DB=your-database-name
WORKER_SECRET=pick-any-long-random-string

REFERENCE_ACCOUNTS=feedingamerica,localfarm       # niche accounts to scrape
REELS_PER_ACCOUNT=10

UPLOAD_PORT=8787
UPLOAD_ALLOWED_ORIGIN=http://localhost:5173       # must match the frontend's origin
```

The worker's `npm start` loads this exact file via `--env-file=../../.env`, so it must
exist at the repo root even if every value comes from your shell.

### 3. Publish the module and register the worker

```bash
cd backend/spacetime
npm install
spacetime publish your-database-name                      # Maincloud (default server)
# spacetime publish your-database-name --server local     # against `spacetime start`

spacetime call your-database-name set_worker_secret '"the-same-WORKER_SECRET"'
```

Call `set_worker_secret` once, as the publisher. The worker then presents that secret
to `register_worker` on every connect, so it can run on any machine without needing a
fixed identity.

Client bindings are committed for both the frontend and the worker. Regenerate them
only if you change the module's schema:

```bash
cd backend/worker && npm run bindings
```

### 4. Start the worker

```bash
cd backend/worker
npm install
npm start
```

It claims queued jobs from the database and also serves the local upload endpoint on
`UPLOAD_PORT`. The worker connects *outbound*, so it needs no public address — but the
browser does need to reach its upload server, so the frontend and worker should be on
the same machine (or the port exposed through a tunnel).

### 5. Point the frontend at it

```bash
cd frontend
cp .env.example .env.local
```

```ini
VITE_DATA_SOURCE=spacetime
VITE_SPACETIME_HOST=wss://maincloud.spacetimedb.com
VITE_SPACETIME_DB=your-database-name
VITE_UPLOAD_URL=http://127.0.0.1:8787
```

```bash
npm install
npm run dev
```

Vite inlines these at **build** time. If you deploy the frontend, set them in the host's
environment and redeploy — editing them without a rebuild changes nothing.

### 6. Use it

Sign in, complete the 3-step onboarding wizard (this writes your company profile and
the 300-resident audience into the database — there is no separate seed step), then
upload a video or choose one of the three demo cuts. Analysis, the simulation and the
report all start automatically; the campaign hub shows **Preparing results** until the
finished run can open. Failures offer an explicit **Retry results** — nothing is
resubmitted behind your back.

---

## Optional components

### Fetch.ai agents (the ASI:One front door)

Three Python uAgents make the same pipeline reachable from an ASI:One chat. They only
parse the request and call `start_run`; no scoring or key handling moves into them.

```bash
cd agents
python3 -m venv ~/.venvs/calhacks-agents     # keep it out of the repo
~/.venvs/calhacks-agents/bin/pip install -r requirements.txt
cp .env.example .env                          # then fill it in
~/.venvs/calhacks-agents/bin/python run.py
```

Test the whole chain locally, without a mailbox:

```bash
~/.venvs/calhacks-agents/bin/python client.py "test demo"
```

Run `run_split.py` instead of `run.py` when you need the Agent Inspector — it cannot
connect to agents sharing one process. Details, addresses and Agentverse registration:
[`agents/README.md`](agents/README.md).

### Remotion videos

The three demo cuts in `frontend/public/demo` are rendered from a Remotion project in
[`videos/`](videos/) (`npm run studio`, `npm run render`). The reworked cut was written
by Claude through the API from Jim's own photos and the Apify niche findings
(`backend/worker`, `npm run video:generate`).

---

## How it works

**SpacetimeDB is the core.** The browser calls reducers and subscribes to tables —
there is no API server in between. Jobs are rows in a queue table that the worker
claims atomically, so several workers can share one database safely. The sharing
cascade runs *inside* a reducer and streams live to the island.

**The worker does everything that needs a key or a binary.** ffmpeg samples frames,
local Whisper transcribes the speech, and Claude reads the video into structured,
timestamped notes. Apify scrapes real reels from similar accounts; JEV filters them
for the niche *before* any expensive analysis, then they ground the report and
calibrate the numbers.

**JEV scores every resident's chance of each action** from their profile and the video.
Its raw yes-probabilities run far above real engagement rates, so we fitted one fixed
multiplier per signal — per signal, never per video, so an A/B difference can't be
erased. Each multiplier is the observed rate on real reels divided by JEV's mean raw
probability on those same reels. The share rate is a declared assumption, not a
measurement.

**The town** is 50 hand-written Millbrook residents with personalities, values and
relationships, plus 250 neighbours derived from them in code — 300 in total. The
derived neighbours are simulated and counted but not drawn.

**Nothing calls `Math.random()`.** The audience, the graph, the starting exposure and
every one of the 200 trials derive from seeds, so an original and a revision are always
compared against an identical network. That is the only thing that makes "the revision
did better" mean anything.

### Repository layout

```
backend/spacetime/   SpacetimeDB module: schema, reducers, the cascade
backend/worker/      Node worker: ffmpeg, Whisper, Claude, JEV, Apify, upload server
frontend/            React + react-three-fiber island, sidebar, assistant, mock driver
agents/              Fetch.ai uAgents (orchestrator, ingest, simulation)
videos/              Remotion project for the demo cuts
assets/, scripts/    Resident art and resident-preview tooling
```

The seam between the UI and the backend is one interface,
[`frontend/src/data/SimDataSource.ts`](frontend/src/data/SimDataSource.ts). The mock and
the live SpacetimeDB driver both implement it, which is why the mock is a real offline
fallback rather than throwaway scaffolding. The island keeps 60fps because the
simulation never re-renders React: villager state lives in flat typed arrays stepped by
a single scene-level `useFrame`. See [`frontend/README.md`](frontend/README.md) for the
rendering, performance and look notes.

---

## Tests

All of these run offline, with no database and no API keys.

```bash
cd frontend
npm run test:video-results   # store workflow: analysis -> run -> report, retries
npm run test:overview        # chart summaries and saved results
npm run test:chat            # conversation isolation, in-flight replies, limits
npm run test:residents       # resident rendering
npm run test:personas        # Millbrook persona data
npm run test:ideas           # idea pipeline and evaluation harness
npm run lint

cd backend/worker
npm run test:chat            # grounding and history boundaries
npm run test:uploads         # upload ownership, races, malformed sources
npm run typecheck
```

---

## Honesty and limits

We disclose these in the demo, and the UI pins them to the bottom of the sidebar where
they cannot be scrolled away:

- **It ranks versions; it does not forecast real engagement.** Every number is a
  model's output.
- **The audience is fictional.** 50 residents are hand-written; the other 250 are
  derived from them in code.
- **The 10% starting exposure and the share rate are declared assumptions**, not
  measurements.
- **Reach and interactions are reported separately and never summed.** A resident
  whose scoring batch failed counts as exposed but is excluded from action totals
  rather than treated as a zero.
- **An inconclusive A/B is reported as inconclusive.** Overlapping trial ranges never
  produce a winner.
- **Runs vary.** The same video reached 77 residents in one run and 30 in another, so
  the demo fixes the seed and caches every score.
- When a re-cut written from the simulator's own advice ranked above the original on
  the same audience and seed, that is the model agreeing with its own advice — a model
  assessment, not proof of better real-world engagement.

### What's next

Check our rankings against real posted reels that we hold out, measure shares instead
of declaring them, and let the agents ingest any reel link.

---

## Credits

Residents are Kenney's CC0 Mini Characters and the town is built from Kenney's CC0 city
kits. Full asset and library credits:
[`frontend/public/ASSET-CREDITS.md`](frontend/public/ASSET-CREDITS.md).

Built at Cal Hacks 13.0 on SpacetimeDB, Anthropic Claude, JEV/Typesafe, Apify and
Fetch.ai.
