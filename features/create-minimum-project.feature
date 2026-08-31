Feature: Create an agent stack project
  Developers can scaffold a verified TypeScript project with either a preset or individually selected agent-stack features.

  Scenario: Generate a new project with the Minimum preset
    Given an empty workspace for a new project
    When I create "example-project" with the Minimum preset
    Then the generated project provides:
      | capability           | configured tool or artifact                     |
      | runtime              | strict TypeScript on Node.js with pnpm           |
      | code quality         | oxfmt and oxlint                                  |
      | testing              | Vitest with an actionable example failure        |
      | scripts              | dev, build, test, and check                       |
      | agent context        | README, AGENTS, glossary, and progress manifest   |
      | automated protection | GitHub Actions, gitleaks, and dependency auditing |
    And the generated project records the Minimum preset selection
    And installing dependencies and running the project checks succeeds

  Scenario: Select individual features when no preset is supplied
    Given an empty workspace for a new project
    When I start creating "custom-project" without a preset
    Then I am offered these optional features:
      | feature             | label               |
      | oxfmt               | Formatting          |
      | oxlint              | Linting              |
      | vitest              | Unit testing         |
      | agent-context       | Agent context        |
      | github-actions      | GitHub Actions       |
      | gitleaks            | Secret scanning      |
      | dependency-audit    | Dependency auditing  |
    When I select these features:
      | feature  |
      | oxfmt    |
      | vitest   |
      | gitleaks |
    Then the generated project includes the selected features
    And GitHub Actions is included because secret scanning requires it
    And unselected optional features are absent
    And the generated project records requested and resolved features without a preset
    And installing dependencies and running the custom project checks succeeds
