# docz-cli

## 0.7.1

### Patch Changes

- bfb5bc5: chore: automate release pipeline via changesets + GitHub Actions

  - Push to `main` opens a "chore: version packages" PR; merging it triggers `npm publish`, git tag, and GitHub Release.
  - `feature-*` branches support beta pre-releases when `.changeset/pre.json` tag is `beta`.
  - CI workflow gates PRs and main pushes on typecheck / lint / test / build.
  - See CONTRIBUTING.md for the full contributor flow.
