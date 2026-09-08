import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";
import { expect } from "vitest";

import { featureCatalog, presetSelection, shippingGates, type Preset } from "../src/catalog.js";
import { evaluateGeneratedModule, parseWorkflow } from "./artifact-semantics.js";

const executeFile = promisify(execFile);
const feature = await loadFeature("features/create-minimum-project.feature");

type CapabilityRow = {
  capability: string;
  "configured tool or artifact": string;
};

type HierarchyRow = {
  readonly feature: string;
  readonly label: string;
  readonly parent: string;
};

type ArtifactRow = {
  readonly artifact: string;
  readonly "user-owned content": string;
};

type ProcessResult = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

describeFeature(feature, ({ Scenario, ScenarioOutline, AfterEachScenario }) => {
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
        [resolve("dist/cli.js"), "create", projectName, "--preset", "minimum"],
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

    And("the generated project records Minimum as its initial preset", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      const manifest = await readJson<{ initialPreset: string; features: string[] }>(
        join(project, ".agent-stack/manifest.json"),
      );

      expect(manifest.initialPreset).toBe("minimum");
      expect(manifest.features).toEqual(
        expect.arrayContaining([
          "typescript-node-pnpm",
          "vitest",
          "gitleaks",
          "dependency-audit",
          "oxlint",
          "ultracite",
          "anti-slop",
        ]),
      );

      const progress = await readJson<Record<string, unknown>>(
        join(project, ".agent-stack/progress.json"),
      );
      expect(progress).not.toHaveProperty("selectedFeatures");
    });

    And(
      "its shipping gates require successful build, formatting, linting, type checking, existing tests, secret scanning, dependency auditing, a narrow change scope, and a basic agent compute budget",
      async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        const policy = await readJson<{ gates: string[] }>(
          join(project, ".agent-stack/shipping-gates.json"),
        );
        expect(policy.gates).toEqual(shippingGates(presetSelection("minimum")));
      },
    );

    And(
      "the generated project contains this Oxlint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "oxlint.config.ts", configuration);
      },
    );

    And("installing dependencies and running the project checks succeeds", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "install"], project);
      await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "check"], project);
    });
  });

  ScenarioOutline(
    "Generate a project with a progressively stronger shipping preset",
    ({ Given, When, Then, And }, example) => {
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      });

      When("I create {string} with the {string} preset", async () => {
        const currentWorkspace = requireState(workspace, "The workspace was not created.");
        generatedProject = join(currentWorkspace, example.project);
        await run(
          process.execPath,
          [
            resolve("dist/cli.js"),
            "create",
            example.project,
            "--preset",
            example.preset.toLowerCase(),
          ],
          currentWorkspace,
        );
      });

      Then("the generated project records {string} as its initial preset", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        const manifest = await readJson<{ initialPreset: string }>(
          join(project, ".agent-stack/manifest.json"),
        );
        expect(manifest.initialPreset).toBe(example.preset.toLowerCase());
      });

      And("its shipping gates include every gate from the {string} preset", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        const policy = await readJson<{ gates: string[] }>(
          join(project, ".agent-stack/shipping-gates.json"),
        );
        expect(policy.gates).toEqual(
          expect.arrayContaining([
            ...shippingGates(presetSelection(example["previous preset"].toLowerCase() as Preset)),
          ]),
        );
      });

      And("its shipping gates add:", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        const policy = await readJson<{ gates: string[] }>(
          join(project, ".agent-stack/shipping-gates.json"),
        );
        expect(policy.gates).toEqual(
          expect.arrayContaining([
            example["added gate 1"],
            example["added gate 2"],
            example["added gate 3"],
          ]),
        );
      });

      And("it requires {string}", async () => assertShippingGate(example["added gate 1"]));
      And("it additionally requires {string}", async () =>
        assertShippingGate(example["added gate 2"]),
      );
      And("it finally requires {string}", async () => assertShippingGate(example["added gate 3"]));

      async function assertShippingGate(gate: string): Promise<void> {
        const project = requireState(generatedProject, "The project was not generated.");
        const policy = await readJson<{ gates: string[] }>(
          join(project, ".agent-stack/shipping-gates.json"),
        );
        expect(policy.gates).toContain(gate);
      }

      And("installing dependencies and running the project checks succeeds", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "install"], project);
        await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "check"], project);
      });
    },
  );

  Scenario("Recommend Medium as the default shipping preset", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} with the Medium preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
      await run(
        process.execPath,
        [resolve("dist/cli.js"), "create", projectName, "--preset", "medium"],
        currentWorkspace,
      );
    });

    Then("the generated project records Medium as its initial preset", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      const manifest = await readJson<{ initialPreset: string }>(
        join(project, ".agent-stack/manifest.json"),
      );
      expect(manifest.initialPreset).toBe("medium");
    });

    And(
      "the generated project documentation identifies Medium as the default production recommendation",
      async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectFileToContain(
          project,
          "README.md",
          "Medium is the default recommendation for production projects.",
        );
      },
    );
  });

  Scenario(
    "Select individual features when no preset is supplied",
    ({ Given, When, Then, And }) => {
      let hierarchy: HierarchyRow[] = [];
      let interactiveOutput: ProcessResult | undefined;

      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      });

      When("I start creating {string} without a preset", async (_context, projectName: string) => {
        const currentWorkspace = requireState(workspace, "The workspace was not created.");
        generatedProject = join(currentWorkspace, projectName);
      });

      Then(
        "the feature chooser has this hierarchy:",
        async (_context, features: HierarchyRow[]) => {
          hierarchy = features;
          expect(features).toEqual([
            { feature: "oxfmt", label: "Formatting", parent: "" },
            { feature: "oxlint", label: "Linting", parent: "" },
            { feature: "anti-slop", label: "Anti-slop", parent: "oxlint" },
            { feature: "anti-slop-effect", label: "Anti-slop Effect", parent: "anti-slop" },
            { feature: "eslint", label: "ESLint", parent: "" },
            { feature: "ultracite", label: "Ultracite", parent: "" },
            { feature: "vitest", label: "Unit testing", parent: "" },
            { feature: "property-testing", label: "Property-based testing", parent: "" },
            { feature: "mutation-testing", label: "Mutation testing", parent: "" },
            { feature: "agent-context", label: "Agent context", parent: "" },
            { feature: "github-actions", label: "GitHub Actions", parent: "" },
            { feature: "gitleaks", label: "Secret scanning", parent: "" },
            { feature: "dependency-audit", label: "Dependency auditing", parent: "" },
          ]);
        },
      );

      When("I select these features:", async (_context, rows: { feature: string }[]) => {
        const project = requireState(generatedProject, "The project was not named.");
        const selected = new Set(rows.map(({ feature }) => feature));
        interactiveOutput = await runInteractive(
          [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
          requireState(workspace, "The workspace was not created."),
          featureInput(selected),
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
        const workflow = parseWorkflow(
          await readFile(join(project, ".github/workflows/ci.yml"), "utf8"),
        );
        expect(workflow.jobs.verify?.steps).toContainEqual({ uses: "gitleaks/gitleaks-action@v2" });
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

      And("child features are offered only after their parent is selected", async () => {
        expect(hierarchy.filter(({ parent }) => parent.length > 0)).toEqual([
          { feature: "anti-slop", label: "Anti-slop", parent: "oxlint" },
          { feature: "anti-slop-effect", label: "Anti-slop Effect", parent: "anti-slop" },
        ]);
      });

      And("the command does not ask for confirmation", async () => {
        expect(
          requireState(interactiveOutput, "The feature selection did not run.").stdout,
        ).not.toContain("Continue without unsupported features?");
      });

      And("installing dependencies and running the custom project checks succeeds", async () => {
        const project = requireState(generatedProject, "The project was not generated.");
        await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "install"], project);
        await run("npm", ["exec", "--yes", "pnpm@10.11.0", "--", "check"], project);
      });
    },
  );

  Scenario(
    "Add the Vitest adapter for selected property-based testing",
    ({ Given, When, Then, And }) => {
      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      });

      When("I create {string} without a preset", async (_context, projectName: string) => {
        const currentWorkspace = requireState(workspace, "The workspace was not created.");
        generatedProject = join(currentWorkspace, projectName);
      });

      And("I select these features:", async (_context, rows: { feature: string }[]) => {
        const project = requireState(generatedProject, "The project was not named.");
        const result = await runInteractive(
          [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
          requireState(workspace, "The workspace was not created."),
          featureInput(new Set(rows.map(({ feature }) => feature))),
        );
        expect(result.code).toBe(0);
      });

      const expectDependency = async (_context: unknown, dependency: string): Promise<void> => {
        const project = requireState(generatedProject, "The project was not generated.");
        const packageJson = await readJson<{
          devDependencies: Record<string, string>;
        }>(join(project, "package.json"));
        expect(packageJson.devDependencies).toHaveProperty(dependency);
      };

      Then("the generated project declares {string} in devDependencies", expectDependency);
      And("the generated project declares {string} in devDependencies", expectDependency);
    },
  );

  Scenario("Configure Oxlint with the default Ultracite preset", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} without a preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
    });

    And("I select these features:", async (_context, rows: { feature: string }[]) => {
      const project = requireState(generatedProject, "The project was not named.");
      await runInteractive(
        [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
        requireState(workspace, "The workspace was not created."),
        featureInput(new Set(rows.map(({ feature }) => feature))),
      );
    });

    Then(
      "the generated project contains this Oxlint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "oxlint.config.ts", configuration);
      },
    );
  });

  Scenario("Configure Oxlint with local anti-slop", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} without a preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
    });

    And("I select these features:", async (_context, rows: { feature: string }[]) => {
      const project = requireState(generatedProject, "The project was not named.");
      await runInteractive(
        [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
        requireState(workspace, "The workspace was not created."),
        featureInput(new Set(rows.map(({ feature }) => feature))),
      );
    });

    Then(
      "the generated project contains this Oxlint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "oxlint.config.ts", configuration);
      },
    );

    And("the generated project contains the vendored anti-slop plugin", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      const plugin = await stat(join(project, "tools/oxlint/anti-slop/index.ts"));
      expect(plugin.isFile()).toBe(true);
    });

    And("the generated project does not contain an Ultracite dependency", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      const packageJson = await readJson<{ devDependencies: Record<string, string> }>(
        join(project, "package.json"),
      );
      expect(packageJson.devDependencies).not.toHaveProperty("ultracite");
    });
  });

  Scenario("Choose Oxlint as Ultracite's default backend", ({ Given, When, Then, And }) => {
    let interactiveOutput: ProcessResult | undefined;

    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} without a preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
    });

    And("I select these features:", async (_context, rows: { feature: string }[]) => {
      const project = requireState(generatedProject, "The project was not named.");
      interactiveOutput = await runInteractive(
        [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
        requireState(workspace, "The workspace was not created."),
        featureInput(new Set(rows.map(({ feature }) => feature))),
      );
    });

    And("I accept Oxlint as the default Ultracite backend", async () => {
      const output = requireState(interactiveOutput, "The feature selection did not run.");
      expect(output.stdout).toContain("Choose Ultracite's backend:");
      expect(output.stdout).toContain("Backend [1]:");
      expect(output.code).toBe(0);
    });

    Then("the resolved features include {string}", async (_context, feature: string) => {
      const project = requireState(generatedProject, "The project was not generated.");
      const manifest = await readJson<{ selection: { resolved: string[] } }>(
        join(project, ".agent-stack/manifest.json"),
      );
      expect(manifest.selection.resolved).toContain(feature);
    });

    And("the resolved features include {string}", async (_context, feature: string) => {
      const project = requireState(generatedProject, "The project was not generated.");
      const manifest = await readJson<{ selection: { resolved: string[] } }>(
        join(project, ".agent-stack/manifest.json"),
      );
      expect(manifest.selection.resolved).toContain(feature);
    });

    And(
      "the generated project contains this Oxlint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "oxlint.config.ts", configuration);
      },
    );
  });

  Scenario("Configure both Oxlint and ESLint with Ultracite", ({ Given, When, Then, And }) => {
    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} without a preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
    });

    And("I select these features:", async (_context, rows: { feature: string }[]) => {
      const project = requireState(generatedProject, "The project was not named.");
      const result = await runInteractive(
        [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
        requireState(workspace, "The workspace was not created."),
        featureInput(new Set(rows.map(({ feature }) => feature))),
      );
      expect(result.code).toBe(0);
    });

    Then(
      "the generated project contains this Oxlint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "oxlint.config.ts", configuration);
      },
    );

    And(
      "the generated project contains this ESLint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "eslint.config.mjs", configuration);
      },
    );
  });

  Scenario("Warn before dropping unsupported anti-slop-effect", ({ Given, When, Then, And }) => {
    let interactiveOutput: ProcessResult | undefined;

    Given("an empty workspace for a new project", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
    });

    When("I create {string} without a preset", async (_context, projectName: string) => {
      const currentWorkspace = requireState(workspace, "The workspace was not created.");
      generatedProject = join(currentWorkspace, projectName);
    });

    And("I select these features:", async (_context, rows: { feature: string }[]) => {
      const project = requireState(generatedProject, "The project was not named.");
      interactiveOutput = await runInteractive(
        [resolve("dist/cli.js"), "create", project.slice(project.lastIndexOf("/") + 1)],
        requireState(workspace, "The workspace was not created."),
        featureInput(new Set(rows.map(({ feature }) => feature)), "y"),
      );
    });

    Then("the command warns that Ultracite does not support anti-slop-effect", async () => {
      expect(
        requireState(interactiveOutput, "The feature selection did not run.").stdout,
      ).toContain("Warning: Ultracite does not support anti-slop-effect.");
    });

    And("the command asks for confirmation before generating the project", async () => {
      expect(
        requireState(interactiveOutput, "The feature selection did not run.").stdout,
      ).toContain("Continue without unsupported features?");
    });

    When("I confirm the warning", async () => {
      expect(requireState(interactiveOutput, "The feature selection did not run.").code).toBe(0);
    });

    Then(
      "the generated project contains this Oxlint configuration:",
      async (_context, configuration: string) => {
        const project = requireState(generatedProject, "The project was not generated.");
        await expectGeneratedModuleToEqual(project, "oxlint.config.ts", configuration);
      },
    );

    And("the generated project contains no anti-slop-effect configuration", async () => {
      const project = requireState(generatedProject, "The project was not generated.");
      await expect(
        readFile(join(project, "tools/oxlint/anti-slop/effect/index.ts"), "utf8"),
      ).rejects.toThrow();
      const config = evaluateGeneratedModule<{ jsPlugins?: { name: string }[] }>(
        await readFile(join(project, "oxlint.config.ts"), "utf8"),
      );
      expect(config.jsPlugins ?? []).not.toContainEqual({ name: "anti-slop-effect" });
    });

    And("the manifest records {string} as omitted", async (_context, feature: string) => {
      const project = requireState(generatedProject, "The project was not generated.");
      const manifest = await readJson<{ selection: { omitted: string[] } }>(
        join(project, ".agent-stack/manifest.json"),
      );
      expect(manifest.selection.omitted).toContain(feature);
    });
  });

  Scenario(
    "Cancel generation after an unsupported combination warning",
    ({ Given, When, Then, And }) => {
      let interactiveOutput: ProcessResult | undefined;

      Given("an empty workspace for a new project", async () => {
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      });

      When(
        "I create {string} with Oxlint, Ultracite, and anti-slop-effect",
        async (_context, projectName: string) => {
          const currentWorkspace = requireState(workspace, "The workspace was not created.");
          generatedProject = join(currentWorkspace, projectName);
          interactiveOutput = await runInteractive(
            [resolve("dist/cli.js"), "create", projectName],
            currentWorkspace,
            featureInput(new Set(["oxlint", "anti-slop", "anti-slop-effect", "ultracite"]), "n"),
          );
        },
      );

      And("I decline the compatibility warning", async () => {
        expect(
          requireState(interactiveOutput, "The feature selection did not run.").stdout,
        ).toContain("Continue without unsupported features?");
      });

      Then("the command does not generate a project", async () => {
        const project = requireState(generatedProject, "The project was not named.");
        await expect(readFile(join(project, "package.json"), "utf8")).rejects.toThrow();
      });
    },
  );

  Scenario(
    "The create command rejects a non-empty target before feature selection",
    ({ Given, When, Then, And }) => {
      Given(
        "a workspace containing an existing {string} directory",
        async (_context, projectName: string) => {
          workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
          generatedProject = join(workspace, projectName);
          await mkdir(generatedProject);
          await writeFile(join(generatedProject, "existing.txt"), "keep me", "utf8");
        },
      );

      When(
        "I start the create command for {string} without a preset",
        async (_context, projectName: string) => {
          const currentWorkspace = requireState(workspace, "The workspace was not created.");
          generatedProject = join(currentWorkspace, projectName);
          failedOutput = await runInteractive(
            [resolve("dist/cli.js"), "create", projectName],
            currentWorkspace,
            "",
          );
        },
      );

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
    },
  );

  Scenario("Merge the Minimum preset into an existing project", ({ Given, When, Then, And }) => {
    Given(
      "an existing project with user-owned content in these artifacts:",
      async (_context, artifacts: ArtifactRow[]) => {
        expect(artifacts).toHaveLength(6);
        workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
        generatedProject = join(workspace, "existing-project");
        await mkdir(join(generatedProject, "src"), { recursive: true });
        await mkdir(join(generatedProject, ".github/workflows"), { recursive: true });
        await writeFile(
          join(generatedProject, "package.json"),
          `${JSON.stringify(
            {
              name: "human-project",
              version: "9.8.7",
              description: "Human-authored metadata",
              scripts: { existing: "echo existing" },
              dependencies: { picocolors: "^1.1.1" },
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await writeFile(
          join(generatedProject, "tsconfig.json"),
          `${JSON.stringify(
            {
              compilerOptions: { target: "ES2023", paths: { "@/*": ["src/*"] } },
              include: ["custom/**/*.ts"],
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
        await writeFile(
          join(generatedProject, "oxlint.config.ts"),
          'import { defineConfig } from "oxlint";\n\nexport default defineConfig({\n  rules: { "no-alert": "warn" },\n});\n',
          "utf8",
        );
        await writeFile(
          join(generatedProject, ".github/workflows/ci.yml"),
          "name: Existing CI\n\non:\n  push:\n    branches: [develop]\n\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo build\n",
          "utf8",
        );
        await writeFile(join(generatedProject, "README.md"), "# Existing project\n", "utf8");
        await writeFile(
          join(generatedProject, "src/existing.ts"),
          "export const existing = true;\n",
          "utf8",
        );
      },
    );

    When("I run the merge command for that project with the Minimum preset", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      failedOutput = await runInteractive(
        [resolve("dist/cli.js"), "merge", project, "--preset", "minimum"],
        requireState(workspace, "The workspace was not created."),
        "",
      );
    });

    Then("all user-owned content is preserved", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const packageJson = await readJson<{ name: string; version: string; description: string }>(
        join(project, "package.json"),
      );
      expect(packageJson).toMatchObject({
        name: "human-project",
        version: "9.8.7",
        description: "Human-authored metadata",
      });
      const oxlint = evaluateGeneratedModule<{ rules: Record<string, string> }>(
        await readFile(join(project, "oxlint.config.ts"), "utf8"),
      );
      const workflow = parseWorkflow(
        await readFile(join(project, ".github/workflows/ci.yml"), "utf8"),
      );
      await expectFileToContain(project, "src/existing.ts", "existing = true");
      expect(oxlint.rules).toEqual({ "no-alert": "warn" });
      expect(workflow.jobs).toHaveProperty("build");
      await expectFileToContain(project, "README.md", "# Existing project");
    });

    And("package scripts and dependencies are merged by name", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const packageJson = await readJson<{
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      }>(join(project, "package.json"));
      expect(packageJson.scripts.existing).toBe("echo existing");
      expect(packageJson.scripts.test).toBe("vitest run --passWithNoTests");
      expect(packageJson.dependencies.picocolors).toBe("^1.1.1");
      expect(packageJson.devDependencies).toHaveProperty("vitest");
    });

    And("TypeScript configuration is merged by option and path", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const tsconfig = await readJson<{
        compilerOptions: { strict: boolean; paths: Record<string, string[]> };
        include: string[];
      }>(join(project, "tsconfig.json"));
      expect(tsconfig.compilerOptions.strict).toBe(true);
      expect(tsconfig.compilerOptions.paths["@/*"]).toEqual(["src/*"]);
      expect(tsconfig.include).toEqual(["src/**/*.ts", "tests/**/*.ts", "custom/**/*.ts"]);
    });

    And("Oxlint configuration is merged by import, plugin, extension, and rule", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const config = evaluateGeneratedModule<{
        extends: { id: string }[];
        rules: Record<string, string>;
      }>(await readFile(join(project, "oxlint.config.ts"), "utf8"));
      expect(config.extends.map(({ id }) => id)).toEqual(["ultracite-core", "ultracite-anti-slop"]);
      expect(config.rules).toEqual({ "no-alert": "warn" });
    });

    And("workflow configuration is merged by trigger, job, and step", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const workflow = parseWorkflow(
        await readFile(join(project, ".github/workflows/ci.yml"), "utf8"),
      );
      expect(workflow.triggers).toEqual(
        expect.objectContaining({ pull_request: {}, push: { branches: ["develop", "main"] } }),
      );
      expect(workflow.jobs.verify?.steps).toContainEqual({ uses: "actions/checkout@v4" });
    });

    And("agent-stack documentation is added in a managed Markdown block", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      await expectFileToContain(project, "README.md", "<!-- agent-stack:start -->");
      await expectFileToContain(project, "AGENTS.md", "<!-- agent-stack:start -->");
    });

    And("missing Minimum capabilities are added", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      await expectFiles(project, [
        "tsconfig.build.json",
        "vitest.config.ts",
        ".github/workflows/ci.yml",
        ".gitleaks.toml",
        ".agent-stack/manifest.json",
      ]);
    });

    And("merge-only generation does not add example source code or example tests", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      await expect(readFile(join(project, "src/index.ts"), "utf8")).rejects.toThrow();
      await expect(readFile(join(project, "tests/index.test.ts"), "utf8")).rejects.toThrow();
    });

    And("the project records Minimum as its initial preset after merging", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const manifest = await readJson<{ initialPreset: string }>(
        join(project, ".agent-stack/manifest.json"),
      );
      expect(manifest.initialPreset).toBe("minimum");
    });

    And("installing dependencies and running the project checks succeeds", async () => {
      expect(requireState(failedOutput, "The merge command did not run.").code).toBe(0);
    });
  });

  Scenario("Merge both supported linter configurations", ({ Given, When, Then, And }) => {
    Given("an existing project with customized Oxlint and ESLint configurations", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      generatedProject = join(workspace, "linter-project");
      await mkdir(generatedProject, { recursive: true });
      await writeFile(
        join(generatedProject, "oxlint.config.ts"),
        'import { defineConfig } from "oxlint";\n\nexport default defineConfig({\n  rules: { "no-alert": "warn" },\n});\n',
        "utf8",
      );
      await writeFile(
        join(generatedProject, "eslint.config.mjs"),
        'import custom from "custom";\n\nexport default [custom];\n',
        "utf8",
      );
    });

    When("I merge Oxlint, ESLint, and Ultracite into that project", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      failedOutput = await runInteractive(
        [resolve("dist/cli.js"), "merge", project],
        requireState(workspace, "The workspace was not created."),
        featureInput(new Set(["oxlint", "eslint", "ultracite"])),
      );
    });

    Then("both existing linter configurations are preserved", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const oxlint = evaluateGeneratedModule<{ rules: Record<string, string> }>(
        await readFile(join(project, "oxlint.config.ts"), "utf8"),
      );
      const eslint = evaluateGeneratedModule<{ id: string }[]>(
        await readFile(join(project, "eslint.config.mjs"), "utf8"),
      );
      expect(oxlint.rules).toEqual({ "no-alert": "warn" });
      expect(eslint).toContainEqual({ id: "custom-eslint" });
    });

    And("the selected Ultracite configuration is added to both linters", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const oxlint = evaluateGeneratedModule<{ extends: { id: string }[] }>(
        await readFile(join(project, "oxlint.config.ts"), "utf8"),
      );
      const eslint = evaluateGeneratedModule<{ id: string }[]>(
        await readFile(join(project, "eslint.config.mjs"), "utf8"),
      );
      expect(oxlint.extends).toContainEqual(expect.objectContaining({ id: "ultracite-core" }));
      expect(eslint).toContainEqual(expect.objectContaining({ id: "eslint-core" }));
    });

    And("neither linter configuration contains duplicate entries", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const oxlint = evaluateGeneratedModule<{ extends: { id: string }[] }>(
        await readFile(join(project, "oxlint.config.ts"), "utf8"),
      );
      const eslint = evaluateGeneratedModule<{ id: string }[]>(
        await readFile(join(project, "eslint.config.mjs"), "utf8"),
      );
      expect(oxlint.extends.filter(({ id }) => id === "ultracite-core")).toHaveLength(1);
      expect(eslint.filter(({ id }) => id === "eslint-core")).toHaveLength(1);
    });
  });

  Scenario("Repeat a semantic merge", ({ Given, When, Then, And }) => {
    let snapshot = "";

    Given("an existing project that already contains a merged Minimum preset", async () => {
      workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
      generatedProject = join(workspace, "repeat-project");
      await mkdir(generatedProject, { recursive: true });
      await run(
        process.execPath,
        [resolve("dist/cli.js"), "merge", generatedProject, "--preset", "minimum"],
        requireState(workspace, "The workspace was not created."),
      );
      snapshot = await readFile(join(generatedProject, "oxlint.config.ts"), "utf8");
    });

    When("I merge the Minimum preset into that project again", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      failedOutput = await runInteractive(
        [resolve("dist/cli.js"), "merge", project, "--preset", "minimum"],
        requireState(workspace, "The workspace was not created."),
        "",
      );
    });

    Then("no project content changes", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      expect(requireState(failedOutput, "The merge command did not run.").stdout).toContain(
        "(0 files)",
      );
      await expectFileToEqual(project, "oxlint.config.ts", snapshot);
    });

    And("no configuration contains duplicate entries", async () => {
      const project = requireState(generatedProject, "The project was not created.");
      const config = evaluateGeneratedModule<{ extends: { id: string }[] }>(
        await readFile(join(project, "oxlint.config.ts"), "utf8"),
      );
      expect(config.extends.filter(({ id }) => id === "ultracite-core")).toHaveLength(1);
    });
  });

  Scenario(
    "Refuse an incompatible semantic collision without changing the project",
    ({ Given, When, Then, And }) => {
      let originalConfig = "";

      Given(
        "an existing project assigns an agent-stack-owned configuration key an incompatible value",
        async () => {
          workspace = await mkdtemp(join(tmpdir(), "create-agent-stack-acceptance-"));
          generatedProject = join(workspace, "collision-project");
          await mkdir(generatedProject, { recursive: true });
          originalConfig = `${JSON.stringify(
            { compilerOptions: { target: "ES2019" } },
            null,
            2,
          )}\n`;
          await writeFile(join(generatedProject, "tsconfig.json"), originalConfig, "utf8");
        },
      );

      When("I run the merge command for that project", async () => {
        const project = requireState(generatedProject, "The project was not created.");
        failedOutput = await runInteractive(
          [resolve("dist/cli.js"), "merge", project, "--preset", "minimum"],
          requireState(workspace, "The workspace was not created."),
          "",
        );
      });

      Then("the command fails with the conflicting artifact and configuration key", async () => {
        const output = requireState(failedOutput, "The merge command did not run.");
        expect(output.code).not.toBe(0);
        expect(output.stderr).toContain("tsconfig.json.compilerOptions.target");
      });

      And("no project files are changed", async () => {
        const project = requireState(generatedProject, "The project was not created.");
        await expectFileToEqual(project, "tsconfig.json", originalConfig);
        await expect(readFile(join(project, "package.json"), "utf8")).rejects.toThrow();
      });
    },
  );
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
  expect(packageJson.devDependencies).toHaveProperty("ultracite");
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
    "oxlint.config.ts",
    ".github/workflows/ci.yml",
    ".gitleaks.toml",
    ".agent-stack/shipping-gates.json",
  ]);

  return [
    {
      capability: "runtime",
      "configured tool or artifact": "strict TypeScript on Node.js with pnpm",
    },
    {
      capability: "code quality",
      "configured tool or artifact": "oxfmt and Oxlint with Ultracite core and anti-slop",
    },
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
    {
      capability: "quality policy",
      "configured tool or artifact": "Minimum deterministic shipping gates and agent budget",
    },
  ];
}

type CatalogFeature = (typeof featureCatalog)[number];

function featureInput(selected: ReadonlySet<string>, confirmation?: "y" | "n"): string {
  const answers: string[] = [];

  const visit = (feature: CatalogFeature): void => {
    const included = selected.has(feature.id);
    answers.push(included ? "y" : "n");
    if (!included) return;

    for (const child of featureCatalog.filter(({ parent }) => parent === feature.id)) {
      visit(child);
    }
  };

  for (const feature of featureCatalog.filter(({ parent }) => parent === null)) visit(feature);
  if (selected.has("ultracite") && !selected.has("oxlint") && !selected.has("eslint")) {
    answers.push("");
  }
  if (confirmation !== undefined) answers.push(confirmation);
  return answers.join("\n");
}

async function expectFileToEqual(project: string, path: string, expected: string): Promise<void> {
  const actual = await readFile(join(project, path), "utf8");
  const normalize = (value: string): string =>
    value
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
  expect(normalize(actual)).toBe(normalize(expected));
}

async function expectGeneratedModuleToEqual(
  project: string,
  path: string,
  expected: string,
): Promise<void> {
  const actual = evaluateGeneratedModule(await readFile(join(project, path), "utf8"));
  expect(actual).toEqual(evaluateGeneratedModule(expected));
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
