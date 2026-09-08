Feature: Create an agent stack project
  Developers can scaffold a verified TypeScript project with either a preset or individually selected agent-stack features.
  They can create a new project or merge agent-stack capabilities into an existing project.

  Scenario: Generate a new project with the Minimum preset
    Given an empty workspace for a new project
    When I create "example-project" with the Minimum preset
    Then the generated project provides:
      | capability           | configured tool or artifact                     |
      | runtime              | strict TypeScript on Node.js with pnpm           |
      | code quality         | oxfmt and Oxlint with Ultracite core and anti-slop |
      | testing              | Vitest with an actionable example failure        |
      | scripts              | dev, build, test, and check                       |
      | agent context        | README, AGENTS, glossary, and progress manifest   |
      | automated protection | GitHub Actions, gitleaks, and dependency auditing |
      | quality policy       | Minimum deterministic shipping gates and agent budget |
    And the generated project records the Minimum preset selection
    And its shipping gates require successful build, formatting, linting, type checking, existing tests, secret scanning, dependency auditing, a narrow change scope, and a basic agent compute budget
    And the generated project contains this Oxlint configuration:
      """ts
      import { defineConfig } from "oxlint";
      import core from "ultracite/oxlint/core";
      import antislop from "ultracite/oxlint/anti-slop";

      export default defineConfig({
        extends: [core, antislop],
        ignorePatterns: core.ignorePatterns,
      });
      """
    And installing dependencies and running the project checks succeeds

  Scenario Outline: Generate a project with a progressively stronger shipping preset
    Given an empty workspace for a new project
    When I create "<project>" with the "<preset>" preset
    Then the generated project records the "<preset>" preset selection
    And its shipping gates include every gate from the "<previous preset>" preset
    And its shipping gates add:
      | gate |
      | <added gate 1> |
      | <added gate 2> |
      | <added gate 3> |
    And it requires "<added gate 1>"
    And it additionally requires "<added gate 2>"
    And it finally requires "<added gate 3>"
    And installing dependencies and running the project checks succeeds

    Examples:
      | project         | preset  | previous preset | added gate 1                                              | added gate 2                                            | added gate 3                                        |
      | low-project     | Low     | Minimum         | changed-behavior unit tests                               | basic input and error handling                           | dead-code and simple complexity/file-size limits   |
      | medium-project  | Medium  | Low             | changed-code coverage, SAST, and contract checks          | UI accessibility and performance smoke tests             | duplication limits and reviewable diff explanation |
      | high-project    | High    | Medium          | property tests and mutation testing for critical modules  | end-to-end, load, failure, retry, and concurrency tests  | WCAG, license/SBOM, architecture, and strict complexity checks |
      | maximum-project | Maximum | High            | adversarial trust-boundary fuzzing and DAST checks        | stress/soak, compatibility-matrix, and chaos checks      | provenance/signing, critical-surface reviews, formal verification where justified, and independent approval |

  Scenario: Recommend Medium as the default shipping preset
    Given an empty workspace for a new project
    When I create "medium-project" with the Medium preset
    Then the generated project records the Medium preset selection
    And the generated project documentation identifies Medium as the default production recommendation

  Scenario: Select individual features when no preset is supplied
    Given an empty workspace for a new project
    When I start creating "custom-project" without a preset
    Then the feature chooser has this hierarchy:
      | feature          | label               | parent    |
      | oxfmt            | Formatting          |           |
      | oxlint           | Linting             |           |
      | anti-slop        | Anti-slop           | oxlint    |
      | anti-slop-effect | Anti-slop Effect    | anti-slop |
      | eslint           | ESLint              |           |
      | ultracite        | Ultracite           |           |
      | vitest           | Unit testing        |           |
      | property-testing | Property-based testing |           |
      | mutation-testing | Mutation testing    |           |
      | agent-context    | Agent context       |           |
      | github-actions   | GitHub Actions      |           |
      | gitleaks         | Secret scanning     |           |
      | dependency-audit | Dependency auditing |           |
    When I select these features:
      | feature  |
      | oxfmt    |
      | vitest   |
      | gitleaks |
    Then the generated project includes the selected features
    And GitHub Actions is included because secret scanning requires it
    And unselected optional features are absent
    And the generated project records requested and resolved features without a preset
    And child features are offered only after their parent is selected
    And the command does not ask for confirmation
    And installing dependencies and running the custom project checks succeeds

  Scenario: Add the Vitest adapter for selected property-based testing
    Given an empty workspace for a new project
    When I create "property-project" without a preset
    And I select these features:
      | feature          |
      | vitest           |
      | property-testing |
    Then the generated project declares "@fast-check/vitest" in devDependencies
    And the generated project declares "fast-check" in devDependencies

  Scenario: Configure Oxlint with the default Ultracite preset
    Given an empty workspace for a new project
    When I create "ultracite-project" without a preset
    And I select these features:
      | feature   |
      | oxlint    |
      | ultracite |
    Then the generated project contains this Oxlint configuration:
      """ts
      import { defineConfig } from "oxlint";
      import core from "ultracite/oxlint/core";

      export default defineConfig({
        extends: [core],
        ignorePatterns: core.ignorePatterns,
      });
      """

  Scenario: Configure Oxlint with local anti-slop
    Given an empty workspace for a new project
    When I create "oxlint-project" without a preset
    And I select these features:
      | feature   |
      | oxlint    |
      | anti-slop |
    Then the generated project contains this Oxlint configuration:
      """ts
      import { defineConfig } from "oxlint";

      export default defineConfig({
        jsPlugins: [
          {
            name: "anti-slop",
            specifier: "./tools/oxlint/anti-slop/index.ts",
          },
        ],
      });
      """
    And the generated project contains the vendored anti-slop plugin
    And the generated project does not contain an Ultracite dependency

  Scenario: Choose Oxlint as Ultracite's default backend
    Given an empty workspace for a new project
    When I create "ultracite-only-project" without a preset
    And I select these features:
      | feature   |
      | ultracite |
    And I accept Oxlint as the default Ultracite backend
    Then the resolved features include "ultracite"
    And the resolved features include "oxlint"
    And the generated project contains this Oxlint configuration:
      """ts
      import { defineConfig } from "oxlint";
      import core from "ultracite/oxlint/core";

      export default defineConfig({
        extends: [core],
        ignorePatterns: core.ignorePatterns,
      });
      """

  Scenario: Configure both Oxlint and ESLint with Ultracite
    Given an empty workspace for a new project
    When I create "dual-linter-project" without a preset
    And I select these features:
      | feature   |
      | oxlint    |
      | eslint    |
      | ultracite |
    Then the generated project contains this Oxlint configuration:
      """ts
      import { defineConfig } from "oxlint";
      import core from "ultracite/oxlint/core";

      export default defineConfig({
        extends: [core],
        ignorePatterns: core.ignorePatterns,
      });
      """
    And the generated project contains this ESLint configuration:
      """mjs
      import core from "ultracite/eslint/core";

      export default core;
      """

  Scenario: Warn before dropping unsupported anti-slop-effect
    Given an empty workspace for a new project
    When I create "combined-project" without a preset
    And I select these features:
      | feature          |
      | oxlint           |
      | anti-slop        |
      | anti-slop-effect |
      | ultracite        |
    Then the command warns that Ultracite does not support anti-slop-effect
    And the command asks for confirmation before generating the project
    When I confirm the warning
    Then the generated project contains this Oxlint configuration:
      """ts
      import { defineConfig } from "oxlint";
      import core from "ultracite/oxlint/core";
      import antislop from "ultracite/oxlint/anti-slop";

      export default defineConfig({
        extends: [core, antislop],
        ignorePatterns: core.ignorePatterns,
      });
      """
    And the generated project contains no anti-slop-effect configuration
    And the manifest records "anti-slop-effect" as omitted

  Scenario: Cancel generation after an unsupported combination warning
    Given an empty workspace for a new project
    When I create "cancelled-project" with Oxlint, Ultracite, and anti-slop-effect
    And I decline the compatibility warning
    Then the command does not generate a project

  Scenario: The create command rejects a non-empty target before feature selection
    Given a workspace containing an existing "existing-project" directory
    When I start the create command for "existing-project" without a preset
    Then the command fails before asking any feature questions
    And the error names the target directory on the next line

  Scenario: Merge the Minimum preset into an existing project
    Given an existing project with user-owned content in these artifacts:
      | artifact                 | user-owned content                   |
      | package.json             | metadata, scripts, and dependencies |
      | tsconfig.json            | compiler options and included paths |
      | oxlint.config.ts         | plugins and rules                   |
      | .github/workflows/ci.yml | triggers, jobs, and steps           |
      | README.md                | project documentation               |
      | source files             | application implementation         |
    When I run the merge command for that project with the Minimum preset
    Then all user-owned content is preserved
    And package scripts and dependencies are merged by name
    And TypeScript configuration is merged by option and path
    And Oxlint configuration is merged by import, plugin, extension, and rule
    And workflow configuration is merged by trigger, job, and step
    And agent-stack documentation is added in a managed Markdown block
    And missing Minimum capabilities are added
    And merge-only generation does not add example source code or example tests
    And the project records the merged Minimum preset selection
    And installing dependencies and running the project checks succeeds

  Scenario: Merge both supported linter configurations
    Given an existing project with customized Oxlint and ESLint configurations
    When I merge Oxlint, ESLint, and Ultracite into that project
    Then both existing linter configurations are preserved
    And the selected Ultracite configuration is added to both linters
    And neither linter configuration contains duplicate entries

  Scenario: Repeat a semantic merge
    Given an existing project that already contains a merged Minimum preset
    When I merge the Minimum preset into that project again
    Then no project content changes
    And no configuration contains duplicate entries

  Scenario: Refuse an incompatible semantic collision without changing the project
    Given an existing project assigns an agent-stack-owned configuration key an incompatible value
    When I run the merge command for that project
    Then the command fails with the conflicting artifact and configuration key
    And no project files are changed
