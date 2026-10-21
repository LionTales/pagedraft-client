---
extends: feature-review
---

# pagedraft-client overlay for feature-review

This repo is the PageDraft client side (Angular 18 SPA). Its contract partner is the server repo `../Pagedraft.Api-repo` (.NET 8), which has its own overlay.

## Workspace

- Repo: this checkout (Angular 18, Syncfusion DocumentEditor, RTL/Hebrew). Remote `LionTales/pagedraft-client`. PR base: `master` (the remote HEAD; `main` is a stub). The PageDraft root `..` is not a git repo.
- Plans: `.cursor/plans/` here and the workspace-level `../.cursor/plans/` (`_todo/` active, `_archive/` history only). Reviews: `.cursor/reviews/` of the primary repo (the one with the most pending changes, usually this one). `.cursor/` is gitignored here, so plans and reviews are workspace artifacts: never committed, never in `git status`.
- Tests: one spec `npx ng test --include <spec> --watch=false --browsers=ChromeHeadless`; full suite `npm run test:ci`. CI: job `Frontend tests` (`npm ci`, `npx ng test --no-watch --browsers=ChromeHeadless`) in `.github/workflows/ci.yml`. Dev server `npm start` on port 4200 (the proxy forwards `/api` and `/hubs`).
- Cross-stack: the API serializes camelCase and the client interfaces mirror the server DTOs; a contract change is reviewed in both repos. Review the server side from its own overlay.
- PageDraft has no mobile repo and no rendered-output (EPUB/DOCX/PDF) baseline fixtures.

## Lenses

1. **Syncfusion SFDT round trip**: it loses StyleIds and bakes header text into body paragraphs, so front matter and chapters are classified by content, never by position. Some Syncfusion output (the footnote separator) renders outside the model: confirm the render path reads the model before patching it. Load-time and per-keystroke edit are different code paths: test both.
2. **RTL/Hebrew**: alignment rule is RTL to left, LTR to center. Build a bidi state dump before guessing; verify Hebrew word order with the source or the user, not your own translation. Inline `code` needs `unicode-bidi: plaintext` (`isolate` does not work, the span inherits `direction: rtl`).
3. **Scoped CSS never reaches a node Angular did not create**: anything arriving via `[innerHTML]`, a CDK/portal overlay or a third-party widget's internals (Syncfusion) carries no content attribute, so a whole style block can be dead from the day it shipped. Confirm the style path reaches the node (compiled `selectorText`, the element's own attributes, `getComputedStyle` against the token); fixing a dead rule makes it live for every existing caller, so enumerate the callers.
4. **Suite bounded by its seed space**: when a change splits one predicate into two (chapters exist vs chapters have text), the state between the old poles is one no fixture holds. Seed that book and open the route. A newly reachable matrix cell takes its expectation from the rule the component claims (its docblock), never from running it.
5. **Render-driven acceptance** (RULE 0): a user-visible fix is done only when the page is re-produced under real params and inspected the way the user sees it; green specs or token presence are not proof. Assert intent (DOM structure), not a substring proxy.
6. **Page conventions**: timezone-aware dates (never raw `| date`); UTF-8 BOM on client CSV (Hebrew); buttons labelled and disabled properly; `[dir]` plus he/en i18n parity; no em-dash in user-facing text; RTL and narrow-viewport pass.
7. **A new persisted setting** needs the end-to-end checklist on the client side too: FE normalize and form control plus tests; the server half (entity, save-copy line, controller) is checked in `../Pagedraft.Api-repo`.
8. **AI results**: the model copies what the client renders and gets what it must derive wrong; chapter orders are 0-based on the wire and 1-based wherever a human reads (`chapterDisplayNumber`). A chip or label shown beside a model answer must use the human numbering.

## Review framework

- Repo files to read, by the area the diff touches: `README.md`, `docs/`, `src/app/core`, `src/app/features`.
- Contract reference lives in the workspace: `../docs/PAGEDRAFT_DESIGN.md` (API contracts, DTOs, SignalR events, config).
- No FormatBookWebApi `code-review-lessons` skill applies here. Use the kit's cross-stack review lenses and the kit's engineering lessons and validation discipline; PageDraft's defining bug class is the AI/LLM lens, not the formatting-pipeline or billing lenses.
