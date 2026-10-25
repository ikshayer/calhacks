# VIDEO.md: demo video script (target 3:30, hard limit 3:00-5:00)

One-liner: **Find out who shares it before you post it.**

Roles: **Driver** (hands on laptop, clicks only what is written), **Narrator** (voice-over; narrate outcomes, not clicks). Record screen + mic in one take per section; jump cuts between sections are fine.

Rule for every line: only read numbers that are on screen in that take. If a number differs from what's written here, say the one on screen.

---

## Before you hit record (checklist)

- [ ] Worker running on this laptop (one worker only).
- [ ] Agents running: `run_split.py workers`, then `run_split.py orchestrator`.
- [ ] Cache warmed: run **Original**, **Reworked** and the A/B pair (Original vs Reworked) once each, so the takes open in seconds (stage text shows "(cached)").
- [ ] **Pre-run the ASI:One chat once** (`test demo`), and keep that finished chat open in a second tab as the fallback shot. A live run takes 1-2 minutes.
- [ ] Logged in, campaigns page open, browser zoom **125%**, bookmarks bar hidden.
- [ ] Notifications off (Windows Focus Assist on, Slack/Discord/Messages quit), phone silent.
- [ ] Tabs in order: 1) app campaigns page, 2) ASI:One with the agent profile, 3) finished ASI:One chat (fallback).
- [ ] Mic check: 10-second test recording, play it back.
- [ ] After editing: upload to **YouTube (Unlisted)** or **Loom**, open the link in a private window to confirm it plays without login, paste the **public link** into Devpost.

---

## Shot list

| # | Time | On screen (exact clicks) | Narration (spoken) |
|---|---|---|---|
| 1 | 0:00-0:20 | **Hook and problem.** Sign-in page left panel ("Find out who shares it before you post it." headline cycling), then cut to the campaigns page (org name, "Test a campaign before you publish it."). No clicks. | "Small teams get one shot at a campaign video. Post a weak one and you've lost a week and your budget. And a stealth company can't test in public at all. Jim runs The Giving Garden. He needed volunteers, got under half, and harvested food went undistributed. His Instagram has three posts. So we built a way to find out who shares it before you post it." |
| 2 | 0:20-0:35 | **Video test, upload.** In "Drop a video here", under "or try a demo:", click **Original**. Card shows "Preparing results..." then the island opens on its own. | "This is Jim's current video. It's analysed privately, frames and speech, sent only to the worker on this laptop and never posted, and the result opens on its own." |
| 3 | 0:35-1:00 | **Island replay.** Let the cascade play. Hover the sidebar **Overview** tab: point the cursor at **Simulation results** (Reached, percent, then the "200 trials · actions" P10 / P50 / P90 bar, Watched / Liked / Commented / Shared). | "Three hundred simulated residents decide whether to watch, like, comment or share. When someone shares, their connections see it next round, for up to six rounds. Here's how many it reached, [read the Reached number and percent], and the spread of actions across two hundred trials. To be clear: these are simulated residents of a fictional town. Fifty are hand-written, two hundred and fifty are derived neighbours. It ranks versions; it doesn't forecast real numbers." |
| 4 | 1:00-1:15 | **Resident.** Click one resident on the island. Sidebar shows name and portrait, **Personality** bars, **Predicted actions** (Watch / Like / Comment / Share, "Per exposure · predicted probabilities"), **In the replay** pills, **Connections**. | "Every resident has a personality, connections, and predicted chances for each action. Here, [name], and the people they'd pass it to." |
| 5 | 1:15-1:35 | **Assistant.** Click **Ask assistant** (or the **Assistant** tab). Click the suggestion **"Summarize the report and the simulation results."** Let the reply stream; scroll once. | "Why did they react that way? The assistant answers. It summarises the report with timestamped feedback and rewritten hooks, grounded in this simulation, and you can keep asking follow-ups, like what held back sharing." |
| 6 | 1:35-2:05 | **A/B.** **← Campaigns**. In "Compare two videos, side by side.": type the goal "I'm trying to attract volunteers to help with harvest and distribution at the farm." Video A: pick demo **Original**. Video B: pick demo **Reworked**. Click **Run A/B test** (cached: opens in seconds; otherwise jump-cut past "Analysing both videos together…"). In the sidebar, toggle **Video A** / **Video B**, then click **See A vs B →** and point at the comparison in Overview. | "Then you test a re-cut. This Reworked version was written by Claude from Jim's own photos, following the simulator's advice. Same audience, same starting exposure, same trial seeds. Flip between them on the island. It only calls a winner if the gap is outside the simulation's own range; otherwise it says too close to call. [Read the verdict on screen.] And since the re-cut followed the simulator's own advice, a win here is a model assessment, not proof." |
| 7 | 2:05-2:20 | **Idea test (optional, cut if over time).** **← Campaigns**. In "No video yet? Test an idea.", show a pre-run idea from history, or type an idea and click **Run**, then jump-cut to the result. | "No video yet? Describe the idea, and the same town tells you who'd come and why not." |
| 8 | 2:20-3:15 | **Fetch.ai agents in ASI:One.** Switch to tab 2: https://agentverse.ai/agents/details/agent1q2mslcxwezpm5j7y7tyes754pagc3mv4qd3ampfhcm92rx63w3y62qz9vjg/profile. Click **Chat with Agent**. Type `test demo`, press Enter. Show the first two or three progress lines streaming, then **jump-cut** (or switch to tab 3, the pre-run chat) to the final reply: reach, actions, the report summary, and the disclosure. Scroll slowly through it. | "The same workflow runs from a chat. In ASI:One, Jim talks to our agent over the Fetch.ai Agent Chat Protocol. Behind it are three agents. An orchestrator takes the request, an ingest agent registers the video, and a simulation agent runs the town. They don't fake anything: they call the same SpacetimeDB reducers the browser calls, and the same worker does the scoring. [Cut.] A run takes a minute or two, so we've skipped ahead. It comes back with reach, the actions, the report summary, and a plain disclosure that this is a simulated audience." |
| 9 | 3:15-3:35 | **Architecture one-liner.** Back to the app island (or a still of the architecture sketch if you have one). No clicks. | "Under the hood: Apify pulls real reels from similar accounts, and JEV filters them for the niche. Claude reads the uploaded video and writes the report. JEV scores every resident, calibrated so like and comment rates match those real reels. And the cascade runs inside SpacetimeDB, which streams it live to the browser and to the agents." |
| 10 | 3:35-3:50 | **Honest limits + close.** Campaigns page, or the sign-in headline again. | "What's not real yet: the audience is fictional, the share rate is a declared assumption, and the worker runs on a laptop. Next we check our rankings against real posted reels. Find out who shares it before you post it." |

Total: about 3:50 with the optional idea test; about 3:35 without it (the 3:30 target). If still long, trim shot 8 to 45 seconds. The demo buttons Original, Revision and Reworked all exist; this script uses Original and Reworked only.

---

## Editing notes

- Jump cuts allowed at: the "Preparing results..." wait (shot 2), A/B analysis wait (shot 6), idea run (shot 7), and the ASI:One run (shot 8). Keep the first streamed progress lines on screen before cutting so viewers see the agent actually working.
- Shot 8 is required for the Fetch.ai track: the agent profile URL, the **Chat with Agent** click, the `test demo` message and the final reply must all be visible.
- Never read a resident's "reason": the resident panel shows no written reason; the Assistant explains.
- No captions needed, but if adding one, put "Simulated residents of a fictional town. Rankings, not forecasts." on shot 3.
