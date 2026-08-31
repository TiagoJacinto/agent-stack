import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";

const executeFile = promisify(execFile);
const feature = await loadFeature("features/create-minimum-project.feature");

type CapabilityRow = {
  capability: string;
  "configured tool or artifact": string;
};

type ProcessResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

describeFeature(feature, ({ Scenario, AfterEachScenario }) => {
  let workspace: string | undefined;
  let generatedProject: string | undefined;
  let failedOutput: ProcessResult | undefined;

  AfterEachScenario(async () => {
    if (workspace !== undefined) {
      await rm(workspace, { recursive: true, force: true });
    }
    workspace = undefined;
    generatedProject = undefined;
    failedOutput = undefined;
  });

  Scenario("Generate a new project with the Minimum preset", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} with the Minimum preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
      await run(
        process.execPath,
        [resolve("dist/cli.js"), projectName, "--preset", "minimum"],
        currentWorkspace,
      );
    });

    Then(
      "the generated project provides:",
      async (_context, expectedCapabilities: CapabilityRow[]) => {
        const project = requireState(generatedProject, "The project was not generated.");
        const actualCapabilities = await inspectCapabilities(project);
        expect(actualCapabilities).toEqual(expectedCapabilities);
      },
    );

    And("the generated project records the Minimum preset selection", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      const manifest = await readJson<{ preset: string; features: string[] }>(
        join(project, ".agent-stack/manifest.json"),
      );

      expect(manifest.preset).toBe("minimum");
      expect(manifest.features).toEqual(
        expect.arrayContaining(["typescript-node-pnpm", "vitest", "gitleaks", "dependency-audit"]),
      );
    });

    And("installing dependencies and running the project checks succeeds", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "install"], project);
      await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "check"], project);
    });
  });

  Scenario(
    "Select individual features when no preset is supplied",
    ({ Given, When, Then, And }) => {
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      });

      When("I start creating {string} without a preset", async (_context, projectName: string) => {
        const currentWorkspace = requireState(workspace, "The workspace was not created.");
        generatedProject = join(currentWorkspace, projectName);
      });

      Then(
        "I am offered these optional features:",
        async (_context, features: { feature: string; label: string }[]) => {
          expect(features.map(({ feature }) => feature)).toEqual([
            "oxfmt",
            "oxlint",
            "vitest",
            "agent-context",
            "github-actions",
            "gitleaks",
            "dependency-audit",
          ]);
        },
      );

      When("I select these features:", async (_context, rows: { feature: string }[]) => {
        const project = requireState(generatedProject, "The project was not named.");
        const selected = new Set(rows.map(({ feature }) => feature));
        const input = [
          selected.has("oxfmt") ? "y" : "n",
          selected.has("oxlint") ? "y" : "n",
          selected.has("vitest") ? "y" : "n",
          selected.has("agent-context") ? "y" : "n",
          selected.has("github-actions") ? "y" : "n",
          selected.has("gitleaks") ? "y" : "n",
          selected.has("dependency-audit") ? "y" : "n",
        ].join("\n");
        await runInteractive(
          [resolve("dist/cli.js"), project.slice(project.lastIndexOf("/") + 1)],
          requireState(workspace, "The workspace was not created."),
          input,
        );
      });

      Then("the generated project includes the selected features", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        const packageJson = await readJson<{ devDependencies: Record<string, string> }>(
          join(project, "package.json"),
        );
        expect(packageJson.devDependencies).toHaveProperty("oxfmt");
        expect(packageJson.devDependencies).toHaveProperty("vitest");
        await expectFileToContain(project, ".gitleaks.toml", "useDefault = true");
      });

      And("GitHub Actions is included because secret scanning requires it", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectFileToContain(project, ".github/workflows/ci.yml", "gitleaks/gitleaks-action");
      });

      And("unselected optional features are absent", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        const packageJson = await readJson<{ devDependencies: Record<string, string> }>(
          join(project, "package.json"),
        );
        expect(packageJson.devDependencies).not.toHaveProperty("oxlint");
        await expect(readFile(join(project, "AGENTS.md"), "utf8")).rejects.toThrow();
      });

      And(
        "the generated project records requested and resolved features without a preset",
        async () => {
          const project = requireState(generatedProject, "The project was not generated.");
          const manifest = await readJson<{
            selection: { mode: string; requested: string[]; resolved: string[] };
          }>(join(project, ".agent-stack/manifest.json"));
          expect(manifest.selection).toEqual({
            mode: "features",
            requested: ["oxfmt", "vitest", "gitleaks"],
            resolved: [
              "typescript-node-pnpm",
              "obvious-scripts",
              "oxfmt",
              "vitest",
              "github-actions",
              "gitleaks",
            ],
          });
        },
      );

      And("installing dependencies and running the custom project checks succeeds", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "install"], project);
        await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "check"], project);
      });
    },
  );

  Scenario("Reject a non-empty target before feature selection", ({ Given, When, Then, And }) => {
    Given(
      "a workspace containing an existing {string} directory",
      async (_context, projectName: string) => {
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
        generatedProject = join(workspace, projectName);
        await mkdir(generatedProject);
        await writeFile(join(generatedProject, "existing.txt"), "keep me", "utf8");
      },
    );

    When("I start creating {string} without a preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
      failedOutput = await runInteractive(
        [resolve("dist/cli.js"), projectName],
        currentWorkspace,
        "",
      );
    });

    Then("the command fails before asking any feature questions", async () => {
      const output = requireState(failedOutput, "The CLI did not run.");
      expect(output.code).not.toBe(0);
      expect(output.stdout).not.toContain("Select optional features");
    });

    And("the error names the target directory on the next line", async () => {
      const output = requireState(failedOutput, "The CLI did not run.");
      const project = requireState(generatedProject, "The project was not named.");
      expect(output.stderr).toContain(
        `create-agent-stack: Target directory is not empty:\n${project}`,
      );
    });
  });
});

async function inspectCapabilities(project: string): Promise<CapabilityRow[]> {
  const packageJson = await readJson<{
    engines: { node: string };
    packageManager: string;
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  }>(join(project, "package.json"));
  const tsconfig = await readJson<{ compilerOptions: { strict: boolean } }>(
    join(project, "tsconfig.json"),
  );

  expect(tsconfig.compilerOptions.strict).toBe(true);
  expect(packageJson.engines.node).toBe(">=22");
  expect(packageJson.packageManager).toContain("pnpm");
  expect(packageJson.devDependencies).toHaveProperty("oxfmt");
  expect(packageJson.devDependencies).toHaveProperty("oxlint");
  expect(packageJson.devDependencies).toHaveProperty("vitest");
  expect(Object.keys(packageJson.scripts)).toEqual(
    expect.arrayContaining(["dev", "build", "test", "check"]),
  );
  await expectFileToContain(project, "tests/index.test.ts", "Expected greet(name)");
  await expectFiles(project, [
    "README.md",
    "AGENTS.md",
    "docs/GLOSSARY.md",
    ".agent-stack/progress.json",
    ".github/workflows/ci.yml",
    ".gitleaks.toml",
  ]);

  return [
    {
      capability: "runtime",
      "configured tool or artifact": "strict TypeScript on Node.js with pnpm",
    },
    { capability: "code quality", "configured tool or artifact": "oxfmt and oxlint" },
    {
      capability: "testing",
      "configured tool or artifact": "Vitest with an actionable example failure",
    },
    { capability: "scripts", "configured tool or artifact": "dev, build, test, and check" },
    {
      capability: "agent context",
      "configured tool or artifact": "README, AGENTS, glossary, and progress manifest",
    },
    {
      capability: "automated protection",
      "configured tool or artifact": "GitHub Actions, gitleaks, and dependency auditing",
    },
  ];
}

async function expectFiles(project: string, paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => readFile(join(project, path), "utf8")));
}

async function expectFileToContain(project: string, path: string, expected: string): Promise<void> {
  await expect(readFile(join(project, path), "utf8")).resolves.toContain(expected);
}

async function readJson<T>(path: string): Promise<T> {
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source) as T;
  } catch (error) {
    throw new Error(`Generated JSON is invalid: ${path}`, { cause: error });
  }
}

function requireState<T>(value: T | undefined, message: string): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

async function runInteractive(
  arguments_: readonly string[],
  cwd: string,
  input: string,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolvePromise, reject) => {
    const child = spawn(process.execPath, arguments_, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
    child.stdin.end(`${input}\n`);
  });
}

async function run(command: string, arguments_: readonly string[], cwd: string): Promise<void> {
  try {
    await executeFile(command, arguments_, {
      cwd,
      timeout: 150_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    if (error instanceof Error) {
      throw buildCommandFailure(command, arguments_, error);
    }
    throw error;
  }
}

function buildCommandFailure(command: string, arguments_: readonly string[], error: Error): Error {
  const output = error as Error & { stdout?: string; stderr?: string };
  return new Error(
    `Command failed: ${command} ${arguments_.join(" ")}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
    { cause: error },
  );
}
