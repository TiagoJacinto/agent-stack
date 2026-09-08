# create-agent-stack

`create-agent-stack` progressively scaffolds verified, agent-ready TypeScript projects.
The preset ladder supports Minimum, Low, Medium, High, and Maximum, plus individual feature selection.

## Development

- `bun install` — install repository dependencies.
- `bun run dev` — run the interactive CLI from source.
- `bun run check` — run every local and acceptance check.

## Current usage

1. Build with `bun run build`.
2. Run `node dist/cli.js create my-project --preset <level>`, where `<level>` is `minimum`, `low`, `medium`, `high`, or `maximum`. Omit `--preset` to choose individual features interactively.
3. To add capabilities to an existing project, run `node dist/cli.js merge path/to/project --preset minimum` (or omit `--preset` to choose features interactively).
4. Enter the project directory, install dependencies with its selected package manager, and run its `check` script.

The published commands are `pnpm dlx @tiagojacinto/create-agent-stack create my-project` and `pnpm dlx @tiagojacinto/create-agent-stack merge path/to/project`.

When `--preset` is omitted, the CLI first lets you choose pnpm or Bun, then asks about each top-level optional feature: formatting, linting, ESLint, Ultracite, unit testing, agent context, GitHub Actions, secret scanning, dependency auditing, and mutation testing. Selecting Vitest reveals property-based testing, selecting Oxlint reveals Anti-slop, and selecting Anti-slop reveals Anti-slop Effect. Type `y` to include a feature. TypeScript, Node.js, the selected package manager, and the core scripts are always included. Selecting a feature also selects its dependencies; for example, secret scanning includes GitHub Actions and Anti-slop includes Oxlint.

If Ultracite is selected without a linter, the CLI asks which backend to add after the feature questions. Oxlint is the default. If Oxlint or ESLint was already selected, that choice becomes Ultracite's backend without another question. Selecting both generates both configurations. Oxlint and Ultracite use one composed `oxlint.config.ts` file. Anti-slop without Ultracite vendors the plugin under `tools/oxlint/anti-slop/`. If Ultracite and Anti-slop Effect are selected together, the CLI warns that the Effect extension is unsupported and asks for confirmation before continuing.

Every preset generates `.agent-stack/shipping-gates.json`, a cumulative release policy for coding agents. Minimum establishes the build, formatting, linting, type-checking, test, secret-scanning, dependency-audit, narrow-scope, and compute-budget floor. Medium is the default recommendation for production projects. High adds the available property-based and mutation-testing tooling; Maximum records the additional independent-review and high-assurance gates. The generated README directs agents to review this policy before declaring code shippable. The policy is currently declarative: see [ROADMAP.md](ROADMAP.md) for the implementation status and planned enforcement work.

The generated project records and uses the package manager selected during interactive scaffolding. Preset scaffolding currently uses pnpm.

Merge reconciles supported artifacts semantically: package scripts and dependencies by name, JSON configuration by key and array entry, linter imports and extensions, workflow triggers/jobs/steps, and Markdown inside `agent-stack` managed blocks. User-owned values are preserved; incompatible JSON values report the exact key and prevent all writes. Repeating the same merge is idempotent.

## Automatic releases

Release Please turns Conventional Commits on `main` into a release pull request. Merging that pull request updates `package.json` and `CHANGELOG.md`, creates the GitHub release and tag, then publishes `@tiagojacinto/create-agent-stack` to npm after `bun run check` passes.

Commit prefixes determine the version:

- `fix:` creates a patch release.
- `feat:` creates a minor release.
- `feat!:` or a `BREAKING CHANGE:` footer creates a major release.

Run the one-time setup wizard:

```bash
./scripts/setup-releases.sh
```

It connects the GitHub repository, guides the required Actions permissions, captures the npm token as a hidden value, writes it only to the GitHub secret `NPM_TOKEN`, and verifies release readiness. It never triggers a release itself.

The release workflow is `.github/workflows/release.yml`. A failed verification or publication step blocks the corresponding release stage and can be reproduced locally with `bun run check`.
