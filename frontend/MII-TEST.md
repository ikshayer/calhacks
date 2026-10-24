# Mii character export experiment

Run `npm run dev` in `frontend`, then open
<http://127.0.0.1:5173/mii-test.html>. This is a separate development entry;
the production island renderer has not been switched to the new character.

The page supports one resident, a lineup of four designs, or 48 independent animated clones, all three
supplied test clips, pause, neutral/island lighting, shadows, and a ten-second
benchmark after a two-second warmup. Keep the tab visible while measuring.
Changing the count, clip, pause, or shadow setting cancels the current measurement.

## Additional designs

The preview now includes **Nia**, **Theo**, and **Rowan** alongside the original.
Use the Resident design selector for a close view, or All four designs for the
lineup and mixed crowd. The three new authoring files and Blender comparison
scene are saved in `assets/residents/`; their editor options and palettes are
recorded in `scripts/mii_resident_presets.py`. Each preserves the hand/arm repair.
See `assets/residents/README.md` for design descriptions and reproduction steps.

## Source and working copies

Source: [Joey Carlino — Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender).
Tested with `Mii_Maker_for_4.1_v2.blend` in Blender 5.2.0 LTS.

The live source file was left at its original path and was not overwritten.
An isolated snapshot and a corrected authoring copy were saved under the ignored
`.tmp/mii-test/` directory. Open `authoring-fixed.blend` to continue from the fix.

The arm collapse was caused by the hidden `torso m weights` and `torso f weights`
objects deforming before the body's Data Transfer modifier sampled their weights.
Their Armature modifiers now have viewport/render evaluation disabled. The actual
character's Armature modifier remains enabled. The exporter repeats this repair
automatically in its separate process.

## Reproduce the export

From the repository root in PowerShell, using an isolated source copy:

```powershell
& 'D:/Blender/blender.exe' --background '.tmp/mii-test/authoring-fixed.blend' --disable-autoexec --python 'scripts/export_mii_test.py'
```

The script freezes the selected procedural meshes, reduces body subdivision to
one level, bakes cropped facial color/alpha into 256-pixel textures, and samples
the source rig into a smaller skeleton with ordinary animation keyframes.
It writes `public/models/mii-test/resident.glb` and `report.json` relative to
`frontend`. Bake intermediates go into `.tmp/mii-test/`.

The exported resident contains 6,088 triangles, 43 bones, and three clips:
`test_Idle`, `test_look_around`, and `test_wave`. File size is 442,916 bytes.
Faces and arm motion were inspected in the browser; the corrected source was
also checked in Blender. TypeScript, production build, and targeted lint passed.
The build reports the existing large workspace bundle warning.

## Measurements and remaining work

Character-only preview on the available AMD Radeon 890M, a 970 × 609 CSS-pixel
viewport, and DPR 1.5. These are local measurements, not a guarantee for other
machines or the complete island.

| Residents | Clip | Shadows | Average fps | 95th percentile frame |
|---|---|---|---|---|
| 48 | Idle | On | 30.8 | 36.4 ms |
| 48 | Idle | Off | 33.1 | 38.6 ms |

The initial export passes visual feasibility, but misses the 60 fps target.
It still uses several separately skinned parts and materials per resident;
mesh/material consolidation and the existing island's animation budget should
be evaluated before a crowd integration. Turning off shadows alone is insufficient.

No walk clip is supplied by this source. Phone/reaction behavior also needs
appropriate animation mapping. Sprite selections are frozen in this test;
runtime blinking and expression changes are not implemented. The current island
rig helper replaces every mesh material with one shared Kenney material, so it
cannot be reused unchanged for these textured faces.

The creator's listing does not state an asset reuse license. Record the applicable
terms before treating the experiment as a production asset.
