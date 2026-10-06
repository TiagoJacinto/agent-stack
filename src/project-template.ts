import {
  packageManagerVersions,
  shippingGates,
  type FeatureId,
  type FeatureSelection,
  type PackageManager,
} from "./catalog.js";
import { antiSlopAssets } from "./anti-slop-assets.js";

const eslintSupportDependencies = {
  "@typescript-eslint/eslint-plugin": "^8.69.0",
  "@typescript-eslint/parser": "^8.69.0",
  "eslint-config-prettier": "^10.1.8",
  "eslint-import-resolver-typescript": "^4.4.5",
  "eslint-plugin-compat": "^7.0.2",
  "eslint-plugin-cypress": "^7.0.1",
  "eslint-plugin-github": "6.1.2",
  "eslint-plugin-html": "^8.2.0",
  "eslint-plugin-import-x": "^4.17.1",
  "eslint-plugin-jsdoc": "^64.3.5",
  "eslint-plugin-n": "^18.3.0",
  "eslint-plugin-prettier": "^5.5.6",
  "eslint-plugin-promise": "^7.3.0",
  "eslint-plugin-sonarjs": "^4.2.0",
  "eslint-plugin-storybook": "^10.6.0",
  "eslint-plugin-unicorn": "^74.0.0",
  "eslint-plugin-unused-imports": "^4.4.1",
  globals: "^17.12.0",
  prettier: "^3.9.6",
} as const;

export function projectFiles(
  projectName: string,
  selection: FeatureSelection,
): Readonly<Record<string, string>> {
  const files: Record<string, string> = {
    "package.json": packageJson(projectName, selection),
    "tsconfig.json": tsconfig(selection),
    ".gitignore": text`
      node_modules/
      dist/
      coverage/
      reports/
      .stryker-tmp/
      .DS_Store
    `,
    "README.md": projectReadme(projectName, selection),
    ".agent-stack/manifest.json": manifest(selection),
  };

  if (has(selection, "vite-react")) {
    Object.assign(files, viteReactFiles(selection));
  } else {
    files["tsconfig.build.json"] = json({
      extends: "./tsconfig.json",
      compilerOptions: {
        outDir: "dist",
        rootDir: "src",
        declaration: true,
        sourceMap: true,
        types: ["node"],
      },
      include: ["src/**/*.ts"],
    });
    files["src/index.ts"] = sourceEntryPoint();
  }

  if (selection.mode === "preset") {
    files[".agent-stack/shipping-gates.json"] = shippingGatePolicy(selection);
  }

  if (has(selection, "oxlint")) {
    files["oxlint.config.ts"] = oxlintConfig(selection);
    if (has(selection, "anti-slop") && !has(selection, "ultracite")) {
      Object.assign(files, antiSlopAssets);
    }
  }
  if (has(selection, "eslint")) {
    files["eslint.config.mjs"] = eslintConfig(selection);
  }
  if (has(selection, "vitest")) {
    files["vitest.config.ts"] = vitestConfig(selection);
    files["tests/index.test.ts"] = exampleTest(selection);
  }
  if (has(selection, "mutation-testing")) {
    files["stryker.config.mjs"] = strykerConfig();
  }
  if (has(selection, "github-actions")) {
    files[".github/workflows/ci.yml"] = githubWorkflow(selection);
  }
  if (has(selection, "gitleaks")) {
    files[".gitleaks.toml"] = text`
      title = "${projectName} gitleaks configuration"

      [extend]
      useDefault = true
    `;
  }
  if (has(selection, "agent-context")) {
    Object.assign(files, agentContextFiles(selection));
  }

  return files;
}

function packageJson(projectName: string, selection: FeatureSelection): string {
  const viteReact = has(selection, "vite-react");
  const scripts: Record<string, string> = viteReact
    ? {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
        typecheck: "tsc --noEmit",
      }
    : {
        dev: "tsx watch src/index.ts",
        build: "tsc -p tsconfig.build.json",
        typecheck: "tsc --noEmit",
      };
  const dependencies: Record<string, string> = viteReact
    ? { react: "^19.0.0", "react-dom": "^19.0.0" }
    : {};
  const devDependencies: Record<string, string> = {
    "@types/node": "^22.15.30",
    typescript: "^5.8.3",
  };
  if (!viteReact) devDependencies.tsx = "^4.20.3";
  const checks: string[] = [];
  const lintCommands: string[] = [];
  const lintTargets = [
    "src",
    ...(has(selection, "vitest") ? ["tests"] : []),
    ...(viteReact ? ["vite.config.ts"] : []),
  ].join(" ");

  if (viteReact) {
    Object.assign(devDependencies, {
      "@types/react": "^19.0.0",
      "@types/react-dom": "^19.0.0",
      "@vitejs/plugin-react": "^6.1.0",
      vite: "^8.0.0",
    });
    if (has(selection, "react-compiler-babel")) {
      Object.assign(devDependencies, {
        "@babel/core": "^7.29.0",
        "@rolldown/plugin-babel": "^0.2.4",
        "babel-plugin-react-compiler": "^1.0.0",
      });
    }
    if (has(selection, "react-compiler-oxc")) {
      devDependencies["oxc-transform-react"] = "^0.145.0";
    }
  }
  if (has(selection, "oxfmt")) {
    scripts.format = "oxfmt .";
    scripts["format:check"] = "oxfmt --check .";
    devDependencies.oxfmt = "^0.16.0";
    checks.push(packageScriptCommand(selection.packageManager, "format:check"));
  }
  if (has(selection, "oxlint")) {
    devDependencies.oxlint = "^1.81.0";
    lintCommands.push(has(selection, "eslint") ? `oxlint ${lintTargets}` : "oxlint .");
  }
  if (has(selection, "eslint")) {
    devDependencies.eslint = "^10.9.1";
    lintCommands.push(`eslint ${lintTargets}`);
    if (has(selection, "ultracite")) {
      Object.assign(devDependencies, eslintSupportDependencies);
    }
  }
  if (lintCommands.length > 0) {
    scripts.lint = lintCommands.join(" && ");
    checks.push(packageScriptCommand(selection.packageManager, "lint"));
  }
  if (has(selection, "anti-slop") && !has(selection, "ultracite")) {
    devDependencies["@oxlint/plugins"] = "1.81.0";
  }
  if (has(selection, "ultracite")) {
    devDependencies.ultracite = "^7.10.8";
  }

  checks.push(packageScriptCommand(selection.packageManager, "typecheck"));
  if (viteReact) checks.push(packageScriptCommand(selection.packageManager, "build"));

  if (has(selection, "vitest")) {
    scripts.test = "vitest run";
    devDependencies.vitest = viteReact ? "^4.1.0" : "^3.2.2";
    checks.push(packageScriptCommand(selection.packageManager, "test"));
  }
  if (has(selection, "property-testing")) {
    devDependencies["@fast-check/vitest"] = "^0.3.0";
    devDependencies["fast-check"] = "^4.9.0";
  }
  if (has(selection, "mutation-testing")) {
    scripts.mutation = "stryker run";
    devDependencies["@stryker-mutator/core"] = "^10.0.0";
    devDependencies["@stryker-mutator/vitest-runner"] = "^10.0.0";
  }
  scripts.check = checks.join(" && ");

  const packageContents: Record<string, unknown> = {
    name: projectName,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts,
    engines: { node: viteReact ? ">=22.12" : ">=22" },
    packageManager: `${selection.packageManager}@${packageManagerVersions[selection.packageManager]}`,
    devDependencies,
  };
  if (viteReact) packageContents.dependencies = dependencies;
  return json(packageContents);
}

function tsconfig(selection: FeatureSelection): string {
  const viteReact = has(selection, "vite-react");
  const include = viteReact ? ["src/**/*.ts", "src/**/*.tsx", "vite.config.ts"] : ["src/**/*.ts"];
  const types = viteReact ? ["node", "vite/client"] : ["node"];
  if (has(selection, "vitest")) {
    include.push("tests/**/*.ts");
    types.push("vitest/globals");
  }

  return json({
    compilerOptions: {
      target: "ES2023",
      module: viteReact ? "ESNext" : "NodeNext",
      moduleResolution: viteReact ? "Bundler" : "NodeNext",
      jsx: viteReact ? "react-jsx" : undefined,
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      types,
      skipLibCheck: true,
    },
    include,
  });
}

function sourceEntryPoint(): string {
  return text`
    export const greet = (name: string): string => {
      const normalizedName = name.trim();
      if (normalizedName.length === 0) {
        throw new Error("A non-empty name is required to create a greeting.");
      }
      return \`Hello, \${normalizedName}!\`;
    };

    if (
      process.argv[1]?.endsWith("index.ts") === true ||
      process.argv[1]?.endsWith("index.js") === true
    ) {
      process.stdout.write(\`\${greet("agent")}\\n\`);
    }
  `;
}

function viteReactFiles(selection: FeatureSelection): Readonly<Record<string, string>> {
  return {
    "index.html": text`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>React app</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" src="/src/main.tsx"></script>
        </body>
      </html>
    `,
    "src/App.tsx": text`
      import { useState } from "react";

      export function App() {
        const [count, setCount] = useState(0);

        return (
          <main>
            <h1>Vite + React</h1>
            <button onClick={() => setCount((current) => current + 1)}>
              Count is {count}
            </button>
          </main>
        );
      }
    `,
    "src/main.tsx": text`
      import { StrictMode } from "react";
      import { createRoot } from "react-dom/client";

      import { App } from "./App";

      const container = document.getElementById("root");
      if (container === null) throw new Error("The app root element is missing.");

      createRoot(container).render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    `,
    "vite.config.ts": viteConfig(selection),
  };
}

function viteConfig(selection: FeatureSelection): string {
  if (has(selection, "react-compiler-babel")) {
    return text`
      import { defineConfig } from "vite";
      import react, { reactCompilerPreset } from "@vitejs/plugin-react";
      import babel from "@rolldown/plugin-babel";

      export default defineConfig({
        plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
      });
    `;
  }

  if (has(selection, "react-compiler-oxc")) {
    return text`
      import { defineConfig } from "vite";
      import react from "@vitejs/plugin-react";

      export default defineConfig({
        plugins: [react({ compiler: true })],
      });
    `;
  }

  return text`
    import { defineConfig } from "vite";
    import react from "@vitejs/plugin-react";

    export default defineConfig({
      plugins: [react()],
    });
  `;
}

function eslintConfig(selection: FeatureSelection): string {
  if (!has(selection, "ultracite")) return "export default [];\n";

  return ['import core from "ultracite/eslint/core";', "", "export default core;", ""].join("\n");
}

function oxlintConfig(selection: FeatureSelection): string {
  const imports = [
    'import { defineConfig } from "oxlint";',
    has(selection, "ultracite") ? 'import core from "ultracite/oxlint/core";' : "",
    has(selection, "ultracite") && has(selection, "anti-slop")
      ? 'import antislop from "ultracite/oxlint/anti-slop";'
      : "",
  ].filter(Boolean);

  if (has(selection, "ultracite")) {
    const extendsValue = has(selection, "anti-slop") ? "core, antislop" : "core";
    return [
      ...imports,
      "",
      "export default defineConfig({",
      `  extends: [${extendsValue}],`,
      "  ignorePatterns: core.ignorePatterns,",
      "});",
      "",
    ].join("\n");
  }

  const plugins = [
    has(selection, "anti-slop")
      ? [
          "    {",
          '      name: "anti-slop",',
          '      specifier: "./tools/oxlint/anti-slop/index.ts",',
          "    },",
        ]
      : [],
    has(selection, "anti-slop-effect")
      ? [
          "    {",
          '      name: "anti-slop-effect",',
          '      specifier: "./tools/oxlint/anti-slop/effect/index.ts",',
          "    },",
        ]
      : [],
  ].flat();

  if (plugins.length === 0) return `${imports.join("\n")}\n\nexport default defineConfig({});\n`;

  return [
    ...imports,
    "",
    "export default defineConfig({",
    "  jsPlugins: [",
    ...plugins,
    "  ],",
    "});",
    "",
  ].join("\n");
}

function vitestConfig(selection: FeatureSelection): string {
  if (has(selection, "vite-react")) {
    return text`
      import { defineConfig, mergeConfig } from "vitest/config";
      import viteConfig from "./vite.config.ts";

      export default mergeConfig(
        viteConfig,
        defineConfig({
          test: {
            include: ["tests/**/*.test.ts"],
          },
        }),
      );
    `;
  }

  return text`
    import { defineConfig } from "vitest/config";

    export default defineConfig({
      test: {
        include: ["tests/**/*.test.ts"],
      },
    });
  `;
}

function strykerConfig(): string {
  return text`
    export default {
      mutate: ["src/**/*.ts"],
      plugins: ["@stryker-mutator/vitest-runner"],
      reporters: ["clear-text", "html"],
      testRunner: "vitest",
    };
  `;
}

function exampleTest(selection: FeatureSelection): string {
  if (has(selection, "vite-react")) {
    return text`
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { describe, expect, it } from "vitest";

      import { App } from "../src/App";

      describe("App", () => {
        it("renders the starter heading and count button", () => {
          const markup = renderToStaticMarkup(createElement(App));
          expect(markup).toContain("<h1>Vite + React</h1>");
          expect(markup).toContain("Count is 0");
        });
      });
    `;
  }

  return text`
    import { describe, expect, it } from "vitest";

    import { greet } from "../src/index.js";

    describe("greet", () => {
      it("creates a greeting for a named recipient", () => {
        expect(
          greet("developer"),
          "Expected greet(name) to preserve the supplied recipient in the greeting.",
        ).toBe("Hello, developer!");
      });

      it("explains why an empty recipient is invalid", () => {
        expect(() => greet("   ")).toThrow("A non-empty name is required to create a greeting.");
      });
    });
  `;
}

function githubWorkflow(selection: FeatureSelection): string {
  const packageManagerSetup =
    selection.packageManager === "pnpm"
      ? [
          "      - uses: pnpm/action-setup@v4",
          "        with:",
          "          version: 10.11.0",
          "      - uses: actions/setup-node@v4",
          "        with:",
          "          node-version: 22",
          "          cache: pnpm",
        ]
      : ["      - uses: oven-sh/setup-bun@v2", "        with:", "          bun-version: 1.3.14"];
  const lines = [
    "name: CI",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches: [main]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  verify:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          fetch-depth: 0",
    ...packageManagerSetup,
    `      - run: ${selection.packageManager} install --frozen-lockfile`,
    `      - run: ${selection.packageManager} check`,
  ];
  if (has(selection, "dependency-audit")) {
    lines.push(`      - run: ${selection.packageManager} audit --audit-level high`);
  }
  if (has(selection, "gitleaks")) {
    lines.push(
      "      - uses: gitleaks/gitleaks-action@v2",
      "        env:",
      "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    );
  }
  return `${lines.join("\n")}\n`;
}

function shippingGatePolicy(selection: Extract<FeatureSelection, { mode: "preset" }>): string {
  return json({ gates: shippingGates(selection) });
}

function projectReadme(projectName: string, selection: FeatureSelection): string {
  const viteReact = has(selection, "vite-react");
  const runScript = (script: string): string =>
    packageScriptCommand(selection.packageManager, script);
  const origin =
    selection.mode === "preset"
      ? `the ${selection.preset[0]?.toUpperCase()}${selection.preset.slice(1)} preset`
      : "individually selected features";
  const commands = [
    viteReact
      ? `- \`${runScript("dev")}\` — start the Vite development server.`
      : `- \`${runScript("dev")}\` — run the entry point in watch mode.`,
    viteReact
      ? `- \`${runScript("build")}\` — create the production browser bundle.`
      : `- \`${runScript("build")}\` — compile production output.`,
    viteReact ? `- \`${runScript("preview")}\` — preview the production bundle.` : "",
    has(selection, "vitest") ? `- \`${runScript("test")}\` — run unit tests.` : "",
    has(selection, "mutation-testing")
      ? `- \`${runScript("mutation")}\` — run Stryker mutation tests.`
      : "",
    `- \`${runScript("check")}\` — run every configured project check.`,
  ]
    .filter(Boolean)
    .join("\n");

  return text`
    # ${projectName}

    This project was generated by create-agent-stack with ${origin}.

    ## Requirements

    - Node.js ${viteReact ? "22.12 or newer" : "22 or newer"}
    - ${selection.packageManager} ${packageManagerVersions[selection.packageManager]}

    ## Selected features

    ${selection.features.map((feature) => `- \`${feature}\``).join("\n")}

    ## Commands

    ${commands}

    ## Shipping policy

    ${selection.mode === "preset" ? `This project uses the ${selection.preset} shipping preset. Review \`.agent-stack/shipping-gates.json\` before declaring a change shippable.` : "Select a shipping preset when the project needs a defined release gate."}
    ${selection.mode === "preset" && selection.preset === "medium" ? "Medium is the default recommendation for production projects." : ""}

    Add capabilities progressively and record each addition in \`.agent-stack/manifest.json\`.
  `;
}

function agentContextFiles(selection: FeatureSelection): Readonly<Record<string, string>> {
  return {
    "AGENTS.md": text`
      # Agent instructions

      1. Read \`README.md\`, \`docs/GLOSSARY.md\`, and \`.agent-stack/progress.json\` before changing code.
      2. Work on one feature at a time and leave the repository in a passing state.
      3. Run \`${selection.packageManager} check\` before declaring work complete.
      4. Update documentation and progress records when behavior, boundaries, or invariants change.
      5. Never weaken or remove a failing check merely to make it pass.
    `,
    "docs/GLOSSARY.md": text`
      # Glossary

      - **Agent stack:** The selected tools and project artifacts that constrain and guide coding agents.
      - **Feature:** One independently verifiable capability installed by the scaffolder.
      - **Project check:** The aggregate \`${selection.packageManager} check\` command that must pass before work is complete.
      - **Progress manifest:** The structured record used to continue work across agent sessions.
    `,
    ".agent-stack/progress.json": json({
      schemaVersion: 1,
      currentMilestone: "project-generated",
      completed: ["project-generated"],
      next: "Define the first product feature before adding implementation code.",
    }),
  };
}

function manifest(selection: FeatureSelection): string {
  if (selection.mode === "preset") {
    return json({
      schemaVersion: 1,
      initialPreset: selection.preset,
      packageManager: selection.packageManager,
      features: selection.features,
    });
  }

  return json({
    schemaVersion: 1,
    packageManager: selection.packageManager,
    selection: {
      mode: "features",
      requested: selection.requested,
      resolved: selection.features,
      ...(selection.omitted.length > 0 ? { omitted: selection.omitted } : {}),
    },
    features: selection.features,
  });
}

function has(selection: FeatureSelection, feature: FeatureId): boolean {
  return selection.features.includes(feature);
}

function packageScriptCommand(packageManager: PackageManager, script: string): string {
  return packageManager === "bun" ? `bun run ${script}` : `pnpm ${script}`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function text(strings: TemplateStringsArray, ...values: readonly unknown[]): string {
  const raw = String.raw({ raw: strings }, ...values);
  const lines = raw.replace(/^\n/, "").split("\n");
  const indentation = Math.min(
    ...lines
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^\s*/)?.[0].length ?? 0),
  );
  return `${lines
    .map((line) => line.slice(indentation))
    .join("\n")
    .trimEnd()}\n`;
}
