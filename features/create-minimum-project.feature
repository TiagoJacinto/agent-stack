Feature: Create a Minimum agent stack project
  Developers can scaffold a verified TypeScript project with the essential tooling and context needed for progressive agent-assisted development.

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
