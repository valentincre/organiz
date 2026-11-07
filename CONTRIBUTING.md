# Contributing

Thanks for your interest in Organiz. Bug reports, ideas and pull requests are welcome.

## Set up

Requires Node 24 (see `.nvmrc`) and Java 21 (for the Firestore emulator).

```sh
npm install
npm run emulators    # local Firestore emulator on port 8180
npm run dev:emu      # app against the emulator, http://localhost:5173
```

The emulator needs no Firebase account and no `.env.local`. To run against a real Firebase project, copy `.env.example` to `.env.local` and fill it in (see the README).

## Scripts

- `npm test`: unit tests.
- `npm run test:emulator`: security rules and storage tests (starts the emulator).
- `npm run typecheck`: TypeScript.
- `npm run lint`: oxlint.
- `npm run build`: production build (needs the variables of `.env.example`).

## Workflow

1. Create a branch and make your change.
2. Open a pull request against `main`.
3. The CI must pass: typecheck, lint, unit tests, emulator tests and a build.
4. The pull request is squash merged. Its title becomes the commit message.

## Pull request titles

The title must follow [Conventional Commits](https://www.conventionalcommits.org): `type: short description`.

| Type | Release |
|---|---|
| `feat` | minor version |
| `fix`, `perf` | patch version |
| `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert` | none |

Every merge to `main` deploys the official instance. Only `feat`, `fix` and `perf` publish a GitHub Release.

While the version is 0.x, a breaking change bumps the minor version instead of the major one (rule in `.releaserc.json`, to be removed when moving to 1.0.0).

A breaking change adds `!` after the type (`feat!: ...`) and a `BREAKING CHANGE:` paragraph in the pull request body. This is required for any change to the data format or to the Firestore rules, because existing dashboards and self-hosted instances depend on them.

## Style

- TypeScript. Keep `npm run lint` and `npm run typecheck` clean.
- Code comments and docs are in English.
- User-facing text goes in both `src/i18n/en.ts` and `src/i18n/fr.ts`.
- Keep changes small and focused.

## Tests

Add or update tests with your change. Logic goes in unit tests. Anything that touches the security rules or what is stored in Firestore needs an emulator test.

## License of contributions

Organiz is licensed under AGPL-3.0-or-later. By submitting a contribution, you agree that it is licensed under the same terms.
