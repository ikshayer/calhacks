# HACK.md

> Shared plan for the team. Every calhacks-kit skill reads and updates this file.
> Current product decisions live here; older handoff notes and status entries are historical.

## Event
- Event: Cal Hacks 13.0, Palace of Fine Arts, San Francisco (Pacific time)
- Submission deadline: Sun 2026-10-25 09:30 PT (hard deadline; treat as the real one)
- Judging: expo table, demo cutoff Sun 10:30 PT; finalists may pitch on stage. Demo runs on one laptop at a noisy table.
- Judging criteria: Application, Functionality/Quality, Creativity, Technical Complexity
- Rules to respect: no implementation before the event (ideation only; the reference brief was ideas only, no prior code); disclose libraries/APIs/AI tools; every teammate on Devpost; repo link + project image required (precedent, confirm at kickoff)
- Tracks we target (requirements confirmed by the team):
  - Spacetime: use SpacetimeDB as the database (live cascade via subscriptions)
  - Fetch.ai: build an agent on Agentverse that can be found from ASI:One
  - Apify: use Apify's service (Instagram reference videos and performance data for Giving Garden's niche)
  - Anthropic: real problem for a named community (The Giving Garden), Claude used thoughtfully

## Team
| Name | Strengths | Owns |
|------|-----------|------|
| Jamshed | full-stack, hackathon experience | sim engine, JEV audience scoring + relevance filter, Anthropic analysis/explanations, SpacetimeDB module + Node worker, Apify reference-reel scrape, video-to-text pipeline |
| TM (Shayer) | full-stack, hackathon experience | 3D island viz + UI, SpacetimeDataSource (frontend <-> module), Fetch.ai agents (Python) |
| Unassigned | | report + follow-up chat UI/backend, auth/onboarding (decide together) |

## Problem
- Product: a private marketing assistant that analyzes past video performance, simulates audience reception, and recommends specific improvements before a campaign is published.
- Primary customers: small companies with limited budgets for campaign experimentation, and stealth companies that cannot publicly test unreleased information.
- Demo customer: Jim at The Giving Garden. Needed multiple volunteers, got under half, so harvested food couldn't be distributed. Their Instagram has 3 posts and few views. (Team-provided context; real client of Jamshed's engineering project; Jim has been spoken to.) Giving Garden illustrates the product; volunteer recruitment does not define the general scoring objective.
- Objective: improve engagement, including views, likes, comments, and shares, with reach/spread shown separately. Predictive accuracy is a product goal to evaluate, not an established capability.
- Core experience: private audience simulation with a live sharing cascade, followed by timestamped feedback, rewritten hooks/scripts, and contextual follow-up chat.

## Signup and onboarding
1. Sign up and create a company profile. Describe the product and intended customer in one sentence; website and Instagram handle are optional autofill inputs.
2. Confirm or edit suggested audience groups. Ask for location when relevant. Suggested groups and their proportions are assumptions, not measured follower demographics.
3. Default the objective to engagement; choose brand tone and optionally add competitor/inspiration accounts. Find reference content in the background.
- Save an editable profile. Campaigns inherit the audience and objective, with per-campaign overrides. Stealth companies can complete onboarding with a written description alone.
- Privacy requirement: cloud AI processing is acceptable; uploads and reports must never be published or exposed to other users. Enforce ownership on storage, backend reads, subscriptions, and chat context. Any judge-accessible demo uses separate, explicitly shareable assets.

## MVP: the one journey
1. **Onboard:** Jim creates Giving Garden's profile and confirms the suggested audience.
2. **Learn from examples:** use **Apify** to discover candidate public reels and collect lightweight metadata. **JEV** filters candidates for the company's niche before expensive **Anthropic** video analysis. Analyze retained reels using frames and transcripts; include stronger and weaker performers, not just viral examples. Cache successful collections and analyses.
3. **Upload and analyze:** Jim uploads an unpublished campaign video. Sampled frames, on-screen text, and a timestamped transcript produce a structured content summary (hook, pacing, tone, topic, format). Keep observations tied to actual timestamps.
4. **Simulate:** ~500 audience members react; sharing exposes linked members. Animate the cascade live through **SpacetimeDB** subscriptions. Show engagement components, responding groups, and clickable simulated explanations.
5. **Improve:** show a structured report with timestamped feedback, rewritten hooks/scripts, and supporting reference examples where available. Follow-up chat answers questions such as "Why would this group share it?" and "Make the hook more playful," grounded in the company profile, uploaded video, reference set, and run results.
6. **Compare:** Jim manually edits and uploads a revision. Run it against the same audience and starting exposure, then show the component changes and an overall comparison, allowing an inconclusive result.
7. **Sponsor extension:** Jim invokes the workflow through ASI:One using **Fetch.ai**. This is second priority; the web app must work independently.

Done means: signup/onboarding, private upload, reference analysis, a working live simulation, actionable report and follow-up chat, and original-versus-revision comparison work end to end. A single upload must also produce useful feedback without requiring an existing second version.

## Demo assets and build order
- Giving Garden is the confirmed demo customer. No final campaign video exists yet; the team plans to make it after the core app is built. Prepare an original and a manually revised version illustrating the assistant's feedback.
- Development recommendation: use a short temporary clip with speech and on-screen text early to exercise upload, playback, frame extraction, transcription, and timestamp alignment. Replace it with the final campaign before rehearsal; mock summaries alone do not validate the video pipeline.
- Build the smallest upload -> analysis -> simulation -> report path first, then integrate company context/onboarding, reference evidence, chat, and comparison. Reserve time for final video production and rehearsal before the submission deadline. The Fetch.ai wrapper follows the core web journey.

## Simulation spec (v1, tune after the spike)
- **Audience (~500):** synthetic archetypes based on the confirmed company profile. Giving Garden examples include students, retirees, local families, foodies, sustainability/environment, and community groups. Each member: id, name, group, 3-5 interest tags, short persona summary, hot buttons, ignores. Generate once per audience version and persist. Any opted-in hacker/judge profiles form an explicitly labeled optional group; no sensitive traits inferred.
- **Graph:** each twin links to 3-8 others, mostly within shared tags, a few random cross-links (small world). Seeded so runs repeat.
- **Scoring:** **JEV** makes each member’s decision (one per member per reel): P(watch-through), P(like), P(comment), P(share), from the persona plus the video’s content summary. JEV returns typed probabilities, not text, so **Claude (Haiku)** writes the explanation on demand when a member is clicked, grounded in the content summary. Haiku structured decisions (batched ~10 members per call) are the fallback if JEV is unavailable or its outputs are unusable.
- **Calibration:** JEV probabilities are confidence-of-yes, ~10-30x real rates (spike, Sat 11:20). Apply one fixed multiplier per signal, computed once and stored in a calibration file, never per video (per-video normalisation would erase the A/B difference). Like and comment multipliers make JEV’s mean on scraped reference reels match their observed likes/plays and comments/plays. Share multiplier makes a typical reel’s per-exposure share chance 10% (declared assumption; scrape has no shares). Watch-through stays raw JEV (no completion data), labelled as such. Clamp to [0, 1]. Define probabilities consistently as conditional on exposure. Baseline assumptions must be explicit; prompting for realistic rates does not establish calibration. A failed batch = "no prediction"; >20% missing fails the run. Compare only matched valid members and report coverage.
- **Cascade:** round 0 exposes a seed set (~10% of the audience, a declared starting-exposure assumption). Each exposed member rolls its probabilities; a share exposes neighbors next round. Max 6 rounds; 200 seeded local trials per reel. Count each member once for unique simulated exposure and prevent duplicate actions from repeated exposure. The graph represents a simplified sharing scenario, not Instagram's recommendation algorithm.
- **Fair comparison:** preserve audience, graph, initial exposure, scoring configuration, and trial seeds across original and revision. Test sensitivity to reasonable audience and sharing assumptions; flag unstable rankings.
- **Score:** engagement components are the primary evidence; show simulated unique exposure and view assumptions separately. Do not sum raw reach, views, and interactions as if they were interchangeable. A transparent relative summary score may accompany the components; its exact normalization and weights need a small data spike before implementation. No volunteer-specific weight. A score is not a probability of going viral.
- **Uncertainty:** P10/P50/P90 describe variability within the simulation assumptions, not validated real-world prediction intervals. Allow inconclusive comparisons rather than forcing a winner.

## Reference data and evaluation
- **JEV's intended role:** a fast relevance gate before Anthropic analyzes reference videos. Ask whether the candidate reel fits the user's niche, using the onboarding niche/audience definition and the reel's caption, hashtags, account context, and any already-available transcript. Do not ask whether the reel is successful; relevant failures must pass too.
- **Input boundary:** JEV's documented model accepts text/structured state, not raw video. Start from scraped text metadata. Do not generate an Anthropic summary for every candidate before filtering, since that pays the analysis cost the filter is meant to avoid. Sparse captions and visual-only content need an uncertain path rather than automatic rejection. See [model documentation](https://docs.typesafe.ai/models).
- **Decision:** use [Noul](https://docs.typesafe.ai/primitives/noul), which returns P(yes) from 0 to 1; application thresholds turn this into an accept/reject decision. Proposed initial routing: >=0.7 retain, <=0.3 reject when sufficient text evidence exists, otherwise enrich the text or send to a budgeted Anthropic review. These are starting thresholds to evaluate, not measured accuracy guarantees. API failures are unknown, not irrelevant. Audit a sample of rejects for missed relevant clips.
- **Savings:** Apify still performs discovery/scraping. JEV can reduce downstream Anthropic calls, tokens, and video-processing work by excluding irrelevant candidates. Measure total latency and cost including scraping, JEV, enrichment, uncertain cases, and retained-video analysis; speedup is not guaranteed when most candidates pass or scraping dominates. Cache by reel content plus niche/classifier version.
- Candidate source: [Apify Instagram Reel Scraper](https://apify.com/apify/instagram-reel-scraper), which documents media, captions, transcripts, timestamps, likes, comments, plays/views, and optional shares. [Apify's tutorial](https://blog.apify.com/scrape-instagram-reels/) describes share collection as a paid option. Verify actual field availability with a small run; missing values stay missing, not zero.
- Do not assume the scrape supplies unique reach, retention, paid-distribution details, or actual audience demographics. Keep observed reference metrics separate from simulated outputs.
- Build comparison sets from relevant accounts and include low/ordinary performers. Consider account baseline, post age, topic, and format; flag unknown promotion rather than attributing every difference to creative quality.
- Reserve videos and their outcomes for evaluation. Predict from content and permitted context with outcomes/comments revealing performance withheld, then compare rankings with observed results and a simple baseline. Report sample size and metric. Do not use evaluation outcomes to tune the same test.
- A higher simulated score after following the assistant's advice is a model assessment, not independent proof of improved real engagement. An optional 5-10-person preference check is exploratory and does not validate reach or conversion.

## Cut list (stretch goals: only after the MVP journey works end to end)
- Auto-posting / platform composer: MVP stays private
- Automatic video editing, image/video generation, and voiceover: stretch; MVP uses human-supplied reels and manual revisions. Reference research and written hook/script suggestions are in the MVP.
- Pre-scraped judge twins: stretch, consent-based on the spot only
- "Interview a twin" chat (ask it questions): stretch; MVP shows its reasoning on click
- Additional prepared industry demos: stretch; the company profile supports small businesses, with Giving Garden as the demo
- Full history dashboard, admin/ops page, and payment demo: stretch. Signup, login, company onboarding, private access, and the current campaign's revision comparison are in scope.
- Scaling counts to real follower history / projecting to full audience: stretch; MVP ranks variants, doesn't forecast
- Cut outright (not a stretch): bulk LinkedIn scrape of the attendee list (ToS and privacy)

## Stack
- TypeScript app + small Python service for agents (uAgents is Python). Setup budget ~3.5 h (~10% of the ~33 h left at Sat 00:50 PT).
- Anthropic TS SDK (`npm install @anthropic-ai/sdk`): models analyze retained reference reels and private uploads, generate audience personas and fallback simulation decisions, member explanations on demand, and produce timestamped recommendations, rewritten hooks/scripts, and follow-up chat. Haiku is the initial candidate for lightweight/batched work; evaluate quality during the spike. Needs an API key with credits.
- JEV: (1) audience scoring, the per-member watch/like/comment/share probabilities that drive the cascade; (2) niche-relevance classifier for scraped reference candidates, placed before Anthropic analysis. Use Noul probabilities over lightweight text metadata, with explicit accept/reject/uncertain routing. API access is team-confirmed; verify live behavior during the filter spike. See [Noul](https://docs.typesafe.ai/primitives/noul) and [models](https://docs.typesafe.ai/models).
- FFmpeg (not in catalog): sample frames and extract audio from each reel.
- Transcription: required for speech-bearing uploads and timestamped feedback. Select a transcription tool during the video spike; transcribe once and cache. A manually verified timestamped transcript is an explicitly disclosed demo fallback, not a general upload solution.
- SpacetimeDB: company profiles, campaigns, audience members, edges, runs, and per-round events with owner-scoped reads/subscriptions. Frontend subscribes to the authorized run. Fallback: authenticated WebSocket/SSE from the Node sim.
- Vite + React + react-three-fiber 3D island town: animated villagers react and share (TM's frontend, replaces react-force-graph-3d). Backend must implement `frontend/src/data/SimDataSource.ts` using the types in `frontend/src/data/types.ts`.
- Apify: collect relevant public reference reels and available metrics; cache data for comparisons and demo resilience. Keep private uploaded campaign assets out of public reference datasets.
- Marketing assistant: structured report plus contextual follow-up chat; use content timestamps and reference evidence, and never invent observed retention or unsupported performance improvements.
- Fetch.ai uAgents + Agentverse + Chat Protocol (Python, not in catalog, verify), discoverable via ASI:One. Each agent calls the TS backend over HTTP:
  - Orchestrator: takes the user's request (e.g. "analyze my campaign video"), routes, returns the report summary
  - Reference agent: triggers the Apify reel scrape + JEV filter + reference analysis for the company's niche
  - Simulation agent: starts a run for a campaign, waits for it to finish
  - Advisor agent: returns the report highlights (timestamped feedback, rewritten hook) and, when a revision exists, the original-vs-revision comparison
  Twins are simulated audience records with Anthropic-scored reactions, not individually hosted Fetch.ai agents.
- Filter spike (30 min): label a small, varied sample of candidate reels for niche relevance, including sparse-caption cases. Check JEV output validity, relevant reels retained, irrelevant reels removed, uncertain rate, and end-to-end cost/latency against analyzing all candidates. Separate threshold tuning examples from evaluation examples. If the filter is unavailable, use a bounded, disclosed manually curated reference set for the demo.
- Simulation spike: independently score ~50 audience members on temporary real clip inputs with Anthropic to check output validity, latency, cost, and ranking stability. A stable or different ranking is not proof of predictive accuracy; retain genuine ties.
- Hosting: frontend + Node sim on the demo laptop (deploy to a URL during Harden), SpacetimeDB cloud or local, agents on Agentverse (verify mailbox/hosted setup).
- Offline fallback: an explicitly labeled precomputed demo replay with cached reference data and reports. Live signup, cloud analysis, and chat still require their services.

Architecture:
```
Jim -> signup/onboarding -> React + react-force-graph-3d <-authorized subscription- SpacetimeDB
                                                          ^ writes
ASI:One -> Fetch.ai agents (Python) -HTTP-> Node backend
    Reference pipeline: Apify metadata -> JEV niche filter -> retained/uncertain review -> Anthropic reference analysis
    Private campaign:   upload -> FFmpeg + transcription -> Anthropic content analysis
    Simulation:         company audience + campaign + reference context -> Anthropic reactions -> local cascade
    Assistant:          campaign + reference evidence + run results -> Anthropic report and follow-up chat
```

## Honesty
Mocked, hardcoded, or seeded parts we will disclose in the demo:
- Final demo videos are not yet produced. Disclose any stand-in footage, manually supplied transcripts, or cached replay used.
- Twin audience is synthetic archetypes plus opted-in people; no bulk scrape of real attendees.
- Outputs are synthetic variant rankings, not measured engagement.
- Accuracy is claimed only for the outcomes actually measured on held-out examples; report evaluation limits. Synthetic explanations and simulated ranges are not observed human behavior.
- Share chance is calibrated to a declared 10% per exposure for a typical reel, far above real Instagram share rates, chosen so cascades are visible. Like/comment rates are calibrated to scraped reference reels; watch-through is uncalibrated JEV output.
- JEV relevance probabilities and JEV audience probabilities are model estimates. Audience probabilities drive a synthetic simulation; they are not measured engagement or predictions of virality. Measure niche-filter quality and savings on our inputs.
- Design ideas drew on a reference brief (ideas only, no code).
- Frontend can run on `MockDataSource` (offline fallback: cascade, report, chat generated in the browser) or the live backend (`VITE_DATA_SOURCE=spacetime`). The UI labels which one; a demo on the mock must say so. Auth is mock local auth; the live backend uses an anonymous per-browser identity.
- Audience personas come from a seeded template generator in the browser (not Claude-written, not real people).
- The worker runs on a team laptop, not a server; if it is down, jobs wait in the queue.
- Mii resident models come from Joey Carlino's Mii Maker for Blender; reuse terms not yet established (see INTEGRATION_HANDOFF.MD).
- Demo videos are Remotion text animations with scripts written by Claude and a Windows built-in TTS voice; script claims to be confirmed with Jim.
- No real upload: the demo picks one of two pre-loaded videos (frontend/public/demo). The worker analyses that same file for real (frames, Whisper, Haiku); only the upload step is skipped.
- 3D character/town models are third-party assets (see frontend/public/ASSET-CREDITS.md).

## Pitch
- One-liner: A private marketing assistant that simulates audience reception and helps small teams improve their videos before publishing.
- Roles: TBD

## Open questions
- Decide together: real auth + owner-scoped privacy vs a seeded demo account (recommend seeded; real auth is hours of work).
- Decide together: who owns the report + follow-up chat (Jamshed already owns sim, SpacetimeDB, video pipeline, JEV filter, Anthropic scoring).
- Decide together: fixed slot to film the final demo video (recommend Sat evening, regardless of build state).
- Resolved (Jamshed): upload storage = pre-loaded demo videos only (no cloud storage; not a sponsor track). Files live in frontend/public/demo; the browser plays /demo/<file>, and createVideo gets sourceUrl `demo:<file>` which the worker resolves (DEMO_VIDEOS_DIR overrides). TM: UploadPanel offers "Original"/"Revision" demo picks instead of drag-drop when on SpacetimeDataSource.
- Resolved: transcription = local Whisper (Xenova/whisper-base.en), ~4 s warm on an 18 s clip, parallel with frame extraction; Claude (~15 s) is the slow step.
- Transcription tool, authentication implementation, and engagement-score normalization (resolve during implementation spikes).
- Final demo-video production owner and recording slot, after the core app is built and before rehearsal.
- Resolved: JEV and Anthropic API access confirmed; track requirements confirmed (see Event).

## Status log
- Fri ~23:30 PT Scoped MVP. ~34 h to submission.
- Fri ~23:45 PT Stack chosen (TS, Anthropic SDK, JEV, SpacetimeDB, React/shadcn). .gitignore and .env.example created.
- Sat ~00:00 PT Added Apify and Fetch.ai to MVP stack. Build order: sim + cascade first, agents wrap it second, Apify third.
- Sat ~00:30 PT PRD review: two-video variants, mixed twin audience, weighted-engagement winner, react-force-graph-3d, Python agent service, sim spec, sponsors placed in the journey, ownership split. Next: JEV spike.
- Sat ~00:45 PT JEV + Anthropic API access confirmed; track requirements confirmed; transcription is required.
- Sat ~00:50 PT Transcription deferred; reel summaries use frames + on-screen text for now. Next: JEV spike.
- Sat 2026-10-24 PRD clarification: broader small-business/stealth marketing product; Giving Garden confirmed as demo. Signup/onboarding, private audience simulation, historical reference analysis, timestamped feedback, rewritten hooks/scripts, and grounded follow-up chat are core. Automatic editing is stretch. Final demo videos will be produced after the core build; recommend an early temporary clip for pipeline validation. Current sections above supersede conflicting historical scope decisions.
- Sat 2026-10-24 JEV role corrected per user: classify scraped candidate reels for niche relevance before Anthropic video analysis, reducing potentially unnecessary downstream work. Anthropic handles deep analysis, simulated audience reactions, and marketing assistance. Noul returns a yes probability; routing thresholds and end-to-end savings require evaluation.
- Sat ~00:50 PT Adopted the new PRD on fawaz-backend (merged main). Updated Fetch.ai agent roles to the new flow, Team table, open decisions. Next: video spike + simulation spike on a temporary clip, then upload -> analysis -> simulation -> report.
- Sat 10:07 PT hack-check: Build phase, ~23.4 h left. Frontend (TM, `shayer` branch, unmerged) is full UI on mocks; backend has no code yet, no sponsor API called. Weakest: Functionality/Technical complexity. Next: Jamshed builds analyseVideo + startRun (Haiku scoring, cascade, SpacetimeDB) against SimDataSource.
- Sat ~10:40 PT Backend landed on fawaz-backend: SpacetimeDB TS module (backend/spacetime) mirroring frontend/src/data/types.ts, job queue, cascade ported from TM`s mock running inside a reducer (500 members/200 trials ~265 ms locally), worker (backend/worker) with Apify Reel Scraper. Jamshed took Apify from TM. Tables are public-read until the auth decision. Not yet: Apify run through the worker (needs APIFY_TOKEN), Maincloud publish (needs spacetime login), Haiku scoring/video analysis jobs.
- Sat ~11:00 PT Decision (Jamshed): JEV also scores the audience (per-member typed probabilities); Haiku writes member explanations on demand and is the scoring fallback. JEV still filters reference reels.
- Sat ~11:20 PT JEV scoring spike (backend/worker/spikes/score-test.ts): 300/300 valid, 72 ms p50, $0.01, revised > original in every repeat and all 6 groups, per-member drift ~0.01. Rates 10-30x too high -> fixed per-signal calibration (likes/comments from Apify reference reels, share 10% declared).
- Sat ~11:20 PT score_run built (Sonnet builder, reviewed): JEV scoring with calibration, decisions in batches, cascade in the module; a bad JEV key now fails the run with the real cause. Calibration v1 (backend/worker/scripts/calibrate.ts): 40 reels from @bontonfarms, @grownorthtexas, @tarrantareafoodbank, @feedingamerica; observed likes 3.71%/play, comments 0.07%/play; multipliers like 0.173, comment 0.0049, share 0.574 (10% target), watch 1. Giving Garden (@thegivinggarden_ntx): 26 followers, 4 posts, reels of 144 and 60 plays (3 and 1 likes, 0 comments).
- Sat ~14:45 PT Upload storage decided: pre-loaded demo videos (frontend/public/demo, sourceUrl `demo:<file>`), worker support landed. analyse_video measured: 21.6 s on 18 s clip, Claude ~15 s, Whisper ~4 s warm (parallel). Next: TM wires demo picks in UploadPanel; optional speed test with fewer/smaller frames.
- Sat ~12:50 PT hack-check (Build, ~20.5 h left). Weakest: Functionality/Quality (backend journey works only via CLI; UI still on MockDataSource; no report/chat). Tracks not yet met: Spacetime (no frontend subscription), Fetch.ai (nothing built). Drift: TM's last ~4 h of commits are Mii characters. Next: TM builds SpacetimeDataSource + demo picks; Jamshed takes report + follow-up chat backend.
- Sat ~13:25 PT Report + follow-up chat backend landed (Jamshed owns). On Maincloud: `report` table (one row per run, auto-queued when the cascade completes; status writing/ready/failed; fields = frontend Report), `chat_message` table, reducers `send_chat_message(runId, content)` and `request_report(runId)` (retry). Worker jobs write_report (Haiku 5.5, JSON schema, timestamps and reel citations validated; reel metrics and assumptions written by code) and chat_reply (Haiku, grounded in profile, transcript, run, members, reels, report). Measured on the demo videos, 300 members: report ~10 s / $0.002, chat reply ~4 s / $0.001. Video rows now carry analysisJson (transcript, on-screen text, notes). TM: SpacetimeDataSource.getReport = subscribe `report` where runId; chat = call send_chat_message, render `chat_message` rows by id (pending = typing).
- Sat ~13:50 PT Job progress stages: `job.stage` (string, set by the worker via set_job_stage while claimed). Video: "Loading the video" -> "Sampling frames and transcribing speech" -> "Reading the video with Claude". Run: "Scoring n/300 members" (every 25) -> "Saving predictions" -> "Running the sharing simulation". Also report, chat and scrape stages. TM: find the job by kind + targetId (video id / run id) and show `stage` while status is queued/claimed.
- Sat ~15:00 PT Parallel agents (3 builders + reviewer), all live on Maincloud: (1) JEV niche filter runs after every scrape (>=0.6 retained, <=0.3 rejected, else uncertain): 15 reels -> 12 retained, 3 uncertain, $0.0004. (2) `request_explanation(runId, memberId)` -> Haiku 1-3 sentences into decision.explanation (~2 s, $0.0002), cached. (3) `compare_runs(baseRunId, revisedRunId)` -> `comparison` row: matched-member mean deltas overall and per group, metric deltas, spreads, verdict (port of ComparePanel rule: winner only if each p50 is outside the other's p10-p90 band; coverage < 0.8 -> inconclusive), Haiku summary. Original vs revised: revised wins, watch 22.7% -> 35.5%, share 11.9% -> 18.3%. Review fixes: worker restart re-queues its claimed jobs; fail_job never overwrites delivered results; create_video only accepts demo: sources.
- Sat ~17:35 PT SpacetimeDataSource built (Jamshed), on fawaz-backend after merging TM's shayer via PR #2 into main. frontend/.env.local `VITE_DATA_SOURCE=spacetime` (+ HOST, DB; see frontend/.env.example) switches the app to the live backend; unset = mock. Browser keeps an anonymous identity (localStorage); profile id is scoped per identity. Onboarding audience is generated in the browser and saved with save_audience. UploadPanel has "Original demo" / "Revision demo" buttons (drag-and-drop kept; real upload is a stretch goal). SimDataSource gained explainMember (VillagerCard fetches on open) and compareRuns (ComparePanel shows Claude's written comparison). End-to-end from Node against Maincloud, 500 members: both videos, both runs, report, chat, explanation, comparison in ~70 s.
- Sat ~16:25 PT hack-check (Build, ~17 h left). Weakest: Functionality/Quality (live journey proven from a Node script, not yet clicked through in a browser; Fetch.ai not started). Tracks: Spacetime met (live subscriptions UI <-> worker), Apify met, Anthropic met, Fetch.ai NOT met. Drift: TM's last ~3 h are island textures/grass while Fetch.ai is untouched. Next: Jamshed browser-tests the live journey; TM starts the Fetch.ai agent now.
