# Frontend — audience simulation island

Login → onboarding → a 3D island town, lit at late afternoon, where a simulated
audience watches a campaign video and decides what to do with it.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
```

Sign in with any well-formed email and a 6+ character password — authentication
is local-only until the backend driver lands.

## How it fits together

The rule that keeps the island at 60fps: **the simulation never re-renders
React.** `IslandSim` is a plain TypeScript class holding villager state in flat
typed arrays, stepped once per frame from a single scene-level `useFrame` that
writes straight to `Object3D` transforms. React renders the chrome only, and
zustand carries the small amount of state that crosses the boundary (selected
villager, current round, aggregate metrics), updated on round boundaries rather
than per frame.

```
src/
  auth/            AuthDriver interface + local driver
  onboarding/      3-step wizard that builds the company profile
  data/
    types.ts         the shared vocabulary
    SimDataSource.ts the seam between UI and backend
    mock/            audience generation, cascade engine, report, chat
  island/
    scene/
      island.ts      tile grid, coastline, roads, plots (pure TS, no React/three)
      IslandSim.ts   movement + reactions over the walkable tile graph
    Terrain.tsx      instanced land tiles, fountain, street lamps
    Water.tsx        sea shader: swell, coastline foam, sun glitter
    Town.tsx         instanced buildings, tinted per instance
    Villagers.tsx    rig clones + THE single useFrame
    AnimationBudget  distance/frustum LOD for skeleton updates
    fx/              reaction emotes, share trails, ambient chatter, group rings
  sidebar/         Overview charts and controls; Assistant conversation
  store/           zustand + profile persistence
```

### `SimDataSource`

Everything the UI needs from the simulation backend, and nothing about how it
gets there. `MockDataSource` runs the whole cascade in the browser from a seed;
`SpacetimeDataSource` will map the same calls onto owner-scoped SpacetimeDB
subscriptions. Both stay wired at the expo — the mock is also the offline
replay fallback, so it is not throwaway.

To add the real driver: implement the interface, and swap the instance in
`store/useAppStore.ts`. No screen changes.

### Simulation assistant

Uploaded videos stay in the receiving worker's local `uploads` folder. Workers
sharing one database check that the exact upload is a readable local file before
claiming its analysis job; other workers leave it queued for the receiving machine.
Existing `upload:<filename>` sources keep working, with no schema migration.
**Update and restart every connected worker** for this routing rule to apply.
An older worker on another machine can still claim and fail a local upload until
it is updated or stopped. A previously failed analysis does not requeue itself:
after restarting the workers, choose the original video again to create a fresh
analysis request. This recovery is explicit and may run analysis again; the app
does not submit it automatically. Run `npm run test:uploads` in `backend/worker`
for the offline ownership, race and malformed-source regression tests.

The simulation sidebar has exactly two tabs: **Overview** and **Assistant**.
Overview shows compact response charts, expected outcomes and campaign-option
comparisons for ideas; video runs show final reach, independent action bars and
trial variability beside the original video player. Selected residents appear as compact
cards inside Overview, with personality and response probability bars. Selecting
a resident does not request a paid generated explanation. Full report prose,
assumptions and analysis remain in the store and in the assistant's grounding.
Saved video runs without replay events use their stored final totals and group
metrics. They do not borrow the current audience's denominator. Missing idea
predictions are excluded from response-chart denominators and counted explicitly.
Video signals come from analysis; the sharing network is collapsed by default.

Use the arrow keys, Home and End to switch tabs. **Assistant** remains available
while inspecting a resident, and **Ask assistant** carries that resident into the
conversation. The overview's charts include numeric legends and accessible labels.
Run `npm run test:overview` for chart-summary and saved-result regressions.

Video uploads and demo selections automatically analyse the footage, start one
simulation, and wait for both resident predictions and the report. The campaign
hub shows **Preparing results** until the finished result can open. There is no
manual Run step, round countdown or cascade playback control. The island applies
the final events together; existing history opens at its final result.
Preparation belongs to the store action, so route remounts do not submit another
run or cancel its subscription. A synchronous input guard also prevents repeated
demo clicks from starting duplicate uploads while the demo file is fetched.

Choosing one demo, uploading one video, or reopening one campaign exits any
previous comparison. An explicit comparison analyses both videos first, then
starts exactly one run per side; campaign creation does not add preliminary runs.

Failures offer **Retry results**. A failed simulation can be retried explicitly;
a successful simulation with a failed report retries only report generation.
Reattaching the original file to a completed historical result restores video
playback without another analysis or simulation. A legacy campaign without a
result prepares automatically when its file is available or reattached.
Run `npm run test:video-results` for the offline store workflow regressions, and
`node scripts/spacetime-connection.test.mjs` for live-driver retry semantics.

Open **Assistant** in the simulation sidebar after an idea report is ready or a
video run completes. **No video is required for idea-report questions.** Ask
about the report, results, simulation mechanics, or any resident's personality
and predicted reactions. A resident's detail panel also has **Ask assistant**.
Conversations, drafts and pending replies stay separate for each signed-in user,
profile, data source and report subject while the page is open, including when switching
tabs. The visible conversation is held in memory and resets on page reload;
the live backend keeps its conversation rows and uses its most recent 20 turns
for follow-ups. Idea and video IDs have separate namespaces, so idea `1` and
video run `1` cannot share a conversation. Switching subjects cannot redirect
an in-flight reply into another conversation. An active idea view takes
precedence over any previous video still in memory. Questions are limited to
2,000 characters. The assistant's buttons and textarea use shadcn/ui registry
primitives adapted to the existing theme; other sidebar controls are unchanged.

The existing live path is `ChatPanel` → `SimDataSource.chat` → SpacetimeDB's
`sendChatMessage` → worker `chat_reply` → `setChatReply`. The worker reads the
completed run's analysed video, all saved resident personality snapshots and
predictions, sharing graph, canonical round events, aggregate results, and the
report when it is ready. Report assumptions and rewritten hooks are included.
Missing predictions, unavailable events and unfinished reports are identified
explicitly. The assistant distinguishes model probabilities from actions in the
simulation replay; suggested explanations are inferences rather than measured
causes. Saved personality snapshots include the three most important memories,
not every source memory or family relationship.

For a no-video idea, `SimDataSource.chatIdea` uses `sendIdeaChatMessage`, the
`idea_chat_message` table and the `idea_chat_reply` worker job. It never calls
video grounding. Its evidence includes the original request, parsed idea and
target, budget and options, computed metrics, structured and plain-language
reports, resident probabilities/reasons and the matching saved personalities.
Idea visit/return/share predictions are raw and uncalibrated; return and share
are conditional on visiting once. No video timestamps, watches or cascade
rounds are invented. New idea tests capture their audience version. Historical
reports without one remain answerable, but their exact personality snapshots
are explicitly unavailable rather than borrowed from today's audience.

For live AI, use `VITE_DATA_SOURCE=spacetime` with the existing frontend
SpacetimeDB host/database configuration. Set `ANTHROPIC_API_KEY` in the
repo-root worker `.env`, alongside `SPACETIME_DB` and `WORKER_SECRET`, and run
the worker from `backend/worker` with `npm start`. The database module must
already be running with the registered worker. Keep the key on the worker;
never put it in a `VITE_` variable or browser code. No additional chat server
or dependency is needed. Without the live worker and key,
AI requests fail with an error in the conversation. The mock driver provides
explicitly labelled scripted video-demo replies, not live AI or full personality
Q&A. Idea testing and idea chat require the live source; the mock reports this
requirement explicitly.

The idea-chat schema requires publishing the updated SpacetimeDB module before
running the updated worker/frontend against an existing deployment. This change
adds `idea_chat_message` and appends `idea_test.audienceVersion` with an absent
default, preserving old idea rows without guessing their version. New idea
conversations use explicit per-conversation sequence numbers; existing video
chat uses transaction timestamps with user-before-assistant ordering for a
question and reply created in the same transaction. Client bindings were
generated from source with SpacetimeDB CLI 2.13.0 for both frontend and worker.
The implementation does not publish or reset the database automatically.

Run the focused regressions with `npm run test:chat` in both `frontend` and
`backend/worker` (Node 22.18+). These cover conversation isolation, in-flight
replies, question limits, complete resident grounding, history boundaries,
no-video idea reports and isolation between equal idea/video IDs.

### Performance

~48 animated skinned characters. The constraint is CPU (mixer evaluation and
bone matrices), not draw calls, and plain `InstancedMesh` cannot skin. So
`AnimationBudget` updates each rig's mixer at a stride set by camera distance
and frustum membership, staggered by index, accumulating the skipped time so
playback speed stays correct. Villagers share one material taken from the
loaded GLTF; static scenery is genuinely instanced.

The island is a grid of tiles rather than a disc: the coastline is generated by
perturbing a radius and subtracting a bay, and the whole landmass — inlets,
piers and all — draws as one instanced mesh with per-tile colour carrying the
roads and plaza. Buildings are placed on tiles that face a street.

Buildings sit on 2×2 tile plots, not single tiles: a house model is ~3.6 units
across and a tile is 2.4, so one-tile placement overhangs into the road and
residents walk through walls.

Measured 119.3 fps at 1216×950 with shadows and bloom on, i.e. display-capped.
Shadows are enabled by default. `AUDIENCE_SIZE` in `store/useAppStore.ts`
controls the resident count.

### Look

One low, strongly orange key light with a cool blue fill opposite it, ACES tone
mapping, and a deliberately narrow fog band that starts just beyond the island
so the town stays crisp while open water burns out to the sky colour. Bloom and
a vignette finish it; street lamps have emissive heads so each one flares.

Three numbers here are more sensitive than they look:

- **Fog near/far** (`IslandCanvas.tsx`). Widen the band and the horizon goes
  dark green; narrow it and the island goes hazy. The fog colour must equal the
  background exactly or the water plane's edge shows against the sky.
- **Water plane size vs camera `far`.** A plane's corners are √2 further from
  the camera than its centre, so an over-large plane gets sliced by the far
  clip — which reads as two hard diagonal cuts across the horizon and looks
  exactly like a fog bug.
- **Sparkle frequencies** (`Water.tsx`). Multiplying two axis-aligned sines
  gives a perfect polka-dot lattice; the frequencies are deliberately
  non-orthogonal so peaks never align twice.

The sea splits into two jobs. **Shoreline foam** is shaped procedurally and
placed by a chamfer distance field built from the island's own tiles, so it
follows the real coastline into the bay and around the piers rather than being
a ring at a fixed radius. **Open water** is textured from the foam maps in
`public/textures/`, tiled coarsely and advected along a flow map — sampled at
two phases half a cycle apart and cross-faded, so it churns in a direction
instead of sliding as one rigid sheet.

The maps were tried on the coastline too and reverted: their Voronoi cells give
wispy streaks radiating off the shore, where the procedural ripple gives a
denser band that sits better against the stepped tiles.

The maps are optional. Without them the open water falls back to a procedural
sparkle, so the sea still works on a clean checkout.

### Reproducibility

Nothing in the simulation calls `Math.random()`. The audience, graph, starting
exposure and every trial derive from seeds, so an original and a revision are
compared against an identical network — which is the only thing that makes "the
revision did better" mean anything.

## Honesty

Every number here is a model's output, never a measurement, and the UI says so
in a strip pinned to the bottom of the sidebar that cannot be scrolled away.
Reach and interactions are reported separately and never summed. A member whose
scoring batch failed is counted as exposed but excluded from the action totals
rather than treated as a zero. A comparison whose trial ranges overlap is
reported as inconclusive instead of picking a winner.

Asset and library credits: [`public/ASSET-CREDITS.md`](public/ASSET-CREDITS.md).
Residents are Kenney's CC0 Mini Characters and the town is built from Kenney's
CC0 city kits; no Nintendo assets are used. Ambient speech bubbles are
decoration and deliberately carry no opinion — only the emoji reactions come
from the simulation.

## Idea consistency tests

Run `npm run test:ideas` for offline coverage of the production idea pipeline and evaluation harness. Run `npm run eval:ideas -- --live` to evaluate 48 idea inputs across five repetitions and all 50 Millbrook residents, with fresh calls, fixed-payload diagnostics, and isolated-cache replay. Live credentials are read from the repository-root `.env`; no database is contacted.

See [`scripts/idea-eval/README.md`](scripts/idea-eval/README.md) for acceptance criteria, smaller runs, resumption, and JSON/CSV/Markdown reports.
