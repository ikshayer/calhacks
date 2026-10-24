# Resident designs

Twenty residents created with the existing Mii Maker's
picker bones and color controls. Each `.blend` retains the complete editor and
animation rig, including the editable one-second `walk` action at frames 0–24.

| File | Design |
|---|---|
| `resident.blend` | Original resident with repaired helpers and the shared walk |
| `nia.blend` | Dark bob, softer eyes, smiling mouth, warm brown skin, purple dress |
| `theo.blend` | Blond spiky hair, round glasses, broad face, teal shirt |
| `rowan.blend` | Cropped silver hair, narrow eyes, moustache, long face, mustard shirt |
| `maya.blend` | Copper tied braids, round face, bright eyes, coral dress |
| `jules.blend` | Textured dark hair, broad face, cheerful eyes, cobalt shirt |
| `iris.blend` | Long lavender hair, soft oval face, calm eyes, mint dress |
| `omar.blend` | Close-cropped hair, rectangular glasses, moustache, navy shirt |
| `pip.blend` | Tall mint spikes, angular face, lively eyes, apricot shirt |
| `vera.blend` | Side-parted auburn hair, sunglasses, pointed face, rose dress |
| `luna.blend` | Indigo tied hair, rounded face, honey dress |
| `felix.blend` | Sandy side-swept hair, gentle face, sage shirt |
| `zuri.blend` | Long dark textured hair, narrow face, sunflower dress |
| `hugo.blend` | Wavy chestnut hair, moustache, periwinkle shirt |
| `cleo.blend` | Dark bob, bold glasses, tangerine dress |
| `eden.blend` | Rounded lilac bob, relaxed eyes, icy blue dress |
| `kai.blend` | Close-cut dark hair, angular face, seafoam shirt |
| `sage.blend` | Layered silver hair, glasses, plum shirt |
| `arlo.blend` | Auburn top bun, moustache, forest shirt |
| `bea.blend` | Pink tied-up hair, bright eyes, berry dress |
| `lineup.blend` | Walking comparison scene with all twenty residents; the original editor scene is retained |

The live Blender session is showing the **Resident walking lineup** scene. To edit a
resident's options, open its individual `.blend` and use the original pickers.
The arm weight-transfer helper fix is included in each file.

Browser-ready exports and per-resident reports live in
`frontend/public/models/mii-test/`, using the same resident filenames.
All twenty include idle, look-around, wave, and walk clips and stride metadata.
Their authoring files retain the repaired weight-transfer helpers.
Each new resident starts from `resident.blend` so
accessories and proportions do not accidentally carry over from another preset.

Open <http://127.0.0.1:5173/mii-test.html> with the frontend development server
running. The preview opens on **All 20 designs**. The newest ten, the earlier six,
and the original four each have a separate group. Choose a resident for a close view, or show a mixed
48-resident crowd. Both original and optimized rendering are available.
The production simulation has not been switched to these models.

## Recreate a design

The option choices and palettes are recorded in `scripts/mii_resident_presets.py`.
They move the same proximity-based picker bones used by the editor's UI; the
designs do not substitute new geometry for the editor's parts.

Run from the repository root, supplying an unmodified editor copy or the saved
base snapshot as input:

```powershell
& 'D:/Blender/blender.exe' --background '.tmp/mii-residents/base.blend' --disable-autoexec --python 'scripts/export_mii_test.py' -- --resident nia
```

Replace `nia` with any preset ID from the table. For the newer designs, use
`assets/residents/resident.blend` as the input. This writes the corresponding editable
`.blend`, exported `.glb`, and report. Use `--prepare-only` to save the editor
design without exporting. Running an export replaces that design's generated
files, so keep a separate copy of any further manual edits you want to preserve.

## Update animations on an existing design

Use `--preserve-design` to skip presets when re-exporting manual editor changes:

```powershell
& 'D:/Blender/blender.exe' --background 'assets/residents/nia.blend' --disable-autoexec --python 'scripts/export_mii_test.py' -- --resident nia --preserve-design
```

For the original, use `resident.blend` and omit `--resident`. The exporter saves
an editable source before freezing browser geometry, preserves an existing `walk`
action, and writes `test_walk` plus `walkStrideLength`/`walkCycleSeconds` rig extras.
The shared gait uses stationary roots and compensated IK foot contacts. Existing
designs, repaired helpers, geometry, materials, and older exported clips are retained.
See `frontend/MII-TEST.md` for playback controls, measurements, and validation commands.

The preview, Blender lineup, and browser deformation check share
`frontend/src/dev/residentCatalog.json` so every exported design is included.

Authoring source: Joey Carlino's
[Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender).
Reuse terms remain unestablished; see `frontend/MII-TEST.md`.
