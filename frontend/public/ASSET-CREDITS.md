# Third-party assets and libraries

Disclosure for Cal Hacks 13.0 submission. Everything below is used under a licence
that permits commercial and educational use.

## 3D models

| Asset | Author | Licence | Source |
|---|---|---|---|
| Mini Characters 1.0 (`public/models/characters/`) | Kenney | CC0 1.0 | <https://kenney.nl/assets/mini-characters> |
| Mini Forest 1.0 (`public/models/island/`, rocks only) | Kenney | CC0 1.0 | <https://kenney.nl/assets/mini-forest> |
| City Kit (Suburban) 2.0 (`public/models/town/suburban/`) | Kenney | CC0 1.0 | <https://kenney.nl/assets/city-kit-suburban> |
| City Kit (Commercial) 2.1 (`public/models/town/commercial/`) | Kenney | CC0 1.0 | <https://kenney.nl/assets/city-kit-commercial> |

Every pack ships its own `License.txt`, retained alongside the models. CC0 places the
work in the public domain; crediting Kenney is optional, and we do it anyway.

Models are used unmodified in glTF-binary (`.glb`) form. Each pack shares a single
`colormap.png` palette texture, kept in that pack's own folder because the palettes
differ between packs. Only a subset of each city kit is shipped.

The island itself, its roads, the plaza, the fountain and the sea are generated
geometry, not models: the landmass is a grid of instanced tiles whose coastline is
produced procedurally, so no terrain model is used. Buildings are tinted per instance;
the models are otherwise unmodified.

## Water textures

| Asset | Source | Licence |
|---|---|---|
| `public/textures/foam_primary.png`, `foam_detail.png`, `foam_flow.png` | Supplied by the team | **To confirm before submission** |

Two tiling greyscale Voronoi masks and an RG flow map, used by the sea shader
to texture and advect the open water. They were added to the project by a
team member and their origin is not yet recorded here. **Confirm whether these
were generated or downloaded, and under what licence, before submitting** — the
rules require every asset to be disclosed.

`painted_sky.png`, `water_fallback.png` and `painted_nautical_atlas.png` are
present in the same folder but are not currently used by the app.

## Avatar portraits

| Asset | Licence | Source |
|---|---|---|
| DiceBear `@dicebear/core` + `@dicebear/collection` | MIT (library) | <https://dicebear.com> |
| `open-peeps`, `notionists`, `lorelei`, `pixel-art` styles | CC0 1.0 | <https://dicebear.com/styles> |

Only CC0-licensed DiceBear styles are used. Avatars are generated client-side from a
seed; no avatar request leaves the browser.

## Production characters

The production island's villager characters are Kenney's CC0 Mini Characters.

## Experimental character evaluation

The experimental exports in `models/mii-test/` (`resident.glb`, `nia.glb`,
`theo.glb`, and `rowan.glb`) are derived from
[Joey Carlino's Mii Maker for Blender](https://joeycarlino.itch.io/mii-maker-for-blender),
used by the separate `mii-test.html` development preview. They are not wired into
the production island. The creator's listing does not specify an asset reuse
license; applicable terms remain to be established. Export preparation includes
frozen procedural meshes, baked facial textures, and sampled animation clips.
See `frontend/MII-TEST.md` for the source repair, reproduction steps, and results.

## Libraries

React, Vite, TypeScript, Tailwind CSS, three.js, @react-three/fiber, @react-three/drei,
@react-three/postprocessing (bloom and vignette), zustand, react-router. See
`package.json` for exact versions.
