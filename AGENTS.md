# Agent instructions

1. Read `README.md`, `features/create-minimum-project.feature`, `src/catalog.ts`, and `src/project-template.ts` before changing generation behavior.
2. Treat approved Gherkin scenarios as the observable product contract.
3. Add capabilities through the feature catalog and composable project template rather than creating independent preset templates.
4. Keep `--preset minimum` as the complete Minimum setup; omitting `--preset` must select individual optional features.
5. Work on one feature at a time and leave both this repository and generated fixtures passing.
6. Run `bun run check` before declaring work complete.
