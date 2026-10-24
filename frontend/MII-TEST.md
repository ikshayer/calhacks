# Mii character export experiment

Run `npm run dev` in `frontend`, then open
<http://127.0.0.1:5173/mii-test.html>. This is a separate development entry;
the production island renderer has not been switched to the new character.

The page supports one resident, lineups of four, six, or ten designs, or 48 independent animated clones,
Walk (initial selection), Idle, Look around, Wave, pause, neutral/island lighting, shadows, and a ten-second
benchmark after a two-second warmup. Keep the tab visible while measuring.
Changing rendering mode, design, count, clip, movement, speed, view, pause, lighting, or shadows cancels
the current measurement. The Rendering selector compares the optimized crowd
against the original export at the same camera and display settings.

## Additional designs

The preview includes **Nia**, **Theo**, and **Rowan** alongside the original, plus
six newer designs: **Maya**, **Jules**, **Iris**, **Omar**, **Pip**, and **Vera**.
It opens with the six new designs selected. Use the Resident design selector
for a close view, or All ten designs for the full lineup and mixed crowd.
All ten authoring files and the Blender comparison
scene are saved in `assets/residents/`; their editor options and palettes are
recorded in `scripts/mii_resident_presets.py`. Each preserves the hand/arm repair.
See `assets/residents/README.md` for design descriptions and reproduction steps.

## Source and working copies

Source: [Joey Carlino — Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender).
Tested with `Mii_Maker_for_4.1_v2.blend` in Blender 5.2.0 LTS.

The live source file was left at its original path and was not overwritten.
The original is now editable in `assets/residents/resident.blend`; the other nine
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

The preview's **In place** mode plays the stationary cycle. **Travel** adds
`strideLength / cycleSeconds × displayedScale × playbackRate` along the existing
forward direction (+Z in glTF). The 0.5–1.5× control changes cadence and travel
together. Residents have independent phases. Idle/Walk fades last 0.18 seconds;
travel follows the blended walking weight. Pausing freezes both pose and travel.
The camera, lights, and labels follow movement. Floor lines are one preview unit
apart; Front/Side buttons make contact and clearance easy to inspect.

Regenerate the Blender comparison with:

```powershell
& 'D:/Blender/blender.exe' --background 'assets/residents/resident.blend' --disable-autoexec --python 'scripts/preview_mii_residents.py'
```

## Crowd rendering optimization

The optimized preview prepares each design once at load time:

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
The Mii material batching remains in the separate preview until model integration.
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

For all ten real exports, the browser check compares indexed triangle counts
and deformed vertex positions at twelve poses per design (120 total), including
Walk. It also verifies stride metadata, clip duration, matching endpoints,
stationary roots, and planted foot motion after synchronized travel. Run it in
the preview's developer console:

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

All ten pass native loop/root, contact, foot clearance, knee/hand continuity,
helper repair, authored-action preservation, and return-to-Idle checks. Native
contact drift stays below 0.000005 units. Front/side views in Blender and the
browser were inspected, including the dress, glasses, and moustache. Browser UI
checks cover 1/4/48 residents in original/optimized rendering and both movement
modes, repeated Idle/Walk transitions, pause/resume, and all three speed settings.

Phone/reaction behavior still needs
appropriate animation mapping. Sprite selections are frozen in this test;
runtime blinking and expression changes are not implemented. The current island
rig helper replaces every mesh material with one shared Kenney material, so it
cannot be reused unchanged for these textured faces.

The creator's listing does not state an asset reuse license. Record the applicable
terms before treating the experiment as a production asset.
