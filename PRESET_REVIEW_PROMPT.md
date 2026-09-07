# Preset review prompt

Review the current `agent-stack` project and tell me whether the contents of each quality preset should change.

Start by reading the repository's `AGENTS.md`, `README.md`, `features/create-minimum-project.feature`, `src/catalog.ts`, and `src/project-template.ts`. Treat the existing implementation and approved Gherkin scenarios as the source of truth for what the project currently does.

## Original question

> If you had to create presets of code from minimum, low, medium, high, maximum, what would you put in each?

The intended model is that presets control how many deterministic gates an agent must clear before its code is considered shippable. Security and basic correctness should have a floor at every level.

## Proposed baseline to review

### Minimum — “Does it basically work?”
- Builds/parses successfully.
- Formatter/linter passes.
- Existing tests still pass.
- No obvious secrets committed.
- Change is narrowly scoped.
- Agent stays within a basic token/compute budget.

### Low — “Safe enough for routine internal work.”
Everything in Minimum, plus:
- Unit tests for changed behavior.
- Type checking where available.
- Dependency vulnerability scan.
- Basic input/error handling.
- No obvious dead code.
- Simple complexity/file-size limits.

### Medium — “Normal production.”
Everything in Low, plus:
- Meaningful unit/integration tests.
- Coverage threshold on changed code.
- SAST, secret, and dependency scanning.
- API/schema/contract checks.
- Accessibility smoke tests for UI.
- Performance regression smoke test.
- Complexity/duplication thresholds.
- Agent produces a reviewable diff and explanation.

### High — “Important production systems.”
Everything in Medium, plus:
- Property/fuzz tests for important logic.
- Mutation testing on critical modules.
- Stronger coverage requirements.
- End-to-end tests.
- Load/performance budgets.
- Automated WCAG checks.
- Dependency/license/SBOM checks.
- Strict complexity and architectural boundaries.
- Failure/retry/concurrency tests.
- Stronger token/compute limits and back-pressure when the agent keeps rewriting.

### Maximum — “Failure is exceptionally expensive.”
Everything in High, plus:
- Adversarial/fuzz testing across trust boundaries.
- High mutation score on critical code.
- Stress/soak tests.
- DAST/pentest-style checks.
- Supply-chain provenance/signing.
- Compatibility/platform matrix.
- Chaos/fault injection where applicable.
- Manual accessibility/security review for critical surfaces.
- Formal verification/model checking where justified.
- Independent human approval for high-risk changes.

## Suggested emphasis by constraint

| Constraint | Minimum | Low | Medium | High | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Correctness | 1/5 | 2/5 | 3/5 | 4/5 | 5/5 |
| Security | 2/5 | 2/5 | 3/5 | 4/5 | 5/5 |
| Performance | 1/5 | 1/5 | 3/5 | 4/5 | 5/5 |
| Accessibility | 1/5 | 2/5 | 3/5 | 4/5 | 5/5 |
| Maintainability | 1/5 | 2/5 | 3/5 | 4/5 | 5/5 |
| Cost efficiency | 4/5 | 4/5 | 3/5 | 2/5 | 1/5 |
| Comprehensibility | 1/5 | 2/5 | 3/5 | 4/5 | 5/5 |

## What I want from you

1. Compare this proposal with what `agent-stack` actually implements today.
2. For **Minimum, Low, Medium, High, and Maximum**, recommend exactly which features/checks belong in each preset.
3. Call out anything in the proposal that is misplaced, redundant, too expensive, not deterministic enough to be a gate, or inconsistent with this project's philosophy.
4. Preserve the principle that presets are composable accumulations of features rather than independent templates.
5. Identify which checks should be mandatory at every preset level, especially security/correctness floors.
6. Distinguish between checks that can be implemented now with the current TypeScript/Node/pnpm stack and checks that should remain future/optional capabilities.
7. Do not change implementation yet. First return a concrete recommended preset matrix and explain any changes from the proposal.