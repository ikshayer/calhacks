![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Reel Rehearsal

**Find out who shares it before you post it.**

Reel Rehearsal is a private marketing assistant for small companies with limited budgets, and for stealth companies that cannot test in public. You upload a campaign video. A simulated town of 300 residents (50 hand-written fictional Millbrook residents plus 250 derived neighbours) decides whether to watch, like, comment or share it. Shares spread round by round across a 3D island. Then an Assistant explains the report, with timestamped feedback and rewritten hooks, and answers follow-up questions.

You can also test an idea with no video, and A/B test two videos on the same audience with the same seed.

Demo customer: Jim at **The Giving Garden**, a nonprofit farm.

- Live frontend: https://calhacks-giving-garden.vercel.app
- Repo: https://github.com/ikshayer/calhacks
- Built at Cal Hacks 13.0

## Agents (Fetch.ai)

Agentverse handle: `reel-rehearsal`. Three Python uAgents in [`agents/`](agents/).

| Name | Role | Address |
| --- | --- | --- |
| `reels-orchestrator` | Public. Speaks the Agent Chat Protocol with an Agentverse mailbox. Parses the chat message, drives the other two agents, streams progress and replies. | `agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg` |
| `reel-ingest` | Private. Works out what to test. If you paste a reel link, it scrapes the reel with Apify for context. | `agent1qderhnzcjcszmv60xhv9c6rlr29rtnwkq7d2v5w3nwh6gql30hvdvz8jlsq` |
| `reel-simulation` | Private. Calls the `start_run` reducer on SpacetimeDB, polls progress and reads the report. | `agent1q2xe9930mrh94vryadcu99yrcz6dltmxflu7tmmxv0xu277a3zhqvucddh9` |

Orchestrator profile: https://agentverse.ai/agents/details/agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg/profile

**Try it in ASI:One:** open the profile link, click **Chat with Agent**, and send `test demo`.

## Architecture

```
Browser (React + Vite + react-three-fiber)        ASI:One chat
        │ reducers + table subscriptions               │
        ▼                                              ▼
┌──────────────────────────────┐        reels-orchestrator ─► reel-ingest ─► Apify
│ SpacetimeDB (Maincloud)      │◄───────── reel-simulation (start_run, polls rows)
│ database calhacks-wwif0      │
│ - tables, reducers           │
│ - sharing cascade reducer    │
│ - job-queue table            │
└──────────────┬───────────────┘
               │ claims jobs
               ▼
Node worker: ffmpeg + local Whisper + Claude video analysis,
JEV per-resident scoring, Apify reference reels, reports, chat
```

- **SpacetimeDB is the core.** The browser calls reducers and subscribes to tables. Module: [`backend/spacetime/spacetimedb`](backend/spacetime/spacetimedb).
- **The sharing cascade** (200 seeded trials) runs inside a SpacetimeDB reducer.
- **The Node worker** ([`backend/worker`](backend/worker)) claims rows from a job-queue table. It runs ffmpeg, local Whisper and Claude video analysis, scores each resident with JEV, scrapes reference reels with Apify (filtered to the niche with JEV), and writes the reports and chat replies.
- **The frontend** ([`frontend/`](frontend)) is React + Vite + react-three-fiber.
- **The agents** ([`agents/`](agents)) are Python uAgents. They only call `start_run` and read rows back.
- **Demo videos** ([`videos/`](videos)) are made with Remotion.

## Run it

### Prerequisites

- Node 24, Python 3.12+, `ffmpeg` on your PATH
- [SpacetimeDB CLI](https://spacetimedb.com)
- API keys: Anthropic, JEV (TypeSafe), Apify
- An [Agentverse](https://agentverse.ai) account

### 1. Environment

Copy each example file and fill it in:

| File | Variables |
| --- | --- |
| `.env.example` → `.env` (repo root, used by the worker) | `ANTHROPIC_API_KEY`, `JEV_API_KEY`, `APIFY_TOKEN`, `SPACETIME_HOST`, `SPACETIME_DB`, `WORKER_SECRET`, `REFERENCE_ACCOUNTS`, `REELS_PER_ACCOUNT`, `DEMO_VIDEOS_DIR`, `UPLOAD_PORT`, `UPLOAD_ALLOWED_ORIGIN` |
| `frontend/.env.example` → `frontend/.env` | `VITE_DATA_SOURCE`, `VITE_SPACETIME_HOST`, `VITE_SPACETIME_DB`, `VITE_UPLOAD_URL` |
| `agents/.env.example` → `agents/.env` | `AGENT_SEED_ORCHESTRATOR`, `AGENT_SEED_INGEST`, `AGENT_SEED_SIMULATION`, `AGENT_HANDLE`, `BUREAU_PORT`, `STDB_URL`, `STDB_DATABASE`, `STDB_TOKEN`, `APIFY_TOKEN`, `APIFY_REEL_ACTOR`, `ISLAND_URL`, `PROFILE_ID`, `CAMPAIGN_ID`, `FALLBACK_VIDEO_ID`, and timeouts |

`STDB_TOKEN` in `agents/.env` must be the identity token of the user who owns the company profile. `start_run` is owner-checked, so any other identity gets `not the owner`.

### 2. Publish the SpacetimeDB module

```bash
cd backend/spacetime
spacetime publish calhacks-wwif0     # spacetime.json points at ./spacetimedb on maincloud
```

### 3. Start the worker

```bash
cd backend/worker
npm install
npm start          # reads ../../.env
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_DATA_SOURCE=spacetime` to use the live backend. If you leave it unset, the app uses an in-browser mock.

### 5. Start the agents

Keep the virtual environment outside the repo:

```bash
python3 -m venv ~/.venvs/calhacks-agents
~/.venvs/calhacks-agents/bin/pip install -r agents/requirements.txt
cd agents
~/.venvs/calhacks-agents/bin/python run_split.py workers        # ingest + simulation
~/.venvs/calhacks-agents/bin/python run_split.py orchestrator   # the ASI:One-facing agent
```

The orchestrator prints an **Agent Inspector** link on startup. Open it and click *Connect* to create the Agentverse mailbox. The Chat Protocol manifest publishes automatically.

To test locally without ASI:One or a mailbox:

```bash
~/.venvs/calhacks-agents/bin/python client.py "test demo"
```

More detail is in [`agents/README.md`](agents/README.md).

### Tests

| Where | Scripts |
| --- | --- |
| `frontend` | `npm run test:personas`, `test:residents`, `test:chat`, `test:overview`, `test:video-results`, `test:ideas` |
| `backend/worker` | `npm run test:chat`, `test:uploads`, `typecheck` |

## Extra resources

- [SpacetimeDB](https://spacetimedb.com): database and reducers, hosted on Maincloud
- [JEV models (TypeSafe)](https://docs.typesafe.ai/models): per-resident scoring
- [Apify Instagram Reel Scraper](https://apify.com/apify/instagram-reel-scraper): reference reels and pasted reel links
- [Fetch.ai Agentverse](https://agentverse.ai): agent registry and mailbox
- [ASI:One](https://asi1.ai): chat front end for the agents
- [Anthropic API](https://docs.anthropic.com): video analysis, reports and the Assistant

## Honest limits

- The residents are simulated people in a fictional town. The result is a ranking, not a forecast.
- The share rate is a declared 10% per exposure. Like and comment rates are calibrated to scraped reels.
- ASI:One replies are text only and use a fixed seed. A pasted reel link falls back to the cached demo video, and the reply says so.
- The worker and the agents run on a team laptop.
- Video upload works only on the machine running the worker.

## Team

- **Jamshed**: backend, simulation, SpacetimeDB, worker
- **TM / Shayer**: 3D island and UI
- **Arian**: Fetch.ai agents
