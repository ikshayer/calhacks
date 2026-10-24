# Mii integration and island redesign handoff

Prepared: 2026-10-24. Repository: `D:\Work\calhacks` on the current Windows machine.

## 1. Objective and user decisions

The user has approved the appearance of twenty Mii-style resident designs and now wants them integrated into the **actual audience simulation**, followed by continued island redesign.

Their original direction was: the water already looks good; the island and characters need polish. The island should be heavily inspired by **Tomodachi Life**, especially its complete silhouettes, borders, architectural details, and sense of a finished miniature town.

The user also explicitly checked whether the older residents had been removed. **Keep all twenty designs available.** Do not replace the earlier residents with only the latest batch.

This handoff is a plan, not an implementation of production integration. As of this handoff, the Mii assets work in the standalone test; the actual island still uses Kenney characters. Implement character integration first, establish a working baseline, then redesign the island in reviewable stages.

### Preserve these established choices

- Retain the approved resident faces, hair, clothing, proportions, colors, glasses, and moustaches.
- Retain the authored walking cycle and the repaired hands/weight-transfer helpers.
- Retain the optimized resident rendering approach and independent animation phases.
- Preserve the current water appearance and shoreline foam behavior while improving the land around it.
- Preserve audience identities, group membership, cascade results, selection, sidebar/report behavior, and original/revision comparability.
- Keep the standalone character test as a regression tool after production integration.

The original visual reference was an image in the earlier chat, not a known repository file. A new session will not automatically have that image. The written visual brief in section 7 is enough to begin; request the image again only if precise visual matching later requires it.

## 2. Start here in a new session

1. Read this file, `frontend/MII-TEST.md`, `assets/residents/README.md`, and applicable session/repository instructions.
2. Run `git status --short`. There is existing work in this workspace, including modified source files and **untracked assets from the newest ten residents**. Preserve it. Do not reset, clean, or regenerate everything from an older commit.
3. Verify the twenty source files, GLBs, reports, and catalog entries exist. A fresh checkout needs these files committed or copied as well as this handoff; the handoff alone does not contain the binary assets.
4. Reuse an existing frontend dev server if one is running. Otherwise run `npm run dev` in `frontend`.
5. Open `/mii-test.html` to inspect the approved assets. Then open the actual app at `/workspace` through its existing login/onboarding flow. The test page is not the simulation.
6. Capture the actual island's current appearance and performance before changing it.

User instructions from the earlier session require Context7 for current library-specific API documentation when using/changing library APIs. Follow those instructions and installed versions; do not treat remembered API syntax as current documentation. Routine repository inspection and application-logic refactoring do not require a documentation lookup by themselves.

## 3. Assets and proven behavior

### Resident inventory

The current catalog is `frontend/src/dev/residentCatalog.json`. It is shared by the preview, its browser deformation check, and the Blender comparison script.

| Batch | IDs and display names |
|---|---|
| Original four, `batch: 0` | `resident` / Original, `nia` / Nia, `theo` / Theo, `rowan` / Rowan |
| Earlier six, `batch: 1` | `maya` / Maya, `jules` / Jules, `iris` / Iris, `omar` / Omar, `pip` / Pip, `vera` / Vera |
| Newest ten, `batch: 2` | `luna` / Luna, `felix` / Felix, `zuri` / Zuri, `hugo` / Hugo, `cleo` / Cleo, `eden` / Eden, `kai` / Kai, `sage` / Sage, `arlo` / Arlo, `bea` / Bea |

- Editable sources: `assets/residents/<id>.blend`, including `resident.blend`.
- Browser exports: `frontend/public/models/mii-test/<id>.glb`.
- Reports: the original uses `report.json`; others use `<id>-report.json` in that GLB directory.
- Blender comparison: `assets/residents/lineup.blend`, scene **Resident walking lineup**, twenty residents; the original editor scene is retained.
- Presets: `scripts/mii_resident_presets.py`.
- Authoring/export: `scripts/export_mii_test.py`, `scripts/mii_walk.py`.
- Native walk check: `scripts/check_mii_walk.py`.
- Comparison-scene generator: `scripts/preview_mii_residents.py`.

The sources retain the complete Mii editor rig. The browser rig has 43 bones, and these designs have roughly 5,700–6,800 triangles each. Use the per-resident reports for exact counts.

### Animation contract

All twenty GLBs contain:

| Clip | Use |
|---|---|
| `test_Idle` | Idle |
| `test_look_around` | Existing look-around motion |
| `test_wave` | Existing wave motion |
| `test_walk` | Shared compact, stationary-root walk |

The native editable action is named `walk`: frames **0–24 at 24 fps**, one second, matching endpoint poses. It uses alternating IK steps, compensated planted feet, modest knee bends, opposing hand swings, and a gentle body bob. Forward travel is deliberately outside the animation. The exported forward direction is **+Z**, compatible with an `atan2(dx, dz)` heading.

The exported `MiiTest` rig has glTF extras, available through its loaded `userData`:

```text
walkStrideLength = 0.44   // model units of travel per full cycle
walkCycleSeconds = 1.0
```

Read these values from the rig, not an assumed top-level scene property. Normalize with a wrapper as the preview does. Do not bake world travel into the exported skeleton.

`--preserve-design` skips preset application when exporting an existing authoring file. An existing authored `walk` action is preserved. Static neutral COG keys were added to older actions where needed so Blender does not retain an unkeyed walking offset when returning to Idle.

### Rendering implementation to retain

`frontend/src/island/residentRendering.ts` already provides:

- `prepareResidentTemplate`: prepares a design once, combining opaque geometry with its linear material colors, atlasing the facial sprites, and retaining translucent glasses separately.
- `cloneResident`: shares compatible skeletons **within** one resident; different residents retain separate bones, skeletons, mixers, and phases.
- `disposeResidentSkeletons`: disposes owned skeleton resources without disposing shared geometry/materials.
- `residentRenderStats`: useful instrumentation.

Faces are textured, transparent, single-pass decals; lenses remain translucent. Solid geometry casts the resident silhouette; facial decals and lenses should not acquire extra shadow passes. Preserve sRGB facial textures and existing color handling.

The preparation helper intentionally rejects incompatible inputs. In the latest batch, a nose option with additional vertex-color attributes failed batching; **Sage was re-exported with the compatible `nose3` option**. The delivered twenty exports all pass. Do not silently strip unsupported attributes from future designs or overwrite their appearance to make merging succeed.

`frontend/src/island/residentPlayback.ts` contains reusable phase and 0.18-second blending logic, but its current API is tailored to the preview. Its `step(dt, speed)` advances all active clips with one multiplier and returns suggested preview travel. It is **not** a production locomotion controller to drop in unchanged.

### Evidence already collected

- All twenty exports passed 240 original-versus-optimized animated surface comparisons at a tolerance of `1e-5` world units.
- Walk endpoint and root errors were zero. Exported planted-foot drift was about `0.00000394` model units.
- Native walk checks passed; the original helper repair remains intact.
- The earlier ten `.blend` and `.glb` files were SHA-256 checked and remained byte-identical when the newest ten were added.
- Seven resident tests, TypeScript, lint, and the production build passed. Lint has existing unrelated warnings; the build has an existing large-bundle warning.
- Latest **character-preview-only** benchmark: 48 residents drawn from all twenty designs, Walk + Travel at 1×, shadows on, AMD Radeon 890M, 970×609 CSS viewport, DPR 1.5: **111.4 fps**, p95 10.5 ms, 158 draws, 48 skeletons. Two-second warmup and ten-second measurement.

Recorded reports: `assets/residents/walk-validation.json`, `expansion-validation.json`, and `expansion-20-validation.json`. These are historical measurements, not evidence that the complete island already achieves the same performance.

## 4. Actual simulation: where integration belongs

| File | Current responsibility and integration relevance |
|---|---|
| `frontend/src/routes/WorkspaceRoute.tsx` | Builds the island, group home assignments, and `IslandSim`; maps member selection to cohort indices. Memoizes the sim across runs. |
| `frontend/src/island/IslandCanvas.tsx` | Canvas, lighting, fog, camera, effects, and the member-to-model array passed to `Villagers`. |
| `frontend/src/island/Villagers.tsx` | Loads/clones character rigs, updates world positions/headings, selects activity clips, runs the animation budget, and owns invisible picking proxies. |
| `frontend/src/island/villagerModels.ts` | Kenney-specific paths, material replacement, clip binding, fades, rig cleanup. Main adapter boundary to replace/refactor. |
| `frontend/src/island/AnimationBudget.ts` | Distance/frustum-based animation updates with accumulated time debt. Currently directly calls `rig.mixer.update(rig.owed)`. |
| `frontend/src/island/scene/IslandSim.ts` | Typed-array movement, activities, timers, member/cohort lookup, and staging cascade events. Keep data semantics independent of rendering. |
| `frontend/src/island/useCascadePlayback.ts` | Stages rounds, seeks/replays, and controls round timing. |
| `frontend/src/data/mock/personas.ts` | Seeded audience generation; currently assigns Kenney model stems and optional accessory metadata. |
| `frontend/src/data/types.ts` | `AudienceMember.model`, accessory metadata, and audience/run contracts. |
| `frontend/src/store/useAppStore.ts` | Currently wires the mock data source and `AUDIENCE_SIZE = { total: 500, onIsland: 48 }`. Older comments/defaults elsewhere mention 120; inspect actual wiring. |
| `frontend/src/island/fx/*` | Reaction badges, share trails, chatter, selection rings, and group highlights. Several heights/radii assume the old character dimensions. |
| `frontend/src/island/scene/island.ts` | Land mask, paths, plaza, docks, plot placement, group home slots, and shoreline distance field. |
| `frontend/src/island/Terrain.tsx` | Instanced tile land, fountain, lamps, and water composition. |
| `frontend/src/island/Town.tsx` | Instanced static buildings and props. Currently extracts only the first mesh from each GLB. |
| `frontend/src/island/Water.tsx` | Existing shader water and foam, driven by the island distance field and optional foam/flow maps. Preserve its established appearance. |

### Integration traps confirmed in the current code

1. `createRig` replaces every mesh material with one shared Kenney material. This would destroy Mii faces, colors, and glasses.
2. Existing clip names are `idle`, `walk`, `holding-both`, and `emote-no`. The Mii clips have different names and do not include phone-holding or dismissal animations.
3. `VILLAGER_SCALE = 2.1` is a Kenney scale multiplier, not a target world height. The Mii preview normalizes height to 2.4 units. Measure the actual scene before choosing production dimensions.
4. The shadow effect in `Villagers` sets `castShadow` on every mesh. It would undo the optimized face/lens shadow policy. Also, `shadows` is currently in the rig-construction effect dependencies despite the following comment saying shadow changes avoid rebuilds.
5. `AnimationBudget` updating the mixer directly will not advance `ResidentPlayback`'s manually managed fade weights. Combining both update paths would advance animation twice.
6. Movement is already owned by `IslandSim`. Adding the preview's returned travel to those positions would move residents twice.
7. A member ID is **not** a cohort index. Only the on-island sample has bodies. Use `memberOfIndex` / `indexOfMember`, regardless of the outdated comment in `data/types.ts` suggesting equivalence.
8. Current picking geometry is a radius-0.5, height-1.9 cylinder centered at y=0.95. FX anchor heights include 2.6 for reaction badges, 1.85 for chatter, and 1.9 at share-trail endpoints. Reconcile them with the chosen Mii size.
9. `WorkspaceRoute` currently passes `paused={false}` to the scene. Playback-bar pause controls cascade progression; ambient walking continues. Do not accidentally change this product behavior while introducing animation pause support.

## 5. Phase A — integrate the approved residents

### A1. Establish a production catalog and stable appearance assignment

- Promote the existing JSON catalog to a shared production location, such as `frontend/src/island/residentCatalog.json`. Keep one authoritative list.
- Update all consumers if moving it: `src/dev/mii-test.ts`, `scripts/resident-rendering.browser-check.mjs`, and the filesystem path in `scripts/preview_mii_residents.py`.
- The existing `/models/mii-test/<id>.glb` URLs can serve the first integration. A later directory rename must update the exporter, preview, reports/docs, and production loader together; do not duplicate twenty assets just to change the URL prefix.
- Give each audience member a stable visual design using a separate deterministic hash/visual RNG keyed by stable member identity and audience/profile context. Do not assign by changing array order or by React render timing.
- Honor a recognized Mii ID if the data explicitly supplies one; provide a deterministic mapping for existing Kenney stems and unknown legacy values. Define a missing-asset fallback rather than making the entire simulation blank.
- Keep archetype labels such as Maya and Luna separate from the synthetic audience member's displayed name and identity. Do not infer a person's appearance from their name or audience group.

**Prefer a render-only adapter initially.** Changing the model/accessory selection inside `generateAudience` can change RNG consumption and therefore subsequent audience traits or graph generation. Do not disturb original/revision reproducibility just to change visuals. If the data contract is migrated later, test seeded outputs explicitly and support existing records.

### A2. Prepare templates once, create independent instances

- Load the twenty designs behind the workspace's existing lazy/Suspense boundary; keep heavy 3D loading out of login/onboarding.
- Prepare each design once with `prepareResidentTemplate`. Prepare before applying wrapper normalization; the helper validates identity mesh transforms and shared bind space.
- Clone prepared roots per resident with independent skeletons and phases. Reuse prepared geometry, materials, and atlases across clones of a design.
- Use a positioning/rotation wrapper around the normalized model. Follow the preview's neutral bounds/centering/floor-offset approach; do not modify cached skinned geometry to place feet on the ground.
- Choose an explicit target world height after comparing a resident against roads, doors, lamps, and the existing town. Use the same bounds to derive pick proxies and FX anchors.
- Preserve body-only shadow casting when shadows toggle. Remove unnecessary cohort rebuilds on shadow changes. Do not reset animation phases, model assignment, or selection on a shadow toggle.
- Make template ownership and cleanup explicit: instances dispose mixers and owned skeletons; the template/cache owner disposes prepared geometry, materials, and atlases. Individual clones must not dispose shared cached resources. Verify React Strict Mode mount/unmount behavior.
- Keep a reversible development fallback to the existing renderer until selection, activities, materials, and performance pass. Do not remove the Kenney files as part of the first swap.

### A3. Add a semantic activity-to-animation adapter

Use renderer-level aliases/behavior rather than changing the simulation's activity meanings to suit the assets.

| Simulation activity | Initial Mii behavior |
|---|---|
| Walking | `test_walk`, with stride-synchronized cadence |
| Resting | `test_Idle`; optional seeded look-around variation |
| OnPhone | Explicit temporary Idle fallback; retain the state and its surrounding UI/effects |
| Reacting | Idle or a brief wave for an appropriate positive reaction; do not make every watch event a celebration |
| Sharing | A brief wave is a reasonable temporary gesture; the share trail remains the authoritative visual event |
| Dismissing | Neutral Idle/look-around fallback; no nonexistent `emote-no` binding |

Document these temporary mappings. Do not claim a phone pose exists or reuse incompatible Kenney animation tracks on the Mii skeleton. A dedicated phone pose, dismissal, richer reactions, and runtime facial expressions are follow-up animation work.

Keep ~0.18-second Idle/Walk crossfades and complete pose weights through rapid transitions. Trigger one-shot gestures once on entering an activity, not once per render frame, and return to a suitable idle behavior if the activity outlasts the gesture. Give each resident a reproducible independent phase.

### A4. Synchronize locomotion without moving twice

`IslandSim` currently walks at 1.3–2.1 world units/second. A normalized 2.4-unit-tall Mii has a much smaller natural stride at 1×, so the existing speed range must be checked rather than copied blindly.

```text
baseWorldSpeed = walkStrideLength * displayedModelScale / walkCycleSeconds
walkPlaybackRate = intendedWorldSpeed / baseWorldSpeed
```

- Keep `IslandSim.x/z/angle` authoritative for world movement and path following. Use the authored walk in place.
- Expose a read-only intended locomotion speed or track robust traveled distance for cadence. Lane changes/turns can produce displacement discontinuities; do not turn a junction snap into a sudden sprint animation.
- Prefer calibrating the visual walking-speed configuration to a natural cadence at the chosen world height. Avoid extreme playback rates just to preserve an arbitrary old visual speed.
- Do not clamp cadence while allowing the character to keep moving faster; that reintroduces foot sliding. Adjust both visual motion and cadence coherently.
- Apply gait speed to Walk, not to the idle/gesture clips. Passing zero movement speed into the preview's single-speed player would otherwise freeze idle and reactions.
- Keep fade timing separate from gait cadence. Preserve the distinction between real frame time, locomotion time, and cascade-round playback speed.

### A5. Adapt the animation budget and interactions

- Refactor the budget to advance a rig through one animation-controller method rather than blindly updating its mixer. There must be exactly one pose update path.
- Accumulate elapsed animation time/distance correctly across skipped frames. Handle activity/rate changes without applying old Walk debt to a newly selected Idle/gesture clip.
- Prioritize selected and nearby residents for smooth posing. Check the current distance bands against the real camera: including camera height in distance can put everyone into a coarse band at the overview angle.
- Preserve deterministic phase and total elapsed motion across lower-frequency updates; do not synchronize the whole crowd on re-entry into view.
- Refit picking, selection/group rings, reaction badges, chatter, and trail endpoints to the model's normalized dimensions and any future ground height.
- Preserve `sim.memberOfIndex` selection mapping and the existing `VillagerCard`/sidebar data.
- Audit legacy accessory metadata. It is generated today, but `Villagers.tsx` does not currently attach those props. Do not blindly attach Kenney-sized glasses/canes to the new head or remove RNG calls from audience generation. Some Mii designs already include glasses.

### A6. First integration milestone

Before redesigning the island, demonstrate the actual `/workspace` with the current 48-member visible cohort using stable Mii designs, correct faces/lenses, clean walking, functioning selection and reactions, and no data/report regressions. Capture a full-island performance baseline here.

## 6. Phase B — island redesign foundation

### Current geometry and topology contract

- `GRID = 29`, `TILE = 2.4`, nominal land radius 26; roads repeat every four tiles.
- Land, roads, plaza, docks, plots, lamps, navigation, and the water distance field derive from `scene/island.ts`.
- `island.walkable` contains grid tile indices. `island.links` and `assignHomeTiles` use **slots in the walkable array**, not raw grid tile indices.
- The current terrain tiles have different box depths, but their **top surfaces are all at y=0**. They are not actual above-ground terraces. Water is at y=-0.55.
- Buildings use claimed 2×2 plots to keep their footprint away from roads. `BUILDING_SCALE = 2.6` and `Plot` currently has no elevation field.
- `Town.tsx` instances only the first mesh of a GLB and does not account for arbitrary child mesh transforms. New multi-part buildings would lose roofs/windows/trim unless this is fixed.

Start with a surface/detail pass that keeps the current walkable plane and graph stable. Derive perimeter geometry, curbs, and decoration placement from the same island data rather than hand-placing disconnected scenery.

Before adding new multi-mesh buildings, extend static batching to include every intended mesh/material and preserve each part's source transform. Compose that transform with the plot placement. Keep real instancing for repeated static props and avoid disposing GLTF-cached geometry/materials on individual batch cleanup.

Use separate deterministic randomness for decorative placement. Adding a planter should not unexpectedly move all later buildings or change the audience RNG sequence.

## 7. Visual brief and island implementation order

The target is a crafted, welcoming miniature island with readable districts, varied little buildings, deliberate borders, and enough small details to feel inhabited. Keep the elevated town camera and warm coastal atmosphere. The original reference had warm stone paths, olive grass, a central fountain/plaza, distinct colorful roofs/shop silhouettes, palms/greenery, retaining walls, and finished waterfront edges.

### Pass 1: finish the island silhouette and ground transitions

- Add a continuous, deliberate coastline/retaining-wall treatment, contrasting top caps, and readable grass/sand/stone boundaries.
- Add coherent path borders, sidewalk/curb thickness, plaza paving bands, and finished dock edges/posts/railings where appropriate.
- Use selective darker trim and physical edge geometry to create the missing outlines. Avoid a black wireframe on every tile or a global outline pass that overwhelms faces and glass.
- Merge or instance edge segments. Do not add a mesh per tiny decoration or draw lines around internal tile boundaries that should visually disappear.
- Preserve the water shader, foam textures, flow, horizon/fog relationship, and established water colors. Rebuild/check the distance field if the coastline mask changes so foam continues to hug the real shore.

### Pass 2: improve buildings and landmarks

- Establish a clear central plaza/fountain, recognizable neighborhood clusters, and a few differentiated waterfront/shop landmarks.
- Add roof fascia/eaves, foundation bands, door/window trim, awnings, signs, entrance steps or borders, and small fenced/hedged lots.
- Make building entrances face paths and keep landmark silhouettes readable from the actual overview camera.
- Verify resident-to-door/building proportions after the Mii scale decision. Avoid solving a sizing problem by making every character tiny.
- Reuse the existing town kit where it fits, with added trim/props or selected authored replacements. Audit the actual available assets before promising new models.

### Pass 3: add restrained inhabited detail

- Tree/palm clusters, low hedges, planters, flower strips, benches, bins, lamps, signs, parasols, dock bollards, and small paved gathering spots.
- The current model list already includes large/small trees, planters, low fences, parasols, and coastal rocks. Author additional props only where the existing inventory cannot provide the needed silhouette.
- Put details at entrances, corners, waterfronts, and gathering points. Keep movement lanes, selected residents, badges, and share trails readable.
- Keep district/group identity in environment accents and highlighting, not recolored skin or hair.
- Tune palette, ambient fill, bloom, fog, and contact shadows only after geometry reads well. Preserve natural facial color under the strong warm sun; avoid muddy grass or clipped pale roofs/faces.

### Pass 4: topology/elevation changes only with supporting systems

If the redesign needs actual terraces, stairs, ramps, bridges, or a substantially new street layout, introduce a coherent ground-height/navigation contract first. Residents, plots, proxies, trails, rings, and all FX currently assume y≈0.

Add explicit surface elevations and valid transitions; do not raise decorative land while residents continue walking through it at zero height. Rebuild the walk graph and group home-slot assignments together, and recreate the sim when its topology changes. Validate connected routes, no stranded nodes, no water crossings without a real connection, and building/prop clearance including lane offsets.

The first visible improvement should come from finished boundaries, paths, architectural trim, and intentional props. A complete navigation rewrite is not a prerequisite for that improvement.

## 8. Validation and performance gates

### Character integration

- All twenty designs appear and are individually inspectable in the actual simulation and retained preview.
- Stable model assignment across selection, rerenders, run changes, seeking, and shadow toggles for the same audience.
- No audience trait/graph/cascade-output changes caused by visual RNG changes; original/revision comparison remains fair.
- Original and optimized geometry comparisons continue to pass after any loader/normalization/catalog refactor.
- Front/side walking checks cover stationary animation roots, planted feet, turns, clean knees/hands, dresses, long/tied hair, moustaches, and transparent glasses.
- Repeated Idle/Walk/gesture transitions, pause/resume where supported, speed changes, replay/seek, and tab restore do not produce T-poses, phase jumps, giant time debt, or double motion.
- Selection proxies and cards work at overview and close zoom; badges/chatter/trails clear the heads and do not clip through the ground.
- Repeated mount/unmount, cohort changes, and toggles do not leak skeleton textures, prepared atlases, or mixers.

### Island redesign

- Compare matching overview, waterfront, plaza, and close-resident screenshots before/after each pass.
- Finished silhouette and borders are visible from the normal camera, not only in a close-up.
- Water and shoreline foam remain visually coherent; docks/edges do not z-fight or reveal seams.
- Residents remain on connected walkable paths, clear props/buildings, and meet the ground.
- The existing sidebar, run controls, selection, group highlighting, and readable cascade effects remain usable.

### Performance

- Measure the **complete island**, not only `/mii-test.html`: water, buildings, postprocessing, reactions, and shadows add cost.
- Use the same camera, CSS viewport, DPR, shadow settings, visible cohort, and run/seed for before/after comparisons. Record average fps and p95 frame time after warmup, with the tab visible.
- Target at least 60 fps for the current 48-member cohort on the existing test machine/settings. A 120-resident stress case can be recorded separately; do not silently increase or reduce the production cohort to make a benchmark pass.
- Record draw calls, triangles, skeleton count, animation-budget updates, renderer resource counts, and render resolution. Count the whole rendering pipeline rather than only the final postprocessing pass.
- Keep one compatible skeleton per resident, prepared templates per design, and static instancing/merged detail. Profile before sacrificing face fidelity or the water the user already likes.

### Commands

From the repository root in PowerShell:

```powershell
Set-Location frontend
npm run test:residents
npx tsc -b
npm run lint
npm run build
Set-Location ..
```

The existing test command runs Node directly; using `node --test` previously encountered child-process restrictions in this environment. Vite's production build may likewise need the environment's normal child-process approval path. Existing lint warnings are in `AuthProvider`, `Town`, `AmbientChatter`, and `ReactionBadges`; the build already warns about a large workspace bundle.

In the dev preview's browser console:

```javascript
await (await import('/scripts/resident-rendering.browser-check.mjs')).checkResidentExports()
```

Native authoring check or export, using the current machine's Blender executable:

```powershell
& 'D:/Blender/blender.exe' --background 'assets/residents/nia.blend' --disable-autoexec --python-exit-code 1 --python 'scripts/check_mii_walk.py'
& 'D:/Blender/blender.exe' --background 'assets/residents/nia.blend' --disable-autoexec --python-exit-code 1 --python 'scripts/export_mii_test.py' -- --resident nia --preserve-design
```

For the original use `resident.blend` and omit `--resident`. Do not apply presets to manually edited residents unless intentionally rebuilding their design. Do not depend on ignored `.tmp` snapshots when the repository sources are available.

The original hand repair disables Armature modifier evaluation on hidden `torso m weights` / `torso f weights` donors, while leaving the real body's Armature modifier enabled. Preserve the correct male/female Data Transfer donor for each design. Re-enabling deformation on those donors previously collapsed the hands/arms.

## 9. Follow-ups and completion criteria

Follow-up animation work: a native Mii phone pose/prop interaction, a suitable dismissal, richer reactions, and runtime blinking/expressions. Facial sprite choices are currently frozen at export. These are separate from getting the approved residents walking correctly in the actual island.

Asset source is Joey Carlino's [Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender). Existing project notes say reuse terms were not established; retain attribution/provenance and resolve shipping terms before an external release. This is an existing release item, not a reason to discard the approved local prototype work.

**Character integration is complete when** the actual simulation uses the approved Mii roster by default, with preserved data semantics, stable identities, correct materials, believable locomotion, functional interactions, and a measured full-scene performance result.

**The first island redesign milestone is complete when** matching screenshots show a finished coast, ground/path borders, a coherent plaza, architectural trim, and purposeful repeated props, with preserved water quality and working navigation. Continue topology/elevation changes only after that baseline is sound.

Suggested first instruction for the next session:

> Read `INTEGRATION_HANDOFF.MD` and inspect the current workspace. Implement Phase A to integrate the twenty approved Mii residents into the actual simulation, preserving all existing models and simulation behavior. Validate the full scene, then continue the island redesign in the staged order described in the handoff. Keep the existing water appearance and report concrete visual and performance results.
