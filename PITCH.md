# PITCH.md

Format (HACK.md): expo table, demo cutoff Sun 10:30 PT, finalists may pitch on stage. One laptop at a noisy table; judges arrive mid-pitch and leave early. Default: 2 minutes plus 1-2 minutes of questions.

**One-liner (the app's own headline):** *Find out who shares it before you post it. Upload a campaign video, watch a simulated audience decide what to do with it, and see what to change, privately, while there is still time to re-cut.*

**Who it's for (HACK.md):** small companies with limited budgets for campaign experiments, and stealth companies that cannot test unreleased work in public. Demo customer: Jim at The Giving Garden.

## Roles (proposed, change freely)
| Role | Who | Job |
|---|---|---|
| Driver | Jamshed | Hands on the laptop, follows the script, never improvises clicks |
| Narrator | TM (Shayer) | Tells the story while the driver demos; owns island and UI questions |
| Tech answers | Jamshed | Simulation, calibration, SpacetimeDB, worker |
| Fetch.ai + backup | Arian | ASI:One demo, holds the backup video and phone hotspot, watches the clock |

## 2-minute script (spoken)

**Open (15 s)** — *Narrator, campaigns page already open*
"Small teams get one shot at a campaign video. Post a weak one and you've lost a week and your budget, and a stealth company can't test in public at all. Jim at The Giving Garden needed volunteers, got under half, and harvested food couldn't be distributed. So: find out who shares it before you post it."

**Demo (75 s)** — *Driver clicks, Narrator narrates outcomes, not clicks*
1. (15 s) *Drop in the "Original" demo video.* "This is Jim's current video. It's analysed privately, frames and speech, and the result opens on its own." *(Cached: opens in seconds.)*
2. (20 s) *Island replay plays.* "Three hundred simulated residents decide whether to watch, like, comment or share, and shares spread to their connections round by round. Here's how many it reached, the actions across 200 trials, and which groups responded." *Read the numbers off the Simulation results panel.*
3. (10 s) *Click one resident.* "Each resident has a personality and connections, and predicted chances for each action."
4. (15 s) *Assistant tab, press "Summarize the report and the simulation results."* "The assistant gives timestamped feedback and rewritten hooks, grounded in this simulation, and you can ask follow-ups."
5. (15 s) *A/B card, Original against Reworked, then the Video A / Video B toggle.* "Then you test the re-cut against the same audience and starting exposure. It only calls a winner if the gap is outside the simulation's own range; otherwise it says too close to call." *Read the result off the screen.*

**Honesty line (during step 2, 5 s):** "These are simulated residents of a fictional town. It ranks versions; it doesn't forecast real numbers."

**Tech (20 s)** — *Tech answers*
"Apify pulls real reels from similar accounts and JEV filters them for the niche. Claude reads the uploaded video. JEV scores every resident, calibrated so like and comment rates match those real reels, and the cascade runs inside SpacetimeDB, which streams it live to the browser. The same flow runs from ASI:One chat through Fetch.ai agents."

**Impact (10-15 s)** — *Narrator*
"Test before you spend, and test unreleased work privately. No video yet? Describe the idea and the town answers that too. Next: validate rankings against real posted reels."

## 30-second version (judge walks up late)
"Find out who shares it before you post it. *(Island with a finished run.)* This is a simulated audience of 300 reacting to a campaign video: reach, actions and which groups passed it on. *(A/B card.)* Here's the original against a re-cut on the same audience. It's a ranking, not a forecast. The same thing runs from ASI:One chat."

## Disclose in one plain sentence during the demo
- Simulated residents of a fictional town, not measured engagement. 50 are hand-written; 250 are derived neighbours.

## Q&A (1-2 sentences each)
1. **Who is the user, and how do you know?** Small companies with tight budgets and stealth companies that can't test publicly. Our demo customer is Jim at The Giving Garden, a real client we've spoken to: he needed volunteers, got under half, and his Instagram has three posts with few views.
2. **What did you build versus use?** Built: the SpacetimeDB module (tables, reducers, job queue, the cascade with 200 trials), the worker pipeline, calibration, the derived town, the A/B rule, the island and UI, and the agents. Used: JEV, Claude, Apify, Whisper, ffmpeg, Remotion, uAgents, and third-party 3D assets.
3. **What's mocked or hardcoded?** The audience is fictional. The share rate is a declared 10% per exposure, not measured. Starting exposure is 10%. The ASI:One chat uses a fixed seed and replies in text; a pasted reel link falls back to the demo video and says so. The worker runs on our laptop. The demo videos are Remotion animations; the Reworked one was written by Claude.
4. **Hardest technical problem?** Making model probabilities defensible. JEV's yes-probabilities run far above real rates, so we fit one fixed multiplier per signal to real reels, never per video, so an A/B difference isn't erased; Claude only writes words around numbers code produced.
5. **How is this different?** Instagram analytics come after you post. Asking an LLM to rate a video gives no audience and no spread. We simulate the audience and the sharing, privately, before posting, and allow an inconclusive result.
6. **What breaks first at 1,000 users?** The single worker on a laptop, and JEV and Claude cost. The job queue is a table, so more workers can claim jobs, and results are cached. Tables are public-read today and would need owner-scoped reads.
7. **With another week?** Hold out real reels and check our rankings against what actually happened, measure shares instead of declaring them, and ingest any reel link.
8. **Which tracks?**
   - SpacetimeDB: the database and the live link between browser and worker.
   - Fetch.ai: an ASI:One agent over the Agent Chat Protocol (orchestrator, ingest and simulation agents).
   - Apify: reference reels from similar accounts.
   - Anthropic: video analysis, report and assistant for a named community.

**If asked whether the re-cut "proves" anything:** "No. It follows the advice the simulator gave on the original, so a higher simulated result is a model assessment, not proof of better real engagement." (HACK.md says exactly this.)

## Avoid
Long intro, clicking through onboarding, naming tools before the problem, any number not on screen, reading a resident's "reason" that the screen doesn't show.

## Before the table
- One worker running on this laptop; agents running (`run_split.py workers`, then `run_split.py orchestrator`).
- Warm the cache: run Original, Reworked and the A/B pair once, so the live runs open in seconds.
- Notifications off, zoom 125%, logged in, tabs: app, ASI:One shared chat, backup video.
- Phone hotspot ready, laptop charged.
- Start on time, keep it honest, answer with curiosity, thank the judges.
