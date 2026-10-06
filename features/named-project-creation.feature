Feature: Create a named project in the current directory
  Developers supply a project name when creating an agent stack project.
  Creation uses that name for a child directory and the generated package.

  Scenario: Create a named project without prompts
    Given an empty workspace for a new project
    When I run agent-stack in that workspace with "--name test-agent-stack --no-interactive --features vitest,oxfmt --package-manager bun"
    Then the command succeeds without asking questions
    And the project is generated in the workspace's "test-agent-stack" directory
    And the generated package is named "test-agent-stack"
    And the generated project includes formatting and unit testing

  Scenario: Create a named project with interactive feature selection
    Given an empty workspace for a new project
    When I create a project with "--name test-agent-stack --package-manager bun" and decline all optional features
    Then the project is generated in the workspace's "test-agent-stack" directory
    And the generated package is named "test-agent-stack"
    And the command does not ask for a project name or directory

  Scenario Outline: Reject invalid project creation options
    Given an empty workspace for a new project
    When I run agent-stack in that workspace with "<arguments>"
    Then the command fails without asking questions
    And the error explains "<problem>"
    And the workspace remains empty

    Examples:
      | arguments                                             | problem                            |
      | --preset minimum --no-interactive                     | --name is required                 |
      | --no-interactive --features none                       | --name is required                 |
      | --name example-project --no-interactive                | a preset or explicit feature selection is required |
      | old-project --preset minimum                          | use --name instead of a destination |
      | --name ../outside --no-interactive --features none     | the project name is invalid        |
      | --name /tmp/outside --no-interactive --features none    | the project name is invalid        |
      | --name . --no-interactive --features none              | the project name is invalid        |
      | --name Invalid_Name --no-interactive --features none   | the project name is invalid        |

  Scenario: Preserve an occupied destination
    Given a workspace containing user-owned content in "test-agent-stack"
    When I run agent-stack in that workspace with "--name test-agent-stack --no-interactive --features none"
    Then the command fails because the destination is not empty
    And all user-owned content is preserved
    And no project files are generated

  Scenario: Ask for a missing project name interactively
    Given an empty workspace for a new project
    When I create a project with "--features vitest,oxfmt --package-manager bun", enter "test-agent-stack" as its name, and decline the remaining optional features
    Then the command asks for the project name
    And the project is generated in the workspace's "test-agent-stack" directory
    And the generated package is named "test-agent-stack"
    And the generated project includes formatting and unit testing

  Scenario: Reject an invalid interactively entered project name
    Given an empty workspace for a new project
    When I create a project with "--preset minimum" and enter "../outside" as its name
    Then the command fails because the project name is invalid
    And the workspace remains empty
