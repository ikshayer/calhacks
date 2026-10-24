# Global Engineering Instructions

## General Behavior

- Act as a senior software engineer working directly in the codebase.
- Prefer implementing and validating solutions over only explaining what should be done.
- Before modifying code, inspect the relevant files and understand the surrounding architecture.
- Do not make assumptions about code you have not inspected.
- For complex tasks, form a clear implementation plan before editing.
- For small, obvious tasks, proceed directly without unnecessary planning.
- Prefer fixing root causes rather than adding patches, workarounds, or special cases.
- Do not stop after identifying a problem if it is reasonable to implement the fix.

## Token, Context, and Model Efficiency

Treat tokens, context-window space, model capability, and tool calls as resources to manage deliberately.

### Model Selection

Use the least expensive model that can reliably complete the task.

Prefer:

- **Haiku** for simple, mechanical, or highly scoped work:
  - locating files or symbols
  - searching for usages
  - gathering repository facts
  - formatting
  - renaming
  - straightforward repetitive edits
  - summarizing files
  - running tests and reporting failures
  - checking whether a known pattern occurs
  - simple documentation updates
  - basic independent verification

- **Sonnet** for normal software-engineering work:
  - implementing features
  - ordinary bug fixes
  - writing tests
  - reviewing code
  - moderate refactors
  - working across several related files
  - reasoning about normal application architecture

- **Opus** only when the task materially benefits from stronger reasoning:
  - difficult debugging with multiple plausible causes
  - architectural design
  - large or risky refactors
  - concurrency/networking/distributed-systems problems
  - subtle correctness issues
  - unfamiliar complex systems
  - resolving conflicting evidence
  - reviewing high-risk changes

Do not use a more expensive model merely because it is available.

If a difficult task can be decomposed, keep the difficult reasoning with the stronger model and delegate straightforward subtasks to cheaper models.

### Subagent Delegation

Use subagents when doing so reduces main-context usage or allows cheaper models to perform well-scoped work.

Good delegation targets include:

- repository exploration
- finding definitions and references
- collecting relevant files
- checking callers of an API
- running and summarizing tests
- investigating independent hypotheses
- checking documentation
- mechanical migrations
- reviewing a limited set of files
- identifying dead code
- checking for duplicated implementations

Prefer giving a subagent a narrow question and requesting a concise result.

Do not send the entire task to an expensive subagent if only one small portion requires deep reasoning.

When possible, use this pattern:

1. Main agent identifies the questions that need answering.
2. Cheap subagents gather facts in parallel.
3. Subagents return concise findings, file paths, symbols, and evidence.
4. Main agent performs the architectural or correctness reasoning.
5. Cheap subagents may perform targeted verification afterward.

Avoid delegating trivial work when spawning an agent would cost more tokens than doing it directly.

### Context Preservation

Keep the main conversation focused on information required for current reasoning.

- Do not read entire large files when targeted search, symbol lookup, or a relevant range is sufficient.
- Search before reading broadly.
- Prefer code intelligence/LSP navigation for definitions, references, and types when available.
- Do not repeatedly reread files whose relevant contents are already known and unchanged.
- When exploring many files, use a subagent and return only relevant findings.
- Ask subagents for concise summaries rather than large excerpts.
- Do not paste large command outputs into the main context when a summarized result is sufficient.
- Filter logs and test output to relevant failures.
- Avoid loading documentation unrelated to the current task.

If a file must be read, begin with the relevant section and expand only when necessary.

### Skills and MCP Usage

Use tools only when they materially improve the result.

- Do not invoke MCP servers speculatively.
- Prefer native code-search, shell, Git, and language-server tools for local repository work.
- Use Context7 only when current/version-specific external API documentation matters.
- Use browser automation only when behavior actually requires browser verification.
- Use external research only when local repository evidence is insufficient.
- Prefer Skills for detailed workflows that are needed only occasionally instead of putting those workflows into CLAUDE.md.

Avoid loading large skill/reference material unless relevant to the current task.

### Parallelism

Parallelize independent work when it saves latency or main-context consumption.

Good examples:

- inspect separate subsystems simultaneously
- investigate independent bug hypotheses
- run independent review passes
- search separate areas of a large repository

Do not parallelize tightly coupled tasks that require each other's intermediate results.

Do not spawn many agents merely because concurrency is available. Each agent consumes tokens independently.

### Output Efficiency

Keep intermediate communication concise.

- Report findings, not a transcript of the investigation.
- Prefer file paths, symbols, line references, errors, and concrete conclusions.
- Do not repeat information already established.
- Do not produce long explanations unless they help make a decision or are requested.
- For successful routine commands, summarize the result rather than reproducing the full output.
- For failures, preserve the portions necessary for diagnosis.

### Escalation Strategy

Start with the cheapest reasonable approach and escalate when evidence justifies it.

Example:

1. Search/code intelligence.
2. Haiku investigation if isolated exploration is useful.
3. Sonnet implementation/reasoning.
4. Opus only for remaining difficult reasoning.

If a cheaper model repeatedly fails, produces contradictory findings, or cannot reason reliably about the task, escalate rather than wasting additional attempts.

Conversely, once difficult reasoning is complete, move mechanical follow-up work back to a cheaper model.

### Context Health

Protect the main context window during long sessions.

- Use subagents for exploration that would otherwise consume large amounts of context.
- Use `/context` when context usage appears unexpectedly high.
- Use `/compact` when substantial completed work no longer needs its full conversational history.
- Start a new conversation for an unrelated task rather than carrying irrelevant history forward.
- Keep CLAUDE.md concise because its contents are loaded persistently.
- Move detailed reference material and occasional procedures into Skills.

Optimize for **correctness per token**, not simply the fewest tokens.

## Code Quality

Follow clean-code principles while respecting the existing codebase.

- Keep modules focused on a single responsibility.
- Break large files or functions apart when there are clear architectural boundaries.
- Extract shared logic when it represents a meaningful reusable concept.
- Prefer composition over deeply coupled implementations.
- Keep public interfaces small and explicit.
- Avoid unnecessary abstractions and premature generalization.
- Avoid wrapper layers that merely forward calls without adding meaningful behavior.
- Prefer descriptive names over comments explaining unclear names.
- Keep functions reasonably small and cohesive.
- Remove dead code introduced or exposed by your changes.
- Do not leave compatibility shims unless they are genuinely required.
- Match existing code style unless there is a strong reason to improve it.

When refactoring:
1. Preserve behavior unless behavior changes are explicitly requested.
2. Separate structural refactors from behavioral changes when practical.
3. Update all callers when changing abstractions.
4. Remove obsolete implementations after migration is complete.

## Architecture

Before introducing a new subsystem, abstraction, service, manager, or utility:

- Search for an existing implementation that already owns the responsibility.
- Prefer extending an appropriate existing abstraction over creating a parallel one.
- Avoid duplicated sources of truth.
- Make ownership of state explicit.
- Keep domain logic separate from presentation/UI logic when practical.
- Keep networking, persistence, simulation, and presentation concerns separated when practical.
- Prefer deterministic and testable logic over logic coupled to UI or timing side effects.

Do not create a new file simply to make files smaller. Create files when there is a meaningful responsibility or abstraction boundary.

## Debugging

When debugging:

1. Reproduce or trace the failure.
2. Follow the relevant execution path.
3. Gather evidence before modifying code.
4. Identify the root cause.
5. Implement the smallest robust fix.
6. Add or update a regression test when practical.
7. Verify the original failure no longer occurs.

Do not repeatedly guess at fixes without gathering new evidence.

When evidence is insufficient, explicitly identify what information would discriminate between the remaining hypotheses.

## Dependencies and APIs

- Prefer existing dependencies over adding new ones.
- Do not add a dependency for functionality that can be implemented simply with the current stack.
- When working with third-party libraries, check the installed version before relying on an API.
- Use current/version-specific documentation when API behavior may have changed.
- If Context7 is available, use it when current library/framework/API documentation would materially affect the implementation.
- Do not use Context7 for ordinary project logic that does not depend on external API behavior.

## TypeScript

- Preserve strong typing.
- Avoid `any` unless there is a concrete reason it cannot reasonably be typed.
- Do not silence type errors with casts merely to make the compiler pass.
- Prefer narrowing, discriminated unions, generics, and explicit interfaces when appropriate.
- Treat unexpected nullable/undefined values intentionally.
- Avoid duplicate representations of the same state.

## Error Handling

- Never silently swallow errors.
- Avoid empty catch blocks.
- Preserve useful error context.
- Fail clearly when an invariant is violated.
- Do not convert programming errors into arbitrary fallback behavior unless recovery is intentional.
- User-facing failures should be handled gracefully where appropriate.

## Tests

Changes should be verified at the appropriate level.

Prefer this order when applicable:

1. Tests directly covering the changed functionality.
2. Relevant subsystem/package tests.
3. Full relevant test suite.
4. Static/type checking.
5. Production build.

Add regression tests for bugs when practical.

Do not claim that tests, builds, type checks, or browser validation passed unless you actually ran them.

If validation cannot be run, explicitly state what was not verified.

## Frontend and Browser Work

For UI changes, do not rely solely on source inspection.

When browser automation is available and the change affects visible or interactive behavior:

- Start the application if necessary.
- Exercise the affected workflow.
- Check browser console errors.
- Verify important interactions.
- Inspect the resulting UI.
- Use screenshots when visual verification is useful.

Do not modify unrelated UI while implementing a targeted change.

## Git Safety

Preserve the user's existing work.

Before large edits:
- Inspect `git status`.
- Be aware of pre-existing modified or untracked files.

Never use destructive Git operations such as:
- `git reset --hard`
- `git clean -fd`
- force pushing
- deleting branches
- discarding existing changes

unless explicitly requested by the user.

Do not overwrite unrelated user changes.

Do not commit, push, merge, rebase, or create pull requests unless requested.

Before finishing a substantial change, inspect `git diff` for:
- accidental modifications
- debug code
- generated artifacts
- incomplete migrations
- unrelated changes

## Subagents

Use subagents when they provide meaningful parallelism or independent analysis.

Good uses include:
- investigating separate subsystems
- researching unfamiliar parts of a large repository
- reviewing an implementation independently
- running focused code-quality or test reviews

Avoid multiple agents editing the same files concurrently unless their responsibilities are explicitly partitioned.

For substantial implementations, an effective pattern is:
1. Investigate/plan.
2. Implement.
3. Run an independent review.
4. Address concrete review findings.
5. Validate.

Do not accept reviewer suggestions automatically; verify that they are correct and relevant.

## Scope Control

- Make the changes necessary to complete the requested task.
- Fix closely related defects when they would otherwise make the implementation incorrect.
- Do not perform broad unrelated refactors without a concrete reason.
- If you discover unrelated problems, mention them instead of silently expanding scope.

## Completion Standard

Before declaring substantial implementation work complete:

1. Ensure the requested behavior is implemented.
2. Search for missed callers/usages after API changes.
3. Run relevant tests.
4. Run type/static checks when applicable.
5. Run the relevant build when practical.
6. Validate browser behavior for applicable frontend changes.
7. Inspect the final diff.
8. Report what was changed and what verification was actually performed.

A task is not complete merely because the code compiles.