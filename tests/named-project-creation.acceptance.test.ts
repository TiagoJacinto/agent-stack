import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";

const feature = await loadFeature("features/named-project-creation.feature");
type Result = { code: number | null; stdout: string; stderr: string };

async function runCli(args: string[], cwd: string, input = ""): Promise<Result> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve("dist/cli.js"), ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CLI did not finish: ${args.join(" ")}\n${stdout}\n${stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolveResult({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function argumentsFrom(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

describeFeature(feature, ({ Scenario, ScenarioOutline, AfterEachScenario }) => {
  let workspace: string;
  let project: string;
  let result: Result;

  AfterEachScenario(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  Scenario("Create a named project without prompts", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-named-"));
    });
    When("I run agent-stack in that workspace with {string}", async (_context, args: string) => {
      project = join(workspace, "test-agent-stack");
      result = await runCli(argumentsFrom(args), workspace);
    });
    Then("the command succeeds without asking questions", () => {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/Project directory:|Package manager \[|Include .*\?/);
    });
    And(
      "the project is generated in the workspace's {string} directory",
      async (_context, name: string) => {
        expect(project).toBe(join(workspace, name));
        await readFile(join(project, "package.json"), "utf8");
      },
    );
    And("the generated package is named {string}", async (_context, name: string) => {
      const packageJson = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        name: string;
      };
      expect(packageJson.name).toBe(name);
    });
    And("the generated project includes formatting and unit testing", async () => {
      const packageJson = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        devDependencies: Record<string, string>;
      };
      expect(packageJson.devDependencies).toHaveProperty("oxfmt");
      expect(packageJson.devDependencies).toHaveProperty("vitest");
    });
  });

  Scenario(
    "Create a named project with interactive feature selection",
    ({ Given, When, Then, And }) => {
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "agent-stack-named-"));
      });
      When(
        "I create a project with {string} and decline all optional features",
        async (_context, args: string) => {
          project = join(workspace, "test-agent-stack");
          const answers = `${"n\n".repeat(20)}`;
          result = await runCli(argumentsFrom(args), workspace, answers);
        },
      );
      Then(
        "the project is generated in the workspace's {string} directory",
        async (_context, name: string) => {
          expect(project).toBe(join(workspace, name));
          await readFile(join(project, "package.json"), "utf8");
        },
      );
      And("the generated package is named {string}", async (_context, name: string) => {
        const packageJson = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
          name: string;
        };
        expect(packageJson.name).toBe(name);
      });
      And("the command does not ask for a project name or directory", () => {
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).not.toContain("Project directory:");
      });
    },
  );

  Scenario("Ask for a missing project name interactively", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-named-"));
    });
    When(
      "I create a project with {string}, enter {string} as its name, and decline the remaining optional features",
      async (_context, args: string, name: string) => {
        project = join(workspace, name);
        result = await runCli(argumentsFrom(args), workspace, `${name}\n${"n\n".repeat(20)}`);
      },
    );
    Then("the command asks for the project name", () => {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("Project name:");
    });
    And(
      "the project is generated in the workspace's {string} directory",
      async (_context, name: string) => {
        expect(project).toBe(join(workspace, name));
        await readFile(join(project, "package.json"), "utf8");
      },
    );
    And("the generated package is named {string}", async (_context, name: string) => {
      const packageJson = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        name: string;
      };
      expect(packageJson.name).toBe(name);
    });
    And("the generated project includes formatting and unit testing", async () => {
      const packageJson = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
        devDependencies: Record<string, string>;
      };
      expect(packageJson.devDependencies).toHaveProperty("oxfmt");
      expect(packageJson.devDependencies).toHaveProperty("vitest");
    });
  });

  Scenario("Reject an invalid interactively entered project name", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-named-"));
    });
    When(
      "I create a project with {string} and enter {string} as its name",
      async (_context, args: string, name: string) => {
        result = await runCli(argumentsFrom(args), workspace, `${name}\n`);
      },
    );
    Then("the command fails because the project name is invalid", () => {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/invalid project name/i);
    });
    And("the workspace remains empty", async () => {
      expect(await readdir(workspace)).toEqual([]);
    });
  });

  ScenarioOutline("Reject invalid project creation options", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-named-"));
    });
    When("I run agent-stack in that workspace with {string}", async (_context, args: string) => {
      result = await runCli(argumentsFrom(args), workspace);
    });
    Then("the command fails without asking questions", () => {
      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toMatch(/Project directory:|Package manager \[|Include .*\?/);
    });
    And("the error explains {string}", async (_context, problem: string) => {
      const errors: Record<string, RegExp> = {
        "--name is required": /--name is required/i,
        "a preset or explicit feature selection is required":
          /preset or explicit feature selection is required/i,
        "use --name instead of a destination": /use --name instead of a destination/i,
        "the project name is invalid": /invalid project name/i,
      };
      expect(result.stderr).toMatch(errors[problem]!);
    });
    And("the workspace remains empty", async () => {
      expect(await readdir(workspace)).toEqual([]);
    });
  });

  Scenario("Preserve an occupied destination", ({ Given, When, Then, And }) => {
    Given(
      "a workspace containing user-owned content in {string}",
      async (_context, name: string) => {
        workspace = await mkdtemp(join(tmpdir(), "agent-stack-named-"));
        project = join(workspace, name);
        await mkdir(project);
        await writeFile(join(project, "user.txt"), "keep me\n");
      },
    );
    When("I run agent-stack in that workspace with {string}", async (_context, args: string) => {
      result = await runCli(argumentsFrom(args), workspace);
    });
    Then("the command fails because the destination is not empty", () => {
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/not empty|must be empty/i);
    });
    And("all user-owned content is preserved", async () => {
      expect(await readFile(join(project, "user.txt"), "utf8")).toBe("keep me\n");
    });
    And("no project files are generated", async () => {
      expect(await readdir(project)).toEqual(["user.txt"]);
    });
  });
});
