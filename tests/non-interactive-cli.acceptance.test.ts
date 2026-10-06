import { spawn, execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";

import { featureCatalog } from "../src/catalog.js";

const feature = await loadFeature("features/non-interactive-cli.feature");
const executeFile = promisify(execFile);
type Result = { code: number | null; stdout: string; stderr: string };
type Manifest = {
  packageManager: string;
  initialPreset?: string;
  features: string[];
  selection?: { requested: string[]; resolved: string[] };
};

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

describeFeature(feature, ({ Scenario, ScenarioOutline, AfterEachScenario }) => {
  let workspace: string;
  let project: string;
  let result: Result;

  AfterEachScenario(async () => {
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  Scenario("Create a project with explicitly selected features", ({ Given, When, Then, And }) => {
    // state verification
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
    });
    When(
      "I run agent-stack with these arguments and no interactive input:",
      async (_context, rows: { argument: string }[]) => {
        const args = rows.map(({ argument }) => argument);
        project = join(workspace, args[1]!);
        result = await runCli(args, workspace);
      },
    );
    Then("the command succeeds without asking questions", () => {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(
        /Project directory:|Package manager \[|Include .*\?|Backend \[|Continue without/,
      );
    });
    And("the generated project records Bun as its package manager", async () => {
      expect((await manifest()).packageManager).toBe("bun");
      expect((await packageJson()).packageManager).toBe("bun@1.3.14");
    });
    And(
      "the generated project records requested and resolved features without a preset",
      async () => {
        const value = await manifest();
        expect(value).not.toHaveProperty("initialPreset");
        expect(value.selection).toEqual({
          mode: "features",
          requested: ["oxfmt", "vitest", "gitleaks"],
          resolved: [
            "typescript-node-bun",
            "obvious-scripts",
            "oxfmt",
            "vitest",
            "github-actions",
            "gitleaks",
          ],
        });
        expect(value.features).toEqual(value.selection?.resolved);
      },
    );
    And(
      "the generated project includes formatting, unit testing, and secret scanning",
      async () => {
        const value = await packageJson();
        expect(value.devDependencies).toHaveProperty("oxfmt");
        expect(value.devDependencies).toHaveProperty("vitest");
        await readFile(join(project, ".gitleaks.toml"), "utf8");
        await readFile(join(project, "vitest.config.ts"), "utf8");
      },
    );
    And("GitHub Actions is included because secret scanning requires it", async () => {
      expect((await manifest()).features).toContain("github-actions");
      expect(await readFile(join(project, ".github/workflows/ci.yml"), "utf8")).toContain(
        "gitleaks/gitleaks-action",
      );
    });
    And("unselected optional features are absent", async () => {
      const value = await packageJson();
      expect(Object.keys(value.devDependencies).sort()).toEqual([
        "@types/node",
        "oxfmt",
        "tsx",
        "typescript",
        "vitest",
      ]);
      expect(await readdir(project)).not.toContain("AGENTS.md");
    });
    And("installing dependencies and running the project checks succeeds", async () => {
      await checkProject();
    });
  });

  Scenario("Create a core-only project", ({ Given, When, Then, And }) => {
    // state verification
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
    });
    When(
      "I run agent-stack with these arguments and no interactive input:",
      async (_context, rows: { argument: string }[]) => {
        const args = rows.map(({ argument }) => argument);
        project = join(workspace, args[1]!);
        result = await runCli(args, workspace);
      },
    );
    Then("the command succeeds without asking questions", () => {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/Project directory:|Package manager \[|Include .*\?/);
    });
    And("the generated project uses pnpm", async () => {
      expect((await manifest()).packageManager).toBe("pnpm");
    });
    And("the generated project includes only core capabilities", async () => {
      expect((await manifest()).features).toEqual(["typescript-node-pnpm", "obvious-scripts"]);
      expect(await readdir(project)).not.toContain("tests");
    });
    And("installing dependencies and running the project checks succeeds", async () => {
      await checkProject();
    });
  });

  Scenario("Create the complete Minimum preset with Bun", ({ Given, When, Then, And }) => {
    // state verification
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
    });
    When(
      "I run agent-stack with these arguments and no interactive input:",
      async (_context, rows: { argument: string }[]) => {
        const args = rows.map(({ argument }) => argument);
        project = join(workspace, args[1]!);
        result = await runCli(args, workspace);
      },
    );
    Then("the command succeeds without asking questions", () => {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/Project directory:|Package manager \[|Include .*\?/);
    });
    And("the generated project records Minimum as its initial preset", async () => {
      const value = await manifest();
      expect(value.initialPreset).toBe("minimum");
    });
    And("the generated project records Bun as its package manager", async () => {
      expect((await manifest()).packageManager).toBe("bun");
    });
    And("the generated project includes every Minimum capability", async () => {
      expect((await manifest()).features).toEqual(
        expect.arrayContaining([
          "typescript-node-bun",
          "obvious-scripts",
          "oxfmt",
          "oxlint",
          "anti-slop",
          "ultracite",
          "vitest",
          "agent-context",
          "github-actions",
          "gitleaks",
          "dependency-audit",
        ]),
      );
      await readFile(join(project, ".agent-stack/shipping-gates.json"), "utf8");
    });
    And("installing dependencies and running the project checks succeeds", async () => {
      await checkProject();
    });
  });

  Scenario("Merge explicitly selected features without prompts", ({ Given, When, Then, And }) => {
    // state verification
    Given("an existing project with user-owned content", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
      project = join(workspace, "merge-project");
      await mkdir(join(project, "src"), { recursive: true });
      await writeFile(join(project, "src/app.ts"), "export const userOwned = true;\n");
      await writeFile(join(project, "README.md"), "# User documentation\n\nKeep this content.\n");
    });
    When(
      "I merge formatting and unit testing using command-line flags and no interactive input",
      async () => {
        result = await runCli(
          ["merge", project, "--no-interactive", "--features", "oxfmt,vitest"],
          workspace,
        );
      },
    );
    Then("the command succeeds without asking questions", () => {
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toMatch(/Project directory:|Package manager \[|Include .*\?/);
    });
    And("the selected capabilities are added", async () => {
      const value = (await JSON.parse(
        await readFile(join(project, ".agent-stack/manifest.json"), "utf8"),
      )) as Manifest;
      expect(value.selection?.resolved).toContain("oxfmt");
      expect(value.selection?.resolved).toContain("vitest");
      const generatedPackage = JSON.parse(
        await readFile(join(project, "package.json"), "utf8"),
      ) as { devDependencies: Record<string, string> };
      expect(generatedPackage.devDependencies).toHaveProperty("oxfmt");
      expect(generatedPackage.devDependencies).toHaveProperty("vitest");
    });
    And("all user-owned content is preserved", async () => {
      expect(await readFile(join(project, "src/app.ts"), "utf8")).toBe(
        "export const userOwned = true;\n",
      );
      expect(await readFile(join(project, "README.md"), "utf8")).toContain("Keep this content.");
    });
  });

  Scenario(
    "Use Oxlint as Ultracite's default backend without prompts",
    ({ Given, When, Then, And }) => {
      // state verification
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
      });
      When(
        "I run agent-stack with these arguments and no interactive input:",
        async (_context, rows: { argument: string }[]) => {
          const args = rows.map(({ argument }) => argument);
          project = join(workspace, args[1]!);
          result = await runCli(args, workspace);
        },
      );
      Then("the command succeeds without asking questions", () => {
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).not.toMatch(
          /Project directory:|Package manager \[|Include .*\?|Backend \[|Continue without/,
        );
      });
      And(
        "the resolved features include {string} and {string}",
        async (_context, firstFeature: string, secondFeature: string) => {
          const resolved = (await manifest()).selection?.resolved;
          expect(resolved).toContain(firstFeature);
          expect(resolved).toContain(secondFeature);
        },
      );
      And(
        "the feature manifest records Ultracite as requested and Oxlint as resolved",
        async () => {
          const value = await manifest();
          expect(value.selection?.requested).toEqual(["ultracite"]);
          expect(value.selection?.resolved).toContain("oxlint");
        },
      );
      And("the generated project uses Oxlint with Ultracite's core rules", async () => {
        const generatedPackage = await packageJson();
        expect(generatedPackage.devDependencies).toHaveProperty("oxlint");
        expect(await readFile(join(project, "oxlint.config.ts"), "utf8")).toContain(
          'from "ultracite/oxlint/core"',
        );
      });
      And("installing dependencies and running the project checks succeeds", async () => {
        await checkProject();
      });
    },
  );

  ScenarioOutline("Reject invalid non-interactive configuration", ({ Given, When, Then, And }) => {
    // result verification
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
    });
    When(
      "I run agent-stack non-interactively with {string}",
      async (_context, configuration: string) => {
        const args = configuration.split(/\s+/).filter(Boolean);
        project = join(workspace, args[0] ?? "missing-project");
        result = await runCli(["create", ...args, "--no-interactive"], workspace);
      },
    );
    Then("the command fails without asking questions", () => {
      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toMatch(
        /Project directory:|Package manager \[|Include .*\?|Continue without/,
      );
    });
    And("the error explains {string}", async (_context, problem: string) => {
      const errors: Record<string, RegExp> = {
        "--name is required": /--name is required/i,
        "a preset or explicit feature selection is required": /preset.*feature|feature.*preset/i,
        "the feature is unknown": /Unknown feature|unknown feature/i,
        "the package manager is unsupported":
          /Unknown package manager|unsupported package manager/i,
        "presets and individual selections cannot be combined":
          /cannot be combined|mutually exclusive/i,
        "React Compiler integrations are mutually exclusive":
          /React Compiler integrations are mutually exclusive/i,
        "the selected combination is unsupported": /unsupported|not supported/i,
      };
      expect(result.stderr).toMatch(errors[problem]!);
    });
    And("the command does not generate a project", async () => {
      expect(await readdir(workspace)).toEqual([]);
    });
  });

  Scenario(
    "Preselect features and choose the remaining features interactively",
    ({ Given, When, Then, And }) => {
      // state verification
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
      });
      When(
        "I create {string} with these feature choices:",
        async (_context, projectName: string, rows: { feature: string; choice: string }[]) => {
          project = join(workspace, projectName);
          const featureId = (name: string): string => {
            const feature = featureCatalog.find(({ id, label }) => id === name || label === name);
            if (feature === undefined) throw new Error(`Unknown feature choice: ${name}`);
            return feature.id;
          };
          const preselected = rows
            .filter(({ choice }) => choice === "preselected")
            .map(({ feature }) => featureId(feature));
          const selectedInChooser = new Set(
            rows
              .filter(({ choice }) => choice === "select")
              .map(({ feature }) => featureId(feature)),
          );
          expect(
            rows.some(
              ({ feature, choice }) =>
                feature === "remaining optional features" && choice === "decline",
            ),
          ).toBe(true);
          const answers = [
            "1",
            ...featureCatalog
              .filter(({ id, parent }) => parent === null && !preselected.includes(id))
              .map(({ id }) => (selectedInChooser.has(id) ? "y" : "n")),
          ];
          result = await runCli(
            ["--name", projectName, "--features", preselected.join(",")],
            workspace,
            `${answers.join("\n")}\n`,
          );
        },
      );
      Then("unit testing and formatting are selected without asking about them", async () => {
        expect(result.code, result.stderr).toBe(0);
        expect(result.stdout).not.toContain("Include Unit testing?");
        expect(result.stdout).not.toContain("Include Formatting?");
        expect((await manifest()).selection?.requested).toEqual([
          "vitest",
          "oxfmt",
          "github-actions",
        ]);
      });
      And("the chooser offers the remaining optional features", () => {
        expect(result.stdout).toContain("Include Linting?");
        expect(result.stdout).toContain("Include GitHub Actions?");
      });
      And(
        "the generated project includes formatting, unit testing, and GitHub Actions",
        async () => {
          expect((await packageJson()).devDependencies).toHaveProperty("oxfmt");
          expect((await packageJson()).devDependencies).toHaveProperty("vitest");
          expect(await readFile(join(project, ".github/workflows/ci.yml"), "utf8")).toContain(
            "name: CI",
          );
        },
      );
      And("the generated project includes the Vitest and Oxfmt tooling", async () => {
        const generatedPackage = await packageJson();
        expect(generatedPackage.devDependencies).toHaveProperty("vitest");
        expect(generatedPackage.devDependencies).toHaveProperty("oxfmt");
      });
      And("unselected optional features are absent", async () => {
        expect((await manifest()).selection?.resolved).toEqual([
          "typescript-node-pnpm",
          "obvious-scripts",
          "oxfmt",
          "vitest",
          "github-actions",
        ]);
      });
      And("installing dependencies and running the project checks succeeds", async () => {
        await checkProject();
      });
    },
  );

  ScenarioOutline(
    "Reject combining a preset with explicit features",
    ({ Given, When, Then, And }, example) => {
      // result verification
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "agent-stack-flags-"));
      });
      When("I run agent-stack with {string} without --no-interactive", async () => {
        const args = example.arguments.split(/\s+/).filter(Boolean);
        project = join(workspace, args[0] ?? "missing-project");
        result = await runCli(args, workspace);
      });
      Then("the command fails without asking questions", () => {
        expect(result.code).not.toBe(0);
        expect(result.stdout).toBe("");
      });
      And("the error explains {string}", async () => {
        expect(result.stderr).toContain(example.problem);
      });
      And("the command does not generate a project", async () => {
        expect(await readdir(workspace)).toEqual([]);
      });
    },
  );

  async function manifest(): Promise<Manifest> {
    return JSON.parse(await readFile(join(project, ".agent-stack/manifest.json"), "utf8"));
  }
  async function packageJson(): Promise<{
    packageManager: string;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  }> {
    return JSON.parse(await readFile(join(project, "package.json"), "utf8"));
  }
  async function checkProject() {
    const manager = (await manifest()).packageManager;
    const command = manager === "bun" ? "bun" : "npm";
    const prefix = manager === "bun" ? [] : ["exec", "--yes", "pnpm@10.11.0", "--"];
    for (const args of [["install"], ["run", "check"]]) {
      await executeFile(command, [...prefix, ...args], {
        cwd: project,
        timeout: 150_000,
        maxBuffer: 10 * 1024 * 1024,
      });
    }
  }
});
