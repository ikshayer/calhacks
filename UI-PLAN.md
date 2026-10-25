# UI Plan — Campaign hub + character-focused simulation

Status: proposed, not implemented. Written against the tree at branch `shayer`
(commit `76df204`), which has uncommitted work across `frontend/src/island/*` —
do not refactor those files while implementing this; only the additive hooks
listed in Phase 3 touch them.

Two features:

1. **Campaign hub** — the screen between onboarding and the island. Upload a
   campaign video, or reopen a previous analysis from history.
2. **Character focus** — in the simulation, the sidebar shows the audience-wide
   report by default; clicking a resident zooms the camera onto them, follows
   them as they walk, and replaces the sidebar with that one member's report.

---

## 1. Where this lands in the current app

Today `App.tsx` routes `/login → /onboarding → /workspace`, and the workspace
sidebar carries upload, run, metrics, report, chat and compare all at once.
Uploading and running are buried in a 384px column beside a 3D scene, and there
is no concept of a campaign that outlives a page reload — `MockDataSource` keeps
videos and runs in instance fields, `useAppStore` keeps them in memory, and only
the company profile is persisted (`store/useProfilePersistence.ts`).

So the work is: introduce a **Campaign** as a first-class, persisted entity;
give it its own route; and make the workspace a view *of* a campaign rather than
a place you configure one.

### Route map after this change

| Path | Component | Guard |
|------|-----------|-------|
| `/login` | `LoginRoute` | no session |
| `/onboarding` | `OnboardingRoute` | session, no profile |
| `/campaigns` | `CampaignsRoute` *(new)* | session + profile. Default landing. |
| `/workspace` | `WorkspaceRoute` | session + profile + `activeCampaignId`; otherwise redirect to `/campaigns` |

`/workspace` stays path-parameterless and reads `activeCampaignId` from the
store, matching how it already reads `activeRunId`. (A `/campaigns/:id` URL is a
nice-to-have; it is not worth the extra state sync before the deadline.)

---

## 2. Data model

### 2.1 New types — `frontend/src/data/types.ts`

Add below the video section. `VideoAnalysis` already carries `campaignId`;
nothing owns that id yet, and this is it.

```ts
// ---------------------------------------------------------------------------
// Campaign (one uploaded video and everything simulated against it)
// ---------------------------------------------------------------------------

export type CampaignId = string

/**
 * One campaign in the history list.
 *
 * A campaign outlives the page: the metadata, signals and run results are
 * persisted, but the video file itself is not — browsers cannot hand a `File`
 * back after a reload. `posterDataUrl` is a single captured frame so a restored
 * campaign still has a face in the list, and `videoAvailable` tells the UI
 * whether the player can be shown or the user has to re-attach the file.
 */
export interface Campaign {
  id: CampaignId
  profileId: string
  title: string
  /** Epoch ms. Sorted newest-first in the history list. */
  createdAt: number
  videoId: string
  videoName: string
  durationSec: number
  /** JPEG data URL of one frame, ~320px wide. Absent if capture failed. */
  posterDataUrl?: string
  /** False after a reload: metadata survived, the file did not. */
  videoAvailable: boolean
  signals: ContentSignals
  summary: string
  /** Newest last. */
  runIds: RunId[]
  /** Headline numbers from the most recent complete run, for the history card. */
  headline?: {
    runId: RunId
    uniqueExposed: number
    likes: number
    comments: number
    shares: number
    coverage: number
  }
}
```

Also extend `RunSummary`/`RunState` with `campaignId: CampaignId` so a restored
run knows which card it belongs to.

### 2.2 Store slice — `frontend/src/store/useAppStore.ts`

Add to `AppState`:

```ts
campaigns: Record<CampaignId, Campaign>
activeCampaignId: CampaignId | null

/** Analyse an upload and create the campaign that owns it. Returns its id. */
createCampaign(input: VideoInput, title: string): Promise<CampaignId>
/** Make a campaign current and point the workspace at its latest run. */
openCampaign(id: CampaignId): void
/** Re-attach a video file to a campaign restored without one. */
attachVideo(id: CampaignId, input: VideoInput): Promise<void>
deleteCampaign(id: CampaignId): void
```

Implementation notes:

- `createCampaign` calls the existing `analyseUpload` path (`source.analyseVideo`)
  then writes the `Campaign` record, sets `activeCampaignId`, `activeVideoId`,
  and clears `activeRunId`, `compareRunId`, `selectedMemberId` and `playback`.
- `openCampaign` sets `activeCampaignId` + `activeVideoId`, and sets
  `activeRunId` to the last entry of `runIds` that still exists in `runs`. It
  must also reset `selectedMemberId` to `null` and set
  `playback = { round: <that run's rounds.length>, playing: false, speed }` —
  the same "don't replay a finished run" rule `setActiveRun` already follows.
- `startRun` must push the new `RunId` onto `campaigns[activeCampaignId].runIds`
  and stamp `campaignId` on the `RunState`.
- The `complete` branch of the run subscription already patches metrics; extend
  it to also write `campaigns[campaignId].headline`.
- `deleteCampaign` must `URL.revokeObjectURL` the analysis `objectUrl` and drop
  the campaign's runs from `runs` (and unsubscribe them via the module-level
  `subscriptions` map) so a long session does not leak object URLs or sockets.

Selectors to add beside `selectActiveRun`:

```ts
export const selectActiveCampaign = (state: AppState): Campaign | undefined =>
  state.activeCampaignId ? state.campaigns[state.activeCampaignId] : undefined

export const selectCampaignHistory = (state: AppState): Campaign[] =>
  Object.values(state.campaigns).sort((a, b) => b.createdAt - a.createdAt)
```

`selectCampaignHistory` allocates a new array per call — wrap consumers in
`useMemo` over `state.campaigns`, or use `useShallow`, or Zustand will re-render
the list every store write.

### 2.3 Persistence — `frontend/src/store/useCampaignPersistence.ts` (new)

Mirror `useProfilePersistence` exactly: same `gardenlab.*` key namespace, same
per-user scoping, same "return `restoring` so routes don't redirect early"
contract, same validator-before-trust shape.

- Key: `gardenlab.campaigns.${userId}`.
- Persist a **serialisable projection**, not the live state: campaigns with
  `videoAvailable: false` and no `objectUrl`, plus, per run id, a trimmed
  `{ id, campaignId, label, videoId, options, status, metrics, report }`. Do
  **not** persist `rounds` or `decisions` — rounds are up to 6 × 500 member ids
  and would blow the ~5MB localStorage budget. A reopened historical campaign
  therefore shows its report and metrics but has no cascade to replay; the
  workspace must handle `rounds.length === 0` with a complete run (see §4.4).
- Guard the write in `try/catch` and log on `QuotaExceededError` — do not fail
  the app over history.
- Call it in `App.tsx` next to `useProfilePersistence` and `&&` the two
  `restoring` flags into the existing `Booting` check.

Poster capture helper — `frontend/src/data/videoPoster.ts` (new): seek a
detached `<video>` to `min(1, duration/2)`, draw to a 320px canvas,
`toDataURL('image/jpeg', 0.7)`. Reject quietly (resolve `undefined`) on error;
a missing poster is cosmetic. Reuse the object-URL cleanup pattern already in
`readDuration` in `UploadPanel.tsx`, and extract both into this module so there
is one place that decodes an uploaded file.

---

## 3. Feature 1 — the campaign hub

### 3.1 `frontend/src/routes/CampaignsRoute.tsx` (new)

Layout, one centred column at `max-w-[960px]`, matching `OnboardingRoute`'s
spacing language (that route is the closest sibling; reuse its `DotGrid`
background, header rhythm and `Button` usage so the two read as one product):

```
┌──────────────────────────────────────────────┐
│  Giving Garden                    Sign out   │  header: profile.name, link to /onboarding ("Edit profile")
│  Test a campaign before you publish it.      │
├──────────────────────────────────────────────┤
│  ┌────────────────────────────────────────┐  │
│  │   Drop a video here                    │  │  <CampaignDropzone />
│  │   It stays in this browser.            │  │
│  │   [ Choose a file ]                    │  │
│  └────────────────────────────────────────┘  │
├──────────────────────────────────────────────┤
│  Previous analyses                            │
│  ┌──────┐ Harvest day cut 2      3 runs      │  <CampaignCard /> ×N
│  │poster│ 24 Oct · 0:42          412 reached │
│  └──────┘ ████ likes ██ shares   [Open]  [⋯] │
└──────────────────────────────────────────────┘
```

Behaviour:

- Drop/choose → `createCampaign` → `navigate('/workspace')`. While analysing,
  the dropzone shows the existing "Reading the file…" state; errors render in
  place with the same copy `UploadPanel` uses today.
- Empty history → an `EmptyState` saying the first upload will appear here. Do
  not show a fake row.
- Clicking a card → `openCampaign(id)` → `navigate('/workspace')`.
- A card whose campaign has `videoAvailable: false` still opens; it shows a
  "Re-attach the video to play it back" affordance in the workspace (§4.1) and
  a small muted "video not stored" note on the card.
- `⋯` → delete, with an inline confirm (no modal). Deleting is destructive and
  irreversible; do not auto-delete anything.

### 3.2 New components

| File | Responsibility |
|------|----------------|
| `frontend/src/campaigns/CampaignDropzone.tsx` | File input + drag state + duration/poster read + error copy. Extracted from the top half of `UploadPanel`. |
| `frontend/src/campaigns/CampaignCard.tsx` | One history row: poster, title, relative date, duration, run count, headline metrics, open/delete. |
| `frontend/src/campaigns/CampaignHistory.tsx` | The list, its heading, its empty state, and the sort. |

`UploadPanel.tsx` loses the dropzone and keeps only the analysed-signals editor;
rename it `SignalsPanel.tsx` and update `Sidebar.tsx`. The "Replace" action
becomes "Upload a revision", which creates a *new campaign* linked by title
(`"<title> (revision)"`) — revisions are already modelled as separate runs
within one campaign via `RunPanel`, so do not introduce a second notion of
revision here.

### 3.3 Routing changes — `App.tsx`

```tsx
const onboarded = profile !== null && profile.name.trim().length > 0
const hasCampaign = useAppStore((s) => s.activeCampaignId !== null)
```

- `/campaigns` element: `onboarded ? <CampaignsRoute/> : <Navigate to="/onboarding"/>`.
- `/workspace` element: existing onboarded check, **plus**
  `hasCampaign ? <WorkspaceRoute/> : <Navigate to="/campaigns" replace/>`.
- Catch-all `*` → `onboarded ? '/campaigns' : '/onboarding'`.
- `OnboardingRoute.finish()` navigates to `/campaigns`, not `/workspace`, and
  its final button reads "Continue" rather than "Open the town".

Keep `WorkspaceRoute` lazy — it is still the three.js bundle boundary.

---

## 4. Feature 2 — the simulation UI

### 4.1 Sidebar: two modes

`Sidebar.tsx` gains one branch at the top of its body:

```tsx
const selectedMemberId = useAppStore((s) => s.selectedMemberId)
…
{selectedMemberId === null ? <GeneralReport … /> : <MemberPanel memberId={selectedMemberId} />}
```

- **No selection (general report)** — today's tabs, with two edits: the `Run`
  tab is renamed `Overview` and loses `UploadPanel`'s dropzone (now
  `SignalsPanel`), and the sidebar header gains a back control to `/campaigns`
  plus the campaign title and poster thumbnail.
- **Selection (member report)** — the whole scrollable area is replaced by
  `MemberPanel`. The tab bar is replaced by a back row ("← Everyone") so the
  mode switch is obvious and reversible with one click. `Esc` and clicking empty
  island both clear the selection (the latter already works — `Villagers`
  toggles `onSelect(null)` when the same instance is re-clicked; add a
  `onPointerMissed={() => onSelect(null)}` on the `<Canvas>`).
- Keep `AssumptionsStrip` pinned in both modes. It is a required disclosure and
  must not disappear just because a member is selected.

`VillagerCard.tsx` is deleted from `WorkspaceRoute`'s render tree; its content
moves into `MemberPanel` (see below). Keep the file only if you want the
floating card for the un-docked layout — otherwise remove it and its import so
there is one place that renders member detail.

### 4.2 `frontend/src/sidebar/MemberPanel.tsx` (new)

Sections, top to bottom:

1. **Identity** — DiceBear `openPeeps` portrait (lifted verbatim from
   `VillagerCard`), name, group dot + label, persona, interest pills.
2. **What they did in this run** — a short timeline derived from
   `run.rounds` (see selector below): "Saw it in round 2, shared by Maya →
   liked, shared on to 3 neighbours". If the run has no rounds (a restored
   historical campaign), show the decision probabilities only and a muted line
   saying the cascade was not stored.
3. **Chance of each action** — the `Probability` bars from `VillagerCard`,
   including the `decision.missing` → "No prediction" branch. That branch is a
   stated honesty requirement; keep its copy exactly.
4. **Why** — `decision.explanation` plus the existing "generated rationale for a
   simulated decision" disclaimer.
5. **Who they'd reach** — neighbour chips from `audience.adjacency[memberId]`,
   max ~8, each clickable to `selectMember(id)`. This is what makes the graph
   legible by walking it, and it costs one lookup.

New selector, in `frontend/src/store/selectors.ts` (new file, or beside
`selectActiveRun`):

```ts
export interface MemberTimeline {
  exposedAtRound: number | null
  /** Member ids who exposed them, if the exposure came from a share. */
  exposedBy: number[]
  actedAtRound: number | null
  kinds: ReactionKind[]
  sharedTo: number[]
  ignored: boolean
}

export function memberTimeline(rounds: RoundEvent[], memberId: number): MemberTimeline
```

Pure function over `RoundEvent[]`; derive, do not store. Memoise in the
component on `[run?.id, run?.rounds.length, memberId]`.

### 4.3 Camera: zoom to, and follow, the selected resident

`sim.x/y/z[index]` are live `Float32Array`s updated every frame by
`IslandSim.update`, so following is a read, not a new subscription.
`AnimationBudget.step` already takes `selectedIndex` and keeps that rig at full
animation rate, so the followed resident will not be the one that LODs out.

**`frontend/src/island/scene/followCamera.ts` (new)** — framing maths, no React:

```ts
/** Metres from the resident while following; below OrbitControls' usual floor. */
export const FOLLOW_DISTANCE = 13
/** Look at the head, not the feet, or the body sits at the bottom of frame. */
export const FOLLOW_HEIGHT = 2.4
/** Seconds the dolly-in takes. */
export const FOLLOW_EASE_SEC = 0.75
```

**`frontend/src/island/CameraRig.tsx` (new)** — rendered inside `<Canvas>`,
given `sim`, `followIndex: number | null`, and the `OrbitControls` ref:

- `IslandCanvas` must give `OrbitControls` a ref
  (`useRef<OrbitControlsImpl>(null)`, type from
  `three-stdlib`/`@react-three/drei`) and pass it down.
- On `followIndex` changing from `null` to a value: snapshot the current camera
  position and `controls.target` into a ref (the "home" view), and start a
  dolly: `phase = 'approach'`.
- `approach`, per frame: compute the resident's world position
  `p = (sim.x[i], sim.y[i] + FOLLOW_HEIGHT, sim.z[i])`; keep the *user's current
  orbit direction* (`camera.position − controls.target`, normalised) so the
  zoom does not wrench the view around; desired camera position
  `= p + dir * FOLLOW_DISTANCE`, with `y` clamped to at least
  `sim.groundHeight(x, z) + 4` so the camera never dips into terrain.
  `lerp` both `camera.position` and `controls.target` with
  `1 - Math.exp(-dt / (FOLLOW_EASE_SEC / 3))` (frame-rate independent). When
  `camera.position.distanceTo(desired) < 0.25`, switch to `phase = 'follow'`.
- `follow`, per frame: update **only** `controls.target` toward `p`. Leave
  `camera.position` to `OrbitControls`, so the user can still orbit and zoom
  around the person they are watching. This is the behaviour that makes it feel
  like a camera operator rather than a cutscene.
- Lower `controls.minDistance` to `6` while following and restore
  `ISLAND_VIEW.minDistance` on release, or the dolly-in will be clamped short.
- On `followIndex` → `null`: `phase = 'release'`, lerp camera and target back to
  the snapshot over `FOLLOW_EASE_SEC`, then idle.
- Call `controls.update()` after mutating `target` in every branch, and respect
  `useReducedMotion()` — when set, snap (no lerp) in all three transitions.
- Guard `followIndex >= sim.count` (stale index after an audience rebuild) and
  bail to `release`.

Everything here runs in one `useFrame` with no allocations in the loop — hoist
the `THREE.Vector3` scratch objects into `useMemo`.

**Also:** add a `<Html>`-free nameplate? Skip it. `SelectionRing` already marks
the person, and drei's `Html` costs a DOM layer per frame.

### 4.4 Restored campaigns with no cascade

A campaign reopened from history has a complete run with `metrics` and `report`
but `rounds: []` (§2.3). `WorkspaceRoute` must not look broken:

- `PlaybackBar` already renders with `received = 0`; add an explicit muted line
  "Cascade not stored — showing the saved report" instead of an empty scrubber.
- The island shows residents idle (no `applyRound` calls) — that is correct and
  needs no change; `useCascadePlayback` handles an empty array already.
- Offer "Run it again" in the `Overview` tab, enabled only when
  `videoAvailable` (the signals are stored, so the re-run is legitimate and
  reproduces the same seed).
- `MemberPanel` falls back to probabilities-only, as stated in §4.2.

---

## 5. File-by-file summary

**New**

```
frontend/src/routes/CampaignsRoute.tsx
frontend/src/campaigns/CampaignDropzone.tsx
frontend/src/campaigns/CampaignCard.tsx
frontend/src/campaigns/CampaignHistory.tsx
frontend/src/data/videoPoster.ts
frontend/src/store/useCampaignPersistence.ts
frontend/src/store/selectors.ts          (memberTimeline + campaign selectors)
frontend/src/sidebar/MemberPanel.tsx
frontend/src/island/CameraRig.tsx
frontend/src/island/scene/followCamera.ts
```

**Modified**

```
frontend/src/App.tsx                     routes, guards, campaign restore
frontend/src/data/types.ts               Campaign, CampaignId, RunSummary.campaignId
frontend/src/store/useAppStore.ts        campaigns slice, create/open/attach/delete, run↔campaign link
frontend/src/routes/OnboardingRoute.tsx  finish() → /campaigns
frontend/src/routes/WorkspaceRoute.tsx   drop VillagerCard, pass follow index, onPointerMissed, Esc
frontend/src/island/IslandCanvas.tsx     OrbitControls ref + <CameraRig/>
frontend/src/sidebar/Sidebar.tsx         two modes, campaign header, tab rename
frontend/src/sidebar/UploadPanel.tsx     → SignalsPanel.tsx (dropzone removed)
frontend/src/sidebar/PlaybackBar.tsx     "cascade not stored" state
```

**Deleted**

```
frontend/src/island/VillagerCard.tsx     (content absorbed by MemberPanel)
```

---

## 6. Build order

Each phase ends compiling and demoable. Do not start the next until the
previous one runs in the browser.

**Phase 1 — campaign model and persistence (no UI).**
Types, store slice, `videoPoster.ts`, `useCampaignPersistence`, wire into
`App.tsx`. Verify by creating a campaign from the console
(`useAppStore.getState().createCampaign(…)`), reloading, and confirming it
survives with `videoAvailable: false`.

**Phase 2 — the campaign hub.**
`CampaignsRoute` + the three components + routing + onboarding redirect +
`UploadPanel` → `SignalsPanel`. Acceptance: fresh account goes
login → onboarding → campaigns; uploading opens the workspace; reloading and
clicking a history card reopens the same campaign with its report.

**Phase 3 — camera follow.**
`followCamera.ts`, `CameraRig`, `OrbitControls` ref, `onPointerMissed`.
Acceptance: clicking a resident dollies in over ~0.75s and tracks them while
they walk; dragging still orbits around them; clicking empty water returns to
the opening view; `prefers-reduced-motion` snaps instead.

**Phase 4 — member report.**
`memberTimeline`, `MemberPanel`, `Sidebar` mode switch, delete `VillagerCard`.
Acceptance: selection swaps the sidebar, "← Everyone" restores the previous tab
(not a reset to `Overview`), the assumptions strip stays visible, neighbour
chips navigate between members and the camera follows each one.

**Phase 5 — restored-campaign edges + polish.**
§4.4 states, delete confirm, quota handling, empty states.

---

## 7. Verification

Run from `frontend/`:

```
npm run lint          # oxlint
npm run build         # tsc -b && vite build — must pass, no new `any`
npm run test:residents
```

Then exercise it in a browser (the repo already uses Playwright MCP; there is a
`.playwright-mcp` directory):

1. Sign up fresh → onboarding → `/campaigns` empty state.
2. Upload the temp clip → workspace → run → report populated.
3. Click three different residents in sequence; watch the camera hand off
   between them without snapping back to the island view in between.
4. `Esc`, then click water: both deselect.
5. Reload → `/campaigns` shows the card with poster and headline → open it →
   report intact, "cascade not stored" shown, "Run it again" offered.
6. Console clean: no three.js disposal warnings, no React key warnings, no
   `Maximum update depth` from the follow loop.

## 8. Decisions taken, and what would change them

- **Campaign history is localStorage, per user id.** Matches the existing
  profile persistence and keeps the demo offline-capable. When the SpacetimeDB
  module lands, `campaigns` becomes an owner-scoped table and this hook becomes
  a subscription; the store shape above does not have to change.
- **The video file is not persisted.** IndexedDB could hold the blob, but a
  60MB clip per campaign in a hackathon demo is a worse failure mode than
  "re-attach the file". Revisit only if judges reload mid-demo.
- **Rounds are not persisted.** See §2.3 — size. If replaying a historical
  cascade turns out to matter for the pitch, persist rounds for the single most
  recent campaign only.
- **The member report replaces the sidebar rather than stacking below it.**
  384px cannot show both honestly, and the camera has already committed the
  screen to one person. A floating card over the canvas (today's
  `VillagerCard`) competes with the thing the camera just zoomed into.
