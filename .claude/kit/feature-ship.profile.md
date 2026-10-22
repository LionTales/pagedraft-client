---
extends: feature-ship
---

# pagedraft-client overlay for feature-ship

This repo is the PageDraft client side. Its contract partner is `../Pagedraft.Api-repo` (the server), which has its own profile.

## Workspace

- Repo: this checkout, remote `LionTales/pagedraft-client`, PR base `master` (`master` is the integration branch; `main` is a stub: trust the remote HEAD). The PageDraft root `..` is not a git repo.
- Branch: one FRESH branch per PR off `origin/master`, slug `<feature>` (the server's parallel slug is `api-<feature>`). Branch reuse was retired 2026-06-18.
- Plans: `.cursor/plans/` and the workspace-level `../.cursor/plans/`; reviews: top-level `docs/reviews/`, committed with the work. `.cursor/` is gitignored here, so plan artifacts are never staged and never show in `git status`.
- Tests: one spec `npx ng test --include <spec> --watch=false --browsers=ChromeHeadless`; full suite `npm run test:ci`. CI: job `Frontend tests` in `.github/workflows/ci.yml`. Discover the checks per PR with `gh pr checks <pr>`.
- Commit-message style: plain imperative, no conventional-commit prefix. No ticket convention is recorded for PageDraft: leave a tracker status alone.

## Commit batches

- Group by concern within the single PR so that each commit builds and passes its specs. Interfaces that mirror a server DTO change in the same commit as the code that uses them.
- The API serializes camelCase and the client interfaces mirror the server DTOs: when the feature spans both repos, the server PR ships first (it is the contract source of truth) and this PR second, cross-linked in the body ("Pairs with `Pagedraft.Api#<n>`").

## Ship pass

- Before the PR, re-check the page-convention items the diff touches: he/en i18n parity, `[dir]` and an RTL or narrow-viewport pass, timezone-aware dates, no em-dash in user-facing text.
- After the PR is green, run `review-retro` as the kit's feature-ship closes the cycle; one-off lessons go to memory, durable ones to the kit.
