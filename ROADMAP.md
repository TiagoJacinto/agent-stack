# Roadmap

`create-agent-stack` is moving from verified project scaffolding toward deterministic, agent-operated shipping gates.

## Current state

### Shipped

- Minimum, Low, Medium, High, and Maximum preset names.
- Cumulative shipping-policy records in `.agent-stack/shipping-gates.json`.
- Generated build, formatting, linting, typechecking, and Vitest commands.
- CI dependency auditing and gitleaks secret scanning when selected.
- Property-testing dependencies and mutation-testing configuration for High and Maximum.
- Medium documented as the default production recommendation.

### Important limitation

The shipping policy is currently declarative. Most entries in `shipping-gates.json` are recorded for agents and reviewers but are not yet evaluated automatically. A project must not claim that a gate is enforced until the corresponding check is wired into its verification workflow.

## Delivery phases

### Phase 1: Gate-evaluation foundation

- Define a machine-readable gate schema with stable IDs, thresholds, evidence, and failure messages.
- Add a gate runner that evaluates policy entries and returns pass/fail evidence.
- Add changed-file and changed-line collection from the base revision.
- Define the agent-run telemetry contract for tokens, tool calls, retries, duration, and cost.
- Add baseline support so existing violations do not block unrelated changes.

### Phase 2: Minimum and Low enforcement

- Enforce successful builds as part of the aggregate check.
- Enforce narrow scope with diff-size, path, and justification rules.
- Enforce agent compute budgets with stop/back-pressure behavior.
- Require tests for changed behavior.
- Add input, boundary, and error-path checks.
- Add dead-code detection and basic file-size and complexity thresholds.

### Phase 3: Medium production gates

- Add changed-code coverage thresholds.
- Add SAST and API/schema/contract checks.
- Add accessibility and performance smoke tests.
- Add duplication thresholds.
- Generate a reviewable diff report with an agent explanation and gate evidence.

### Phase 4: High-assurance gates

- Wire property-based and mutation testing into required checks with thresholds.
- Add end-to-end, load, retry, failure, and concurrency tests.
- Add automated WCAG checks, license checks, SBOM generation, and architectural boundaries.
- Add stronger budgets, retry limits, and back-pressure for repeated rewrites.

### Phase 5: Maximum-assurance review

- Add adversarial trust-boundary fuzzing and DAST.
- Add stress, soak, compatibility-matrix, and chaos testing where applicable.
- Add supply-chain provenance and artifact signing.
- Add manual accessibility/security review requirements for critical surfaces.
- Add formal verification or model checking where justified.
- Require independent human approval for high-risk changes.

## Principles

- Security checks remain a floor at every preset.
- Higher presets add cumulative gates; they do not remove lower-level checks.
- Every gate must produce inspectable evidence.
- Gate failures should explain the smallest useful remediation.
- The product should distinguish clearly between available tooling, configured checks, and enforced shipping requirements.
