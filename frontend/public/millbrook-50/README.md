# Millbrook | 50-agent persona simulation (TypeScript)

A reproducible, dependency-free TypeScript generator for 50 fictional residents in 19 households. Uses Node 22.5+ built-in TypeScript stripping and SQLite (`node:sqlite`). Node currently labels these APIs experimental on some releases.

## Run

```bash
node --version                       # 22.5+ recommended (tested with 22.16)
npm run generate                     # builds data/personas.json and data/personas.sqlite
npm run validate                     # verifies population and reciprocal family links
npm run simulate                     # loads JSON, simulates a social interaction, saves both
```

No `npm install`, credentials, LLM key, or cloud database required. These scripts run from this folder. The `typecheck` script requires a separately installed TypeScript compiler and Node type declarations, but running does not.

## Outputs

- `data/personas.json`: portable nested complete world object including every resident, household, friend link, state and memories.
- `data/personas.sqlite`: local relational database with `households`, `personas`, `relationships`, and `memories` tables. The `personas.data_json` column stores the complete persona record; relationships also have queryable graph edges.
- `src/index.ts`: TypeScript schema, seeded population generation, validation, identity prompts and interaction updates.

## Model

- Immutable-in-simulation identity: name, household, age, occupation, personality, values, backstory, speech style. Ages only advance when you explicitly implement yearly time advancement.
- Mutable state: mood, goals, money, location, affinity, memory and beliefs.
- Family relations: spouse/spouse, parent/child, sibling/sibling with reciprocal validation.
- Friend affinities: -1 to +1, adjusted after interactions. Individual relationship updates are symmetric for simplicity.
- `identityBlock(persona, world)` returns a text prompt for connecting any external LLM, not a live LLM integration.
- Deterministic content generation: same seed produces the same world. Names are diverse illustrative fiction rather than statistical census sampling. Demographics, backgrounds and stories are seeded templates, not LLM-generated narrative.

## Example SQL

```sql
SELECT name, age, occupation, mood FROM personas ORDER BY age DESC;
SELECT p.name, r.type, q.name AS related_name, r.affinity
FROM relationships r
JOIN personas p ON p.id = r.from_id
JOIN personas q ON q.id = r.to_id
WHERE r.from_id = 'agent_01';
```

## Extension ideas

1. Connect `identityBlock` to your model API to generate actions or richly authored backgrounds, then validate that the model does not overwrite fixed fields.
2. Use vector embeddings + time/importance ranking to fetch more relevant memories; currently the prompt reads up to five most recent.
3. Store immutable identity and mutable state in separate DB tables for stronger enforcement.
4. Add scheduler, locations, event types, safeguards, and independent agents deciding actions each tick.

### Caveats

- The generator provides plausible household structure but does not attempt fully census-calibrated demographics, multiple legal marriage structures, or exhaustive intergenerational graph constraints.
- Only `spouse`, `parent`, `child`, and `sibling` are generated. Extended family and unrelated roommate relations require extra types.
- `npm run generate` resets and overwrites the generated population. Back up the JSON or DB before regenerating.
- Interaction example is a demonstration, not a full autonomous-agent simulation loop.
