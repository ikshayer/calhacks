# Island polish implementation plan

Scope: refine Passes 1–3 of INTEGRATION_HANDOFF.MD in the current simulation.

1. Capture the current overview, plaza, and waterfront with one review profile and camera. Keep the generated island mask, walk graph, home slots, audience RNG, resident appearance, movement, and water shader unchanged.
2. Introduce a deterministic render-only landscape plan shared with town placement. Reserve the full resident movement corridor (lane offset plus body clearance) around every graph edge and node, building footprints, and door approaches. Move old plaza furniture out of through routes; place benches in clear garden pockets.
3. Organize the plaza with flush paving, a stronger fountain surround, paired seating gardens, and readable planting. Give cafe, bakery, market, residential gardens, and harbor complementary accent families and stronger awning/sign silhouettes.
4. Compose groves, continuous low planting beds, and a coastal garden on the empty peninsula. Use existing tree assets where possible, larger coordinated groups, and selected inland coastal planting/rocks to soften the stepped edge. Preserve land/water geometry and foam alignment.
5. Distinguish sand, stone paths, plaza paving, and timber with surface colors. Keep shared lighting/water appearance stable; improve facade and planting contrast locally. Batch repeated geometry and preserve cached GLTF ownership.
6. Validate route and building clearance, deterministic decoration, unchanged source island data, all existing resident tests, TypeScript, lint, and production build. Capture matching views and inspect them; measure only with hardware/browser metadata, and do not claim hardware fps from software rendering.

Acceptance: improvements read at the normal overview camera, furniture does not occupy resident lanes, landmarks and gardens look intentionally arranged, all twenty residents remain available, and existing sidebar/selection/cascade behavior works.

Implementation and verification are recorded in [POLISH_RESULTS.md](artifacts/integration-review/POLISH_RESULTS.md). The saved pre-polish overview supplies the visual baseline because fresh pre-edit browser capture attempts failed. All six steps have been applied; the existing navigation topology and water appearance remain intact.
