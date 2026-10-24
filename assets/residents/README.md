# Resident designs

Three additional residents created with the existing Mii Maker's picker bones
and color controls. Each `.blend` retains the complete editor and animation rig.

| File | Design |
|---|---|
| `nia.blend` | Dark bob, softer eyes, smiling mouth, warm brown skin, purple dress |
| `theo.blend` | Blond spiky hair, round glasses, broad face, teal shirt |
| `rowan.blend` | Cropped silver hair, narrow eyes, moustache, long face, mustard shirt |
| `lineup.blend` | Separate comparison scene with the original and all three new residents; the original editor scene is retained |

The live Blender session is showing the **Resident lineup** scene. To edit a
resident's options, open its individual `.blend` and use the original pickers.
The arm weight-transfer helper fix is included in each file.

Browser-ready exports and per-resident reports live in
`frontend/public/models/mii-test/`: `nia.glb`, `theo.glb`, and `rowan.glb`.
They include idle, look-around, and wave clips. The original `resident.glb` remains
available for comparison.

Open <http://127.0.0.1:5173/mii-test.html> with the frontend development server
running to compare all four designs, inspect each individually, or show a mixed
48-resident crowd. The production simulation has not been switched to these models.

## Recreate a design

The option choices and palettes are recorded in `scripts/mii_resident_presets.py`.
They move the same proximity-based picker bones used by the editor's UI; the
designs do not substitute new geometry for the editor's parts.

Run from the repository root, supplying an unmodified editor copy or the saved
base snapshot as input:

```powershell
& 'D:/Blender/blender.exe' --background '.tmp/mii-residents/base.blend' --disable-autoexec --python 'scripts/export_mii_test.py' -- --resident nia
```

Replace `nia` with `theo` or `rowan`. This writes the corresponding editable
`.blend`, exported `.glb`, and report. Use `--prepare-only` to save the editor
design without exporting. Running an export replaces that design's generated
files, so keep a separate copy of any further manual edits you want to preserve.

Authoring source: Joey Carlino's
[Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender).
The original test's missing walk animation, crowd performance limit, and
unestablished reuse terms still apply; see `frontend/MII-TEST.md`.
