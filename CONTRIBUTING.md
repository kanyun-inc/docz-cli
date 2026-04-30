# Contributing

Thanks for contributing to docz-cli! This doc covers how to develop, open PRs, and ship a release.

## Getting Started

```bash
git clone https://github.com/kanyun-inc/docz-cli.git
cd docz-cli
pnpm install

# Verify your setup
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# Try the CLI locally
node dist/index.js --help
```

Requires Node.js >= 22 and pnpm.

## Development Workflow

### 1. Branch off main

```bash
git checkout -b feature-<short-name>   # new feature
git checkout -b fix-<short-name>       # bug fix
```

`feature-*` branches also support beta pre-releases (see below).

### 2. Code + tests

For every exported function: happy path + at least one edge case. Run `pnpm test` as you go, not at the end.

### 3. Pre-commit check

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four green before you commit. CI re-runs them anyway.

### 4. Add a changeset

**Required — skip this and your change won't trigger a release.**

```bash
pnpm changeset
```

Pick:
- Bump type:
  - `patch` — bug fix, small tweak (0.7.0 → 0.7.1)
  - `minor` — new command, new MCP tool, new feature (0.7.0 → 0.8.0)
  - `major` — breaking change (0.7.0 → 1.0.0)
- Summary: one line for CHANGELOG, written for end users.

A `.changeset/<random-name>.md` is generated — **commit it as part of your PR**.

**When you can skip the changeset:**

- README / docs-only changes
- Pure internal refactors (no behavior change)
- Test-only changes
- CI / lint config

**When in doubt: a `patch` changeset is the safe choice.**

### 5. Open the PR

```bash
gh pr create
```

Merging into `main` triggers the release flow below.

## Release Flow

docz-cli uses [changesets](https://github.com/changesets/changesets) + GitHub Actions. **You don't edit `package.json` version, don't `git tag`, don't `npm publish`.**

### Stable (main branch)

```
Your PR (with a changeset)
   │
   ▼ merged to main
Release workflow runs
   │
   ▼ aggregates all .changeset/*.md
Opens a "chore: version packages" PR
   │ contents: bump version, update CHANGELOG.md, delete consumed changesets
   ▼ maintainer reviews and merges
Automatic npm publish + git tag + GitHub Release
```

### Beta pre-release (feature-* branches)

For early-access releases before merging to `main`:

```bash
# 1. Enter pre-release mode
pnpm changeset pre enter beta
git add .changeset/pre.json
git commit -m "chore: enter beta pre-release mode"

# 2. Code + changeset
pnpm changeset

# 3. Push to your feature-xxx branch
git push

# CI auto-publishes docz-cli@beta
# Users can try it via: npm i docz-cli@beta

# 4. Exit pre-release mode (before merging to main)
pnpm changeset pre exit
git add .changeset/pre.json
git commit -m "chore: exit beta pre-release mode"
```

## Code Style

- **TypeScript** strict mode — `pnpm typecheck` must pass
- **Biome** for lint + formatting — `pnpm lint:fix` auto-applies
- **Vitest** for unit tests
- **tsup** for bundling (ESM only, Node 22 target)

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(share): add --expires flag
fix(cat): handle short URL with trailing slash
docs: clarify MCP setup
chore: bump dependencies
```

Chinese is fine in the body — keep the prefix in English.

## FAQ

### PR CI fails with "add a changeset"

You skipped `pnpm changeset`. Run it locally, commit the generated file, push.

### `pnpm install --frozen-lockfile` fails

Lockfile drifted. Run `pnpm install` locally and commit `pnpm-lock.yaml`.

### Release workflow fails on `NPM_TOKEN`

Maintainer needs to set an npm automation token in repo secrets. Contributors don't need to worry about it.

### I want to preview the release locally

```bash
# See what bump the current changesets would produce (no file changes)
pnpm changeset status

# Rehearse the version step — edits package.json and CHANGELOG; git checkout . to revert
pnpm changeset version

# Do NOT run `pnpm release` locally — it publishes to npm for real.
```

## Questions?

Open an issue: https://github.com/kanyun-inc/docz-cli/issues
