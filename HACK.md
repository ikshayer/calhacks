# HACK.md

> Shared plan for the team. Every calhacks-kit skill reads and updates this file.
> Keep it short. If it no longer fits on one screen, the scope is too big.

## Event
- Event: Cal Hacks 13.0, Palace of Fine Arts, San Francisco (Pacific time)
- Submission deadline: Sun 2026-10-25 09:30 PT (hard deadline; treat as the real one)
- Judging: expo table, demo cutoff Sun 10:30 PT; finalists may pitch on stage. Demo runs on one laptop at a noisy table.
- Judging criteria: Application, Functionality/Quality, Creativity, Technical Complexity
- Rules to respect: no implementation before the event (ideation only); disclose libraries/APIs/AI tools; every teammate on Devpost; repo link + project image required (precedent, confirm at kickoff)
- Tracks we target (rules NOT yet verified, see open questions): Anthropic (named community = The Giving Garden), Spacetime (live cascade via subscriptions), Apify (scrape Giving Garden's public data), Fetch.ai (multi-agent, ASI:One-discoverable, takes real action; precedent says "more than a chatbot or thin wrapper").

## Team
| Name | Strengths | Owns |
|------|-----------|------|
| Jamshed (+ 1 teammate, name TBD) | both full-stack, hackathon experience | split TBD: one on sim engine + data, one on frontend + demo |

## Problem
- One sentence: Jim, who runs The Giving Garden nonprofit farm, struggles to recruit volunteers because he posts blind and can't test his messaging before it goes out.
- The user: Jim at The Giving Garden. Needed multiple volunteers, got under half, so harvested food couldn't be distributed. Their social account has 3 posts and few views. (Real client of Jamshed's engineering project; Jim has been spoken to.)
- Why it matters: unfilled volunteer slots mean sustainably grown food goes undistributed.
- What's different about our approach: pre-publish test of two recruitment posts/videos on thousands of simulated audience members, with a live repost cascade (a repost exposes new people), not a single "pretend you're a student" prompt.

## MVP: the one journey
1. Show Giving Garden's real account (3 posts, few views) as the problem, with the consequence.
2. Pick two variants: A = their existing post, B = rewritten post / Cal Hacks b-roll clip (disclosed stand-in; video turned to text via sampled frames + transcript).
3. Press Simulate: ~500-1000 twin agents decide watch/like/repost/ignore (JEV typed decisions, Haiku fallback); reposts re-expose new twins; the spread animates live.
4. Verdict: winner, reach range (P10/P50/P90), which groups respond. Click a twin to see what it saw and why it reacted.

Done means: the demo shows two variants spreading differently across a twin audience live, end to end, with a declared winner and a clickable twin.

## Cut list (stretch goals: only after the MVP journey works end to end)
- Auto-posting / platform composer: MVP demo ends at the verdict
- Image and video generation, voiceover, campaign research/draft writing: MVP uses human-supplied variants
- Pre-scraped judge twins: stretch, consent-based on the spot only
- Small-business audience: stretch, MVP is Jim only
- Login, accounts, history, admin/ops page, payment demo: stretch; MVP uses a seeded demo
- Scaling counts to real follower history / projecting to full audience: stretch; MVP ranks variants, doesn't forecast
- Cut outright (not a stretch): bulk LinkedIn scrape of the attendee list (ToS and privacy)

## Stack
- TypeScript end to end (both teammates full-stack). Setup budget ~2 h (~6% of 34 h).
- Anthropic TS SDK (`npm install @anthropic-ai/sdk`): Haiku turns sampled frames + transcript into a text description and writes personas; also the JEV fallback via forced structured tool output. ~10 min. Needs API key with credits (Claude Pro does not include API).
- JEV (not in catalog, verify): typed watch/like/repost/ignore decisions with probabilities, per twin. Early access/waitlist, text only. https://typesafe.ai/blog/introducing-system-one-models-and-jev
- SpacetimeDB (not in catalog, verify track rules): twin and cascade state as tables, frontend subscribes so the spread animates live (and judges can watch on their own phone). ~45 min. Fallback if it fights us: plain WebSocket/SSE from the Node sim.
- Vite + React + shadcn/ui (`shadcn-ui/ui`) with a canvas/force-graph lib for the cascade (not in catalog, verify): ~30 min.
- Apify (now in MVP, not in catalog, verify): actor scrapes The Giving Garden's public posts/stats (the real "few views" input in step 1) and feeds twin personas from public data. Stretch: consented on-the-spot judge twin.
- Fetch.ai uAgents + Agentverse + Chat Protocol (now in MVP, not in catalog, verify): small multi-agent layer, discoverable via ASI:One, so Jim can ask in chat. Agents do real work, not a thin wrapper:
  - Orchestrator: takes Jim's request, routes, returns the verdict
  - Audience agent: runs Apify, builds/loads the twin audience
  - Simulation agent: runs the cascade (JEV/Haiku), writes to SpacetimeDB
  - Verdict agent: ranks A vs B, explains which groups respond, suggests a fix
  Twins are NOT agents (they're cheap JEV calls); keep agents thin over the same backend functions the web app uses.
- Riskiest integration: JEV access + whether A vs B produce a stable, different ranking. Spike result: pending. Spike (30 min, real inputs): get a key, run ~50 twins on the two real text variants 3 times, check the winner is the same each run and the gap is not noise. If no key or unstable, switch to Haiku structured decisions now.

Architecture:
```
judge/Jim -> React frontend (cascade viz) <-subscribe- SpacetimeDB tables
                                                         ^ writes
              Node sim engine -> JEV (decisions) / Haiku (video->text, personas) -> twin audience (synthetic + opted-in)
```

## Honesty
Mocked, hardcoded, or seeded parts we will disclose in the demo:
- Cal Hacks b-roll is a stand-in for farm footage we don't have.
- Twin audience is synthetic personas plus opted-in people; no bulk scrape of real attendees.
- Outputs are synthetic variant rankings, not measured engagement. Accuracy claimed only if we measure it (opted-in hackers rate the clips, compare ranking).
- JEV "calibrated" claims are the vendor's, not ours.
- Design reference brief pasted by Jamshed ("something like this but not exactly"): origin to confirm before submission.

## Pitch
- One-liner: Pending `/hack-pitch`.
- Roles: TBD

## Status log
- Fri ~23:30 PT Scoped MVP. ~34 h to submission. Next: /hack-stack, JEV access spike, video-to-text spike.
- Fri ~00:00 PT Added Apify and Fetch.ai to MVP stack (user decision). Setup now ~3.5 h (~10% of time); build order: sim + cascade first, agents wrap it second, Apify third.
- Fri ~23:45 PT Stack chosen (TS, Anthropic SDK, JEV, SpacetimeDB, React/shadcn). .gitignore and .env.example created. Next: spike JEV.
