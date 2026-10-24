# HACK.md

> Shared plan for the team. Every calhacks-kit skill reads and updates this file.
> Keep it short. If it no longer fits on one screen, the scope is too big.

## Event
- Event: Cal Hacks 13.0, Palace of Fine Arts, San Francisco (Pacific time)
- Submission deadline: Sun 2026-10-25 09:30 PT (hard deadline; treat as the real one)
- Judging: expo table, demo cutoff Sun 10:30 PT; finalists may pitch on stage. Demo runs on one laptop at a noisy table.
- Judging criteria: Application, Functionality/Quality, Creativity, Technical Complexity
- Rules to respect: no implementation before the event (ideation only; the reference brief was ideas only, no prior code); disclose libraries/APIs/AI tools; every teammate on Devpost; repo link + project image required (precedent, confirm at kickoff)
- Tracks we target (requirements confirmed by the team):
  - Spacetime: use SpacetimeDB as the database (live cascade via subscriptions)
  - Fetch.ai: build an agent on Agentverse that can be found from ASI:One
  - Apify: use Apify's service (Instagram scraper for Giving Garden)
  - Anthropic: real problem for a named community (The Giving Garden), Claude used thoughtfully

## Team
| Name | Strengths | Owns |
|------|-----------|------|
| Jamshed | full-stack, hackathon experience | sim engine, JEV/Haiku scoring, SpacetimeDB module, video-to-text pipeline |
| Teammate (name TBD) | full-stack, hackathon experience | 3D cascade viz + UI, Apify Instagram scrape, Fetch.ai agents (Python) |

## Problem
- One sentence: Jim, who runs The Giving Garden nonprofit farm, struggles to recruit volunteers because he posts blind and can't test his messaging before it goes out.
- The user: Jim at The Giving Garden. Needed multiple volunteers, got under half, so harvested food couldn't be distributed. Their Instagram has 3 posts and few views. (Real client of Jamshed's engineering project; Jim has been spoken to.)
- Why it matters: unfilled volunteer slots mean sustainably grown food goes undistributed.
- What's different about our approach: pre-publish test of two recruitment videos on hundreds of simulated audience members, with a live repost cascade (a repost exposes new people), not a single "pretend you're a student" prompt.

## MVP: the one journey
1. **Problem:** show Giving Garden's real Instagram (3 posts, few views), pulled live via **Apify**, plus the consequence (food not distributed).
2. **Variants:** two recruitment reels, A and B, both cut from Cal Hacks b-roll with different hooks (disclosed stand-in for farm footage). Each is turned to text once: sampled frames + on-screen text + transcript -> Haiku structured summary (hook, pacing, tone, topic, format).
3. **Simulate:** ~500 twins score both reels; reposts expose linked twins; the spread animates live in a 3D graph fed by **SpacetimeDB** subscriptions (judges can open it on their phone).
4. **Verdict:** winner by weighted engagement, P10/P50/P90 range, which groups respond. Click a twin to see what it saw and why it reacted.
5. **Same run via chat:** Jim asks in ASI:One; the **Fetch.ai** agents run steps 1-4 and reply with the verdict.

Done means: the demo shows two reels spreading differently across a twin audience live, end to end, with a declared winner and a clickable twin. Step 5 is the second priority; steps 1-4 must work without it.

## Simulation spec (v1, tune after the spike)
- **Twins (~500):** ~450 synthetic volunteer archetypes (students, retirees, local families, foodies, sustainability/environment, faith and community groups) + a "Cal Hacks" cluster of opted-in hackers/judges. Each twin: id, name, group, 3-5 interest tags, short persona summary, hot buttons, ignores. Generated once by Haiku, seeded and stored; no sensitive traits inferred.
- **Graph:** each twin links to 3-8 others, mostly within shared tags, a few random cross-links (small world). Seeded so runs repeat.
- **Scoring:** one decision per twin per reel (JEV typed output; Haiku fallback batched ~10 twins per call). Returns P(watch-through), P(like), P(repost), P(would volunteer). Prompt states realistic base rates so not everyone engages. Both reels scored in the same pass. A failed batch = "no prediction"; >20% missing fails the run.
- **Cascade:** round 0 exposes a seed set (~10% of twins, standing in for current followers). Each exposed twin rolls its probabilities; a repost exposes its neighbors next round, with a small social-proof boost. Max 6 rounds. 200 seeded trials per reel, all local dice rolls (no extra model calls).
- **Winner:** weighted engagement = 1·watch + 2·like + 5·repost + 10·volunteer, summed over exposed twins (weights are a default, tune later). Tie if the gap is under 5%.

## Cut list (stretch goals: only after the MVP journey works end to end)
- Auto-posting / platform composer: MVP demo ends at the verdict
- Image and video generation, voiceover, campaign research/draft writing: MVP uses human-supplied reels
- Pre-scraped judge twins: stretch, consent-based on the spot only
- "Interview a twin" chat (ask it questions): stretch; MVP shows its reasoning on click
- Small-business audience: stretch, MVP is Jim only
- Login, accounts, history, admin/ops page, payment demo: stretch; MVP uses a seeded demo
- Scaling counts to real follower history / projecting to full audience: stretch; MVP ranks variants, doesn't forecast
- Cut outright (not a stretch): bulk LinkedIn scrape of the attendee list (ToS and privacy)

## Stack
- TypeScript app + small Python service for agents (uAgents is Python). Setup budget ~3.5 h (~10% of 34 h).
- Anthropic TS SDK (`npm install @anthropic-ai/sdk`): Haiku for persona generation, reel-to-text summary (vision on frames), and JEV fallback via forced structured tool output. Needs API key with credits (Claude Pro does not include API).
- JEV (not in catalog, verify): typed per-twin decisions with probabilities. Early access/waitlist, text only. https://typesafe.ai/blog/introducing-system-one-models-and-jev
- FFmpeg (not in catalog): sample frames and extract audio from each reel.
- Transcription (required, the b-roll has speech): Claude does not transcribe audio, so use local whisper.cpp or another speech-to-text service (not in catalog, verify; spike alongside JEV). Transcribe each reel once and cache it.
- SpacetimeDB (not in catalog, verify track rules): twins, edges, runs, and per-round cascade events as tables; frontend subscribes. Fallback: WebSocket/SSE from the Node sim.
- Vite + React + shadcn/ui + react-force-graph-3d (Three.js under the hood, clickable nodes built in; not in catalog, verify).
- Apify (not in catalog, verify): Instagram profile/post scraper actor for Giving Garden's posts and stats. Stretch: consented on-the-spot judge twin.
- Fetch.ai uAgents + Agentverse + Chat Protocol (Python, not in catalog, verify), discoverable via ASI:One. Each agent calls the TS backend over HTTP:
  - Orchestrator: takes Jim's request, routes, returns the verdict
  - Audience agent: triggers the Apify scrape, loads the twin audience
  - Simulation agent: starts a run, waits for it to finish
  - Verdict agent: ranks A vs B, explains which groups respond, suggests a fix
  Twins are NOT agents (they're cheap JEV calls).
- Riskiest integration: JEV access + whether A vs B produce a stable, different ranking. Spike result: pending. Spike (30 min, real inputs): get a key, score ~50 twins on the two reel summaries 3 times, check the winner is the same each run and the gap is not noise. If no key or unstable, switch to Haiku structured decisions now.
- Hosting: frontend + Node sim on the demo laptop (deploy to a URL during Harden), SpacetimeDB cloud or local, agents on Agentverse (verify mailbox/hosted setup).
- Offline fallback: a precomputed seeded run stored as JSON; the viz can replay it with no network.

Architecture:
```
Jim/judge -> React + react-force-graph-3d <-subscribe- SpacetimeDB (twins, edges, runs, cascade events)
                                                          ^ writes
ASI:One -> Fetch.ai agents (Python) -HTTP-> Node backend: sim engine -> JEV / Haiku (scoring, personas, reel summary)
                                               |-> Apify (Giving Garden Instagram)
                                               |-> FFmpeg (reel frames)
```

## Honesty
Mocked, hardcoded, or seeded parts we will disclose in the demo:
- Cal Hacks b-roll is a stand-in for farm footage we don't have.
- Twin audience is synthetic archetypes plus opted-in people; no bulk scrape of real attendees.
- Outputs are synthetic variant rankings, not measured engagement.
- Accuracy is claimed only if measured: Sat afternoon, 5-10 opted-in hackers watch both reels and pick one; compare with their twins' picks and report the hit rate and sample size.
- JEV "calibrated" claims are the vendor's, not ours.
- Design ideas drew on a reference brief (ideas only, no code).

## Pitch
- One-liner: Pending `/hack-pitch`.
- Roles: TBD

## Open questions
- Teammate's name.
- Which transcription tool (whisper.cpp local vs a hosted service).
- Resolved: JEV and Anthropic API access confirmed; track requirements confirmed (see Event).

## Status log
- Fri ~23:30 PT Scoped MVP. ~34 h to submission.
- Fri ~23:45 PT Stack chosen (TS, Anthropic SDK, JEV, SpacetimeDB, React/shadcn). .gitignore and .env.example created.
- Sat ~00:00 PT Added Apify and Fetch.ai to MVP stack. Build order: sim + cascade first, agents wrap it second, Apify third.
- Sat ~00:30 PT PRD review: two-video variants, mixed twin audience, weighted-engagement winner, react-force-graph-3d, Python agent service, sim spec, sponsors placed in the journey, ownership split. Next: JEV spike.
- Sat ~00:45 PT JEV + Anthropic API access confirmed; track requirements confirmed; transcription is required. Next: JEV spike + transcription spike.
