Feature: Configure an agent stack project without prompts
  Developers and automation can select a preset or individual capabilities through command-line flags.
  Non-interactive commands either apply the supplied configuration or fail without changing project files.

  Scenario: Create a project with explicitly selected features
    Given an empty workspace for a new project
    When I run agent-stack with these arguments and no interactive input:
      | argument          |
      | --name            |
      | custom-project    |
      | --no-interactive  |
      | --package-manager |
      | bun               |
      | --features        |
      | oxfmt,vitest,gitleaks |
    Then the command succeeds without asking questions
    And the generated project records Bun as its package manager
    And the generated project records requested and resolved features without a preset
    And the generated project includes formatting, unit testing, and secret scanning
    And GitHub Actions is included because secret scanning requires it
    And unselected optional features are absent
    And installing dependencies and running the project checks succeeds

  Scenario: Create a core-only project
    Given an empty workspace for a new project
    When I run agent-stack with these arguments and no interactive input:
      | argument         |
      | --name           |
      | core-project     |
      | --no-interactive |
      | --features       |
      | none             |
    Then the command succeeds without asking questions
    And the generated project uses pnpm
    And the generated project includes only core capabilities
    And installing dependencies and running the project checks succeeds

  Scenario: Create the complete Minimum preset with Bun
    Given an empty workspace for a new project
    When I run agent-stack with these arguments and no interactive input:
      | argument          |
      | --name            |
      | minimum-project   |
      | --no-interactive  |
      | --preset          |
      | minimum           |
      | --package-manager |
      | bun               |
    Then the command succeeds without asking questions
    And the generated project records Minimum as its initial preset
    And the generated project records Bun as its package manager
    And the generated project includes every Minimum capability
    And installing dependencies and running the project checks succeeds

  Scenario: Merge explicitly selected features without prompts
    Given an existing project with user-owned content
    When I merge formatting and unit testing using command-line flags and no interactive input
    Then the command succeeds without asking questions
    And the selected capabilities are added
    And all user-owned content is preserved

  Scenario Outline: Reject invalid non-interactive configuration
    Given an empty workspace for a new project
    When I run agent-stack non-interactively with "<configuration>"
    Then the command fails without asking questions
    And the error explains "<problem>"
    And the command does not generate a project

    Examples:
      | configuration                                                        | problem                                               |
      | --features vitest                                                     | --name is required                                   |
      | --name example-project                                                | a preset or explicit feature selection is required   |
      | --name example-project --features unknown                            | the feature is unknown                               |
      | --name example-project --features none --package-manager npm          | the package manager is unsupported                   |
      | --name example-project --preset minimum --features vitest             | presets and individual selections cannot be combined |
      | --name example-project --features react-compiler-babel,react-compiler-oxc | React Compiler integrations are mutually exclusive |
      | --name example-project --features ultracite,anti-slop-effect          | the selected combination is unsupported              |

  Scenario: Use Oxlint as Ultracite's default backend without prompts
    Given an empty workspace for a new project
    When I run agent-stack with these arguments and no interactive input:
      | argument          |
      | --name            |
      | ultracite-project |
      | --no-interactive  |
      | --features        |
      | ultracite         |
    Then the command succeeds without asking questions
    And the resolved features include "ultracite" and "oxlint"
    And the feature manifest records Ultracite as requested and Oxlint as resolved
    And the generated project uses Oxlint with Ultracite's core rules
    And installing dependencies and running the project checks succeeds

  Scenario: Preselect features and choose the remaining features interactively
    Given an empty workspace for a new project
    When I create "preselected-project" with these feature choices:
      | feature                      | choice      |
      | vitest                       | preselected |
      | oxfmt                        | preselected |
      | GitHub Actions               | select      |
      | remaining optional features | decline     |
    Then unit testing and formatting are selected without asking about them
    And the chooser offers the remaining optional features
    And the generated project includes formatting, unit testing, and GitHub Actions
    And the generated project includes the Vitest and Oxfmt tooling
    And unselected optional features are absent
    And installing dependencies and running the project checks succeeds

  Scenario Outline: Reject combining a preset with explicit features
    Given an empty workspace for a new project
    When I run agent-stack with "<arguments>" without --no-interactive
    Then the command fails without asking questions
    And the error explains "<problem>"
    And the command does not generate a project

    Examples:
      | arguments                                                    | problem                                    |
      | --name flagged-project --preset minimum --features vitest    | --preset and --features cannot be combined |
