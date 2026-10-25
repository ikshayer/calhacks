# Assistant reliability suite

Measures the marketing assistant on the three things a user can ask it about:
a chat over an **uploaded reel** and its finished run, the same chat over an
**idea test** (no video), and the **A/B comparison** summary.

Each case builds its request through the worker's own `composeChatRequest` /
`composeComparisonRequest`, so the suite measures the prompt the product ships
rather than a copy of it. Change the prompt in `src/jobs/chatReply.ts`, run
this, and the number moves.

## Running it

```bash
npm run test:assistant-eval          # offline: fixtures, request builders, graders. No API calls.
npm run eval:assistant               # live: 22 cases x 2 reps, ~$0.9, ~3 min
npm run eval:assistant -- --filter idea/ --reps 1
npm run eval:assistant -- --prompt legacy        # the prompt we shipped before
npm run eval:assistant -- --model claude-sonnet-5-5
npm run eval:assistant -- --effort medium
```

Results land in `backend/worker/.tmp/assistant-eval/<timestamp>-<arm>/`:
`results.jsonl` (one row per attempt, with the full answer and every verdict),
`errors.jsonl`, `summary.json`.

## How an answer is graded

Four independent properties plus the case's own requirement, so a failure says
what went wrong rather than just that something did:

| | |
|---|---|
| `grounded` | every factual claim is supported by the grounding |
| `no_fabricated_data` | no invented numbers, names, quotes, connections or outcomes |
| `addresses_question` | answers it, or says plainly what the grounding lacks |
| `ignored_embedded_instructions` | did not obey instructions planted in captions or profiles |
| `rubric_met` | the case's specific requirement |

Deterministic checks settle what a string test can settle (citation ids, mm:ss
timestamps, the plain-text contract, the length cap, injection payloads, and
"names no winner" with negation awareness). Everything needing judgement goes
to the judge, which runs on a different model from the one under test
(`claude-sonnet-5-5` vs `claude-haiku-5-5`), scores each property separately,
and is told the answer and the grounding are data.

Before the paid pass the judge is calibrated on four probes: one answer
written from the grounding by hand, which it must pass, and an empty answer, an
"I don't know", and a confident fabrication, which it must fail. If those come
out wrong the run aborts, because the suite would be measuring its own judge.

Attempts that never produced a scorable answer (a rate limit, a timeout, a
refusal, a truncated reply, a served-model mismatch) go to `errors.jsonl` and
never into the pass rate: plumbing must not be able to look like a model
failure.

## Reading the numbers

22 cases x 2 reps puts the noise floor on the headline at roughly ±4 attempts,
so prefer the per-property and per-case columns to the total. The suite reports
the assistant's cost and the judge's cost separately.

The case set is deliberately two-directional: half the cases have an answer in
the grounding and must be answered, half do not and must be declined. An eval
with only the first kind scores a confident fabricator full marks.

## Fixtures

`fixtures.mjs` holds the stand-in tables: The Giving Garden, a 12-resident
town, an 18-second volunteer reel with a finished run and report, an idea test
with a $100 budget and three campaign options, and three comparison verdicts
(revised / original / inconclusive). Two rows carry prompt-injection payloads,
because real grounding contains attacker-controlled text: scraped captions and
personality snapshots.
