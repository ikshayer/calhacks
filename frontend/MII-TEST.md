# Mii character exports

The production island uses the exported resident designs described here. This
document records their authoring workflow and renderer integration.

## Additional designs

The roster includes **Nia**, **Theo**, and **Rowan** alongside the original, plus
six additional designs: **Maya**, **Jules**, **Iris**, **Omar**, **Pip**, and **Vera**.
The newest ten are **Luna**, **Felix**, **Zuri**, **Hugo**, **Cleo**, **Eden**,
**Kai**, **Sage**, **Arlo**, and **Bea**.
All twenty authoring files and the Blender comparison
scene are saved in `assets/residents/`; their editor options and palettes are
recorded in `scripts/mii_resident_presets.py`. Each preserves the hand/arm repair.
See `assets/residents/README.md` for design descriptions and reproduction steps.

## Source and working copies

Source: [Joey Carlino — Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender).
Tested with `Mii_Maker_for_4.1_v2.blend` in Blender 5.2.0 LTS.

The live source file was left at its original path and was not overwritten.
The original is now editable in `assets/residents/resident.blend`; the other nineteen
designs have their own authoring files beside it. `lineup.blend` opens the walking
comparison scene and retains the original editor scene, including the native walk action.

The arm collapse was caused by the hidden `torso m weights` and `torso f weights`
objects deforming before the body's Data Transfer modifier sampled their weights.
Their Armature modifiers now have viewport/render evaluation disabled. The actual
character's Armature modifier remains enabled. The exporter repeats this repair
automatically in its separate process.

## Reproduce the export

From the repository root in PowerShell, using the saved authoring files:

```powershell
& 'D:/Blender/blender.exe' --background 'assets/residents/resident.blend' --disable-autoexec --python 'scripts/export_mii_test.py' -- --preserve-design
& 'D:/Blender/blender.exe' --background 'assets/residents/nia.blend' --disable-autoexec --python 'scripts/export_mii_test.py' -- --resident nia --preserve-design
```

The script freezes the selected procedural meshes, reduces body subdivision to
one level, bakes cropped facial color/alpha into 256-pixel textures, and samples
the source rig into a smaller skeleton with ordinary animation keyframes.
It writes `public/models/mii-test/resident.glb` and `report.json` relative to
`frontend`. Bake intermediates go into `.tmp/mii-test/`.

Use `--preserve-design` when updating an existing resident: it skips presets and
keeps the current picker choices, proportions, and palette. Existing authored
`walk` curves are preserved. Without the flag, `--resident` reapplies that preset.

The exported original contains 6,088 triangles, 43 bones, and four clips:
`test_Idle`, `test_look_around`, `test_wave`, and `test_walk`. File size is 477,284 bytes.
Faces and arm motion were inspected in the browser; the corrected source was
also checked in Blender. TypeScript, production build, and targeted lint passed.
The build reports the existing large workspace bundle warning.

## Walking and movement synchronization

`scripts/mii_walk.py` creates the editable `walk` action only when one is missing.
It spans frames 0–24 at 24 fps, with matching endpoint poses and a stationary root.
Alternating IK foot targets have a 60% stance phase, constant backward velocity
during contact, and a lifted return. Body bob is compensated at the foot controls;
hands swing gently opposite the legs. The older clips receive static neutral COG
keys if needed so Blender does not retain the body's last walking offset.

Every exported `MiiTest` rig has `walkStrideLength: 0.44` (model units per cycle)
and `walkCycleSeconds: 1` in its glTF extras. When manually changing step length
or duration, update the action's stride metadata and scene fps accordingly.

Residents have independent phases. Idle/Walk fades last 0.18 seconds, and the
controller synchronizes walk cadence with simulation travel speed.

Regenerate the Blender comparison with:

```powershell
& 'D:/Blender/blender.exe' --background 'assets/residents/resident.blend' --disable-autoexec --python 'scripts/preview_mii_residents.py'
```

## Crowd rendering optimization

The renderer prepares each design once at load time:

- Combine solid body/head/hair geometry into one skinned mesh, with the original
  linear PBR colors stored as vertex colors.
- Pack the facial PNGs into one padded sRGB atlas and combine their skinned
  geometry into one transparent, single-pass mesh. Keep lenses separate and
  translucent. Facial decals do not cast additional shadows; the solid geometry
  continues to cast the resident's silhouette.
- Share one compatible skeleton across each resident's mesh parts after cloning.
  Separate residents retain independent bones, mixers, and animation phases.
- Dispose owned skeleton textures on cleanup while retaining cached geometry.

The same clone/cleanup helper is used by the island's existing character rigs.
The workspace now uses this optimized Mii material batching too.
Blender files and source GLB exports are preserved. Animation cadence, bone count,
geometry detail, lighting, resolution, and the conservative culling policy remain
the same for this first optimization pass.

## Measurements and remaining work

Historical four-design character-only preview on the available AMD Radeon 890M, a 970 × 609 CSS-pixel
viewport, and DPR 1.5. These are local measurements, not a guarantee for other
machines or the complete island.

Same-session comparison with all four designs mixed evenly, Idle animation, and
shadows enabled. Each run uses a two-second warmup and ten-second measurement:

| Rendering | Residents | Draw calls | Skeletons | Average fps | 95th percentile frame |
|---|---|---|---|---|---|
| Original export | 48 | 1,393 | 540 | 23.1 | 48.2 ms |
| Optimized crowd | 48 | 157 | 48 | 119.2 | 8.9 ms |

Walking measurements with the same machine, viewport, DPR, lighting, and shadows
(the floor grid adds one draw call):

| Rendering | Movement | Residents | Draw calls | Skeletons | Average fps | 95th percentile frame |
|---|---|---|---|---|---|---|
| Optimized crowd | Travel, 1× | 48 | 158 | 48 | 102.4 | 10.5 ms |
| Optimized crowd | In place, 1× | 48 | 158 | 48 | 102.3 | 10.5 ms |

These are the final-export validation runs. Earlier walking runs measured 119.3
and 119.5 fps respectively; both sessions exceed the 60 fps target. Results are
recorded in `assets/residents/walk-validation.json`.

After adding the six newer designs, a 48-resident crowd cycling through all ten
designs measured **102.6 fps**, with an 11.2 ms 95th percentile frame, 160 draws,
48 skeletons, Walk/Travel at 1×, and shadows enabled. Viewport and DPR were the
same. The new sources pass native walk validation; the expanded browser check
passes all 120 poses. These results are saved in
`assets/residents/expansion-validation.json`.

With twenty available designs, the mixed 48-resident walking crowd measured
**111.4 fps**, with a 10.5 ms 95th percentile frame, 158 draws, and 48 skeletons.
Travel, shadows, viewport, and DPR match the settings above. All ten new sources
pass native walk validation, and all twenty exports pass the 240-pose deformation
comparison. SHA-256 checks confirm that the earlier ten Blender sources and GLBs
are byte-identical. Results are saved in `assets/residents/expansion-20-validation.json`.

The optimized crowd exceeds the 60 fps character-preview target on this machine
and approaches its 120 Hz display limit. Full-island performance still needs a
separate measurement after integration. A previous single-design baseline
measured 30.8 fps with shadows and 33.1 fps without them; these historical values
are not the controlled mixed-design comparison above.

## Verification

`npm run test:residents` checks equivalent deformation after skeleton sharing,
independence between residents, incompatible inverse-bind matrices, and resource
ownership on cleanup. It also checks stride/cadence synchronization at three
speeds, phase offsets, pause, rapid Idle/Walk reversals, complete blend weights,
fade duration, and metadata validation. All seven tests pass. TypeScript and
production build pass; full lint reports only existing unrelated warnings.

For all twenty real exports, the browser check compares indexed triangle counts
and deformed vertex positions at twelve poses per design (240 total), including
Walk. It also verifies stride metadata, clip duration, matching endpoints,
stationary roots, and planted foot motion after synchronized travel. With the
local Vite development server running, execute it in the workspace browser console:

```javascript
await (await import('/scripts/resident-rendering.browser-check.mjs')).checkResidentExports()
```

All sampled surfaces match within 1e-5 world units. Loop and root errors are zero;
maximum exported contact drift is 0.00000394 model units. The four original GLBs
were also compared against the previous revision: geometry, material definitions,
and all existing clip samples are unchanged (zero numerical difference).

Run native IK validation against each authoring file:

```powershell
& 'D:/Blender/blender.exe' --background 'assets/residents/nia.blend' --disable-autoexec --python-exit-code 1 --python 'scripts/check_mii_walk.py'
```

All twenty pass native loop/root, contact, foot clearance, knee/hand continuity,
helper repair, authored-action preservation, and return-to-Idle checks. Native
contact drift stays below 0.000005 units. Front/side views in Blender and the
browser were inspected, including the dress, glasses, and moustache. Browser UI
checks cover 1/4/48 residents in original/optimized rendering and both movement
modes, repeated Idle/Walk transitions, pause/resume, and all three speed settings.

The production adapter temporarily maps phone, ordinary reactions and dismissal
to Idle and Sharing to a single wave. Dedicated poses remain follow-up work.
Sprite selections are frozen in this test; runtime blinking and expression
changes are not implemented. The legacy Kenney renderer remains available as an
automatic fallback if the resident exports cannot load.

The creator's listing does not state an asset reuse license. Record the applicable
terms before treating the experiment as a production asset.


## Production island integration

The workspace now uses all twenty approved resident designs by default. The
single roster is `src/island/residentCatalog.json`; no exported assets moved.
Appearance is assigned by a separate deterministic hash of profile/audience
context and stable member id. Explicit Mii ids are honored, while Kenney stems
and unknown legacy values are adapted without consuming audience RNG.

Each prepared design shares geometry/materials across clones; each resident
owns its skeleton and animation mixer. Effect-owned template leases handle
StrictMode replay and asynchronous unmounts, and release prepared/raw resources
when the final scene unmounts. A missing design uses the original or another
available design; if all exports fail, the existing Kenney renderer is retained.

Residents are normalized to 2.4 world units tall. Intended movement is 0.50 to 0.75
world units/second; the authored rig stride/cycle metadata and displayed scale
set Walk cadence independently for each design. IslandSim remains the only
source of world positions. Budgeted controllers retain activity/time samples,
advance fades in real time, and never apply walk speed to Idle or gestures.
Phone, ordinary reactions and dismissal temporarily use Idle; Sharing waves
once on entry, then returns to Idle. Dedicated phone/dismissal poses and facial
expressions remain follow-up animation work. Cascade pause continues to pause
round progression while ambient walking continues.

## Island surface pass

The first island pass derives continuous retaining walls/caps, path curbs,
grass/sand edging, plaza paving bands, and dock fascia/posts/rails from the
existing tile mask. Repeated details share one instanced box batch, with two
small plaza paving rings. Walkable surfaces, graph slots/links, group homes,
building placements, and the water/foam implementation remain unchanged.
Existing disconnected dock graph components are retained rather than silently
rewriting navigation during a surface pass. The configured visible target is
48; subgroup rounding produces 50 visible bodies for the reviewed profile,
which is the actual count used in before/after performance measurements.
Building multipart batching, architectural trim, and additional inhabited
props are the next passes, pending visual review.

## Spacing revision

The island grid now uses 3.4-world-unit spacing in place of 2.4. The same 309
land tiles cover 3572.04 square world units, approximately twice the previous
1779.84. Streets and lots are 42 percent wider while Mii height remains 2.4,
building/prop dimensions and movement speeds remain fixed, and the audience
cohort is preserved. Plot and furniture locations spread with the land.

Coastline generation, plot probability and home sorting use the original
reference lattice, preserving the exact tile mask, route links, seeded model
choices and group home slots. Shoreline field extent increases to 103.7, with
six samples per tile to retain the original physical sampling density. The
water shader, foam maps, colors and flow behavior are unchanged. Overview
framing, fog clearance and shadow coverage account for the enlarged land;
close zoom remains available for individual residents.

`npm run test:residents` now runs 22 tests. The five spacing tests compare a
saved baseline for exact topology/home/plot decisions, area and physical size,
shoreline coverage/density, overview fit and simulation member/speed behavior.
