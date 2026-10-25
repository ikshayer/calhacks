![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

# Fetch.ai agents — the ASI:One front door

Three Python agents that make the existing reel-reaction pipeline reachable
from ASI:One chat. **They are a front door and nothing more.** Scoring stays
in the Node worker (the JEV key must never reach an agent), the cascade stays
in the SpacetimeDB module, and the report is still written by Claude in the
worker. These agents only call `start_run` and read rows back.

| Agent | Public | Address (live) | Job |
| --- | --- | --- | --- |
| `reels-orchestrator` | yes, Chat Protocol | `agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg` | Parse the chat message, drive the others, stream progress, reply. |
| `reel-ingest` | no | `agent1qderhnzcjcszmv60xhv9c6rlr29rtnwkq7d2v5w3nwh6gql30hvdvz8jlsq` | Resolve a reel URL to a runnable video id, scraping with Apify for context. |
| `reel-simulation` | no | `agent1q2xe9930mrh94vryadcu99yrcz6dltmxflu7tmmxv0xu277a3zhqvucddh9` | Call `start_run`, watch the run and job rows, read the report. |

Addresses are derived from the seeds, so **set real seeds in `.env` before
registering** — the addresses above change with them.

```
ASI:One chat ──► orchestrator ──► ingest ──► Apify ──► video id
                      │
                      ├──► simulation ──► start_run (SpacetimeDB reducer)
                      │                    └─► existing worker + cascade
                      ├──► poll run/job rows ──► progress lines in chat
                      └──► read report row ──► final reply + island link
```

## Setup

```bash
python3 -m venv ~/.venvs/calhacks-agents          # keep it OUT of this repo
~/.venvs/calhacks-agents/bin/pip install -r requirements.txt
cp .env.example .env                               # then fill it in
~/.venvs/calhacks-agents/bin/python run.py
```

Test the whole chain locally, without ASI:One or a mailbox — `client.py`
speaks the same Agent Chat Protocol over an in-process bureau:

```bash
~/.venvs/calhacks-agents/bin/python client.py "test demo"
~/.venvs/calhacks-agents/bin/python client.py "test this reel: https://www.instagram.com/reel/XXXX/"
```

## Registering on Agentverse

1. `run.py` prints an **Agent Inspector** link on startup. Open it, sign in,
   and click *Connect* to create the mailbox. Until you do, the log says
   `Agent mailbox not found: create one using the agent inspector`.
2. The Chat Protocol manifest publishes automatically
   (`Manifest published successfully: AgentChatProtocol`).
3. In the Agentverse profile, set the handle and description, then find the
   agent from ASI:One and chat with it.

`AGENTVERSE_API_KEY` is only needed for scripted registration. The inspector
route is simpler and is what the build order recommends doing first.

## Two constraints in the module that shape this design

Both were found by reading `backend/spacetime/spacetimedb/src/index.ts`, and
both are deliberate guards, not bugs. They are the open items for the team.

### 1. `start_run` is owner-checked, so `STDB_TOKEN` matters

`start_run` calls `requireOwner` on both the video and the company profile.
An anonymous identity is rejected — verified against the live database:

```
start_run failed (530): not the owner
```

So `STDB_TOKEN` **must be the identity token of the user that owns the
profile**. For the demo data, profile `gg` ("The Giving Garden") is owned by
`0xc2009cf171913c6ad59d71bea1139731d81217ca39161a8f4b6d85193ed7f275`.

Until that token is in `.env`, every run fails with `not the owner`. The
chat reply says exactly that rather than failing silently. Options for the
team: reuse the demo user's token (simplest), or add an agent role to the
module the way `worker` works.

### 2. A reel URL cannot become a runnable video today

`create_video` rejects any `sourceUrl` that does not start with `demo:`:

```ts
if (!args.sourceUrl?.startsWith('demo:'))
  throw new SenderError('sourceUrl must name a demo video, e.g. "demo:original.mp4"');
```

That guard exists because the worker would otherwise fetch any path or URL a
stranger sent it. There is also no `content` table — scraped reels land in
`reference_reel`, which `start_run` does not accept, and
`upsert_reference_reels` is worker-only.

So `ingest` does the honest thing:

1. scrapes the URL with Apify, so the reply quotes the **real** caption and
   counts;
2. matches it against an already-analysed `video` row if one exists;
3. otherwise falls back to `FALLBACK_VIDEO_ID` and **says so in the chat**:
   *"That reel is not loaded as a campaign video, so I simulated the cached
   demo video original.mp4 instead. I did read the real reel: 12,400 plays,
   830 likes."*

This matches the handoff's own demo-safety rule. A fallback is never silent.
Lifting it needs a module change — either relax the `demo:` guard for a
trusted agent identity, or add the content table the handoff assumed.

## Also needs a frontend change

The final reply links to `<ISLAND_URL>/workspace?run=<id>`, but `App.tsx`
routes only `/workspace` and ignores a `run` query parameter, so the link
lands on the workspace without selecting the run. Someone needs to make
`WorkspaceRoute` honour `?run=`.

## What was verified against the live database

`calhacks-wwif0` on Maincloud, on 2026-10-24:

- `stdb.sql()` decodes the wire format correctly — options as `[0, value]`,
  identities and timestamps as single-field products, nested objects.
- `stdb.call()` reaches the module. Reducer names are **snake_case**
  (`start_run`), args are a **positional JSON array**, and the nested
  `options` product is a positional array `[seed, audienceVersion,
  seedExposure, maxRounds]`. The module deserialised all of it and got as far
  as the owner check.
- The orchestrator acks every `ChatMessage`, streams intermediate turns, and
  closes with `EndSessionContent`.
- `request_id` round-trips on every inter-agent reply; mismatched replies are
  dropped rather than mixed between conversations.
- Manifest publishes: `Manifest published successfully: AgentChatProtocol`.

Not yet verified end to end: a **successful** run, because that needs the
owner token above.

## Environment notes

- Keep the virtualenv **outside this repo**. The repo sits in a cloud-synced
  folder; with a full disk, macOS evicts files to `dataless` stubs and a venv
  inside it breaks (`mmap` failures, empty reads). `.env` has been seen to
  read back empty for the same reason — check `ls -lO .env` if the seeds
  mysteriously change.
- `config.py` points OpenSSL at certifi's CA bundle. Without it, the
  python.org macOS build cannot verify `agentverse.ai` and the manifest never
  publishes (`CERTIFICATE_VERIFY_FAILED`).

## Honest framing for the pitch

- Results are **simulated** audience reactions, not predictions.
- The calibration multipliers are fixed, and the first cascade round exposes
  10% of the audience. Both are stated in every final reply.
- The agents are the front door; the pipeline behind them does the work.
