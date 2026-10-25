# Test an idea: consistency evaluation

This suite measures the production idea pipeline using the repository's authored 50-person Millbrook dataset. The residents and scenarios are fictional. There are no observed customer labels, so agreement is a repeatability measure rather than evidence of prediction accuracy.

Run from `frontend` with Node 22.18+ and installed dependencies in both `frontend` and `backend/worker`. No new packages are required.

```powershell
npm run test:ideas
npm run eval:ideas -- --live
```

Offline tests use simulated API responses, including an end-to-end runner test. They never require real credentials. The live command loads `JEV_API_KEY` and `ANTHROPIC_API_KEY` from the environment or repository-root `.env`; database and worker-secret settings are unnecessary. Nothing connects to SpacetimeDB or uses the worker's production disk cache.

## What runs

Twelve business ideas each have an original, conversational paraphrase, reordered paraphrase, and price contrast. Paraphrases preserve the offering, price, location, audience, budget, and campaigns. Contrasts change only price and are sensitivity diagnostics rather than similarity checks.

Each of the 48 inputs runs five times against every resident, bypassing application caches for parsing, scoring, and analysis. That produces 12,000 resident calls plus parser/analyst calls. Five extra runs use identical recorded scoring payloads with frozen parser/analyst replies, separating scorer variability from parser variation. An isolated cache warm-up scores 50 residents; its replay must make zero external calls. Total planned resident calls: **12,300**.

The seed fixes input order and group assignments, not provider randomness. Eight pipeline runs overlap, with a shared limit of **eight concurrent HTTP requests**. The default ceiling is 13,500 actual HTTP attempts including retries, with a 60-second request deadline. Authentication rejection stops the run; three consecutive failures before usable resident scores also stop it and preserve incomplete results. JEV retries HTTP 429 up to five attempts. Analyst/parser calls do not retry in this evaluation, so failures remain visible.

```powershell
# Smaller live run: all 50 residents, one family, two repetitions.
npm run eval:ideas -- --live --families boba --repeats 2

# Explicit limits and output directory.
npm run eval:ideas -- --live --concurrency 8 --pipeline-concurrency 4 --max-requests 13500 --out artifacts/idea-eval/my-run

# Continue tasks that have no saved result. Completed failures remain failures.
npm run eval:ideas -- --live --resume artifacts/idea-eval/my-run

# Rebuild reports from saved results, with no network calls.
npm run eval:ideas:report -- artifacts/idea-eval/my-run
```

Resuming verifies the dataset, profile, model aliases, and acceptance limits. It uses the original saved fixtures and task schedule. Completed runs are not repeated, and isolated cache contents are saved for replay after an interruption. A forced process termination can leave unrecorded in-flight HTTP attempts; the attempt ceiling accounts for all recorded requests. Provider aliases may change behind the same name, so avoid combining runs across long periods without inspecting observed model revisions.

## Passing criteria

| Comparison | Verdict agreement | Mean absolute visit-probability difference |
|---|---:|---:|
| Cached replay | 100% | 0; every result field must match except the test ID |
| Fresh identical input | At least 95% | At most 0.03 |
| Fixed scoring payload | At least 95% | At most 0.03 |
| Original versus each paraphrase | At least 90% | At most 0.05 |

Fresh comparisons include every pair of repetitions, evaluated separately per input. Each paraphrase is paired with its original at the same repeat index. These are engineering tolerances chosen before the evaluation; do not relax them to make a failing run pass. Every expected resident must have valid probabilities, correct option counts, and correct target membership. Incorrect age parsing, cached fresh scores, missing tasks, and missing predictions fail the evaluation.

Verdicts reuse the UI's `verdictOf`: yes (`going`) at `pVisit >= 0.50`; maybe at `>= 0.30`; no (`not`) below 0.30. Missing predictions never count as no. Near-threshold flips are highlighted and still count as disagreements. Return/share/campaign-interest drift is reported separately from visit-based verdict gates. Analysis prose need not repeat verbatim; it must pass the production structural and citation validation. Production validation drops invalid/duplicate citations rather than failing the whole job.

## Artifacts

Each live evaluation creates an ignored directory under `frontend/artifacts/idea-eval/`. The report distinguishes an incomplete evaluation from a completed evaluation with failing checks. Scores returned before a later analyst failure remain available for consistency comparisons; the analyst failure still makes the overall evaluation fail.

Artifacts:

- `report.md`: pass/fail, comparison gates, residents stable across every repeat, largest changes, coverage/parsing failures, observed models, and token totals.
- `report.json`: complete comparison rows, transition matrices, per-resident distributions, per-repeat town/target counts, price contrasts, and execution details.
- `summary.csv` and `residents.csv`: spreadsheet-ready comparisons and raw resident predictions.
- `manifest.json` and `dataset.json`: frozen fixtures, schedule, persona snapshot, dataset hash, profile, models, and configured tolerances.
- `results.jsonl`: completed pipeline outputs, parsed ideas, cache events, request hashes, timings, and usage. Appended after every task.
- `requests.jsonl`: actual request bodies and responses, observed provider models, timings, statuses, and hashes. Authentication headers are excluded and known credential strings are redacted.
- `cache.json`: isolated cache contents for warm/replay and resumption.

Exit status is `0` for a complete passing evaluation, `1` for failed/incomplete results, and `2` for setup or CLI errors. Report regeneration uses the same rules. It cannot promote incomplete data to a pass.

Provider-side caching cannot be ruled out by bypassing application caches. The suite reports model aliases and returned model versions; it does not claim to pin a provider's underlying weights. Token totals come from recorded HTTP responses. Any per-run dollar estimate uses the repository's configured rates, not verified billing prices.
