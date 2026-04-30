---
"docz-cli": patch
---

chore: automate release pipeline via changesets + GitHub Actions

Pushes to `main` now open a "chore: version packages" PR that bumps the version and updates `CHANGELOG.md`; merging that PR triggers `npm publish`, git tag, and GitHub Release. See README "Release" section for the contributor workflow.
