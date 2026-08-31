# create-agent-stack

`create-agent-stack` progressively scaffolds verified, agent-ready TypeScript projects.
The first milestone supports the Minimum preset.

## Development

- `bun install` — install repository dependencies.
- `bun run dev` — run the interactive CLI from source.
- `bun run check` — run every local and acceptance check.

## Current usage

1. Build with `bun run build`.
2. Run `node dist/cli.js my-project --preset minimum`.
3. Enter the generated directory, install dependencies, and run `pnpm check`.

The intended published command is `pnpm create agent-stack my-project`.

## Automatic releases

Release Please turns Conventional Commits on `main` into a release pull request. Merging that pull request updates `package.json` and `CHANGELOG.md`, creates the GitHub release and tag, then publishes `create-agent-stack` to npm after `bun run check` passes.

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
