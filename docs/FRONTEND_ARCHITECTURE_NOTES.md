# Frontend Architecture Notes

Durable architecture rules for `pagedraft-client` that are load-bearing enough to survive a
refactor and to warn a future contributor before they re-introduce a bug this codebase already
paid for. Add to this file rather than a per-machine tool config, so the notes ship with the repo
and are visible on a fresh clone.

## JobRegistryService — the single owner of async job progress

`core/services/job-registry.service.ts`, root-provided singleton. It is the ONLY thing in the
client that turns a poll response into a percent: it wraps `AnalysisProgressService` (+ the
summary/review/style-baseline status services) and normalizes every backend progress shape into
one `TrackedJob` view model with a clamped 0-100 `percent`, a single-finalize guarantee (a job
resolves to a terminal state exactly once), per-job poll teardown, and a reattach seam that
survives browser refresh. `jobById$(id)` observes one specific tracked job; `jobs$` /
`jobByKindForBook$` cover the rest.

**Single-owner rule:** for the PERCENT specifically, every surface that shows a running job's
progress (a dialog, an in-page indicator, the Activity Center row) must be a pure view over
`JobRegistryService` - subscribe to `jobs$` / `jobById$`, never re-derive or re-clamp the percent,
never poll independently for one. This is a repeat lesson: the `analyze-progress-popup` work
(2026-08-03) found and deleted a SECOND owner - the editor's full-screen `.analysis-overlay`, fed
by `AnalysisPanelComponent`'s `(analysisStatus)` / `(analysisProgressPercent)` outputs off the
orchestration service's own progress poll. It had its own reconciliation rule (force-monotonic
`Math.max(previous, next)`), so it silently disagreed with the registry whenever a chunk-total
revision moved the real percent DOWN. All three progress surfaces (the run dialog, the analysis
panel's in-page async banner via `shared/job-progress-inline/`, and the Activity Center) now
derive from the registry - do not add a fourth path that reads `AnalysisRunEvent`'s raw
`'progress'` events for a percent.

**The same rule now covers the chunk COUNTS and the elapsed clock (c04, 2026-08-03), and it has to.**
`TrackedJob` carries `completedChunks` / `totalChunks` (raw, not re-derived) plus a per-JOB
`chunkClock`, and every surface that shows a count reads those fields. Four consequences a future
change must preserve:

- **`totalChunks === null` IS the "no counts" test.** The registry maps a non-positive backend total to
  null on purpose, so no surface re-derives "do we have a chunk shape?" and gets it subtly different
  (and so nothing can render "0 of 0").
- **The counts may be presented differently, but never differently VALUED.** The run dialog spells out a
  localized sentence ("3 of 10 completed"), the Activity Center row and the in-page indicator show a
  compact language-neutral "3/10". `three-surface-parity.spec.ts` extracts the integer PAIR from
  whatever each surface renders and compares the pairs, so a smaller treatment stays legal and a
  different number does not.
- **WHICH KINDS render counts is a decided list, not "whatever the wire sent" (c02, 2026-08-03).**
  `totalChunks` is one wire field with a DIFFERENT unit per producer: text chunks of the chapter for
  `proofread` (`UnifiedAnalysisService`), CHAPTERS of the book for `summary` (`BookSummaryService`) and
  `style-baseline` (`StyleBaselineService`), and for `review` (`BookReviewService`) map-reduce WINDOWS
  plus one synthesis pass plus a variable, plan-dependent number of continuity passes (the legacy
  per-dimension branch reports dimensions into the same field). None of the three surfaces carries a
  unit label, so `showsChunkCounts(job)` in `job-registry.service.ts` gates on
  `CHUNK_COUNT_KINDS` - proofread / whole-book-analysis / summary / style-baseline show the bare pair
  (their denominators are units the run's own scope names), `review` does not, because a bare `3/10` on
  a 40-chapter book reads as chapters and is wrong by a factor of four. All three surfaces call that ONE
  predicate; none re-tests `totalChunks !== null` locally. A NEW JobKind is absent from the set and
  renders no counts until someone states its unit there - the safe default, since the defect this rule
  fixes was a reader that rendered any number the registry happened to carry.
- **The elapsed clock is per JOB, never per component.** `TrackedJob.chunkClock` is stamped once, by the
  registry, and the time-remaining estimate is a pure function of it (`core/utils/chunk-eta.ts`). A
  component that measured its own mount time would show a different estimate on a dialog re-opened after
  a minimize than on the Activity Center row beside it. A job discovered by the REATTACH seam gets an
  empty clock (the run began before this tab existed), so it shows counts and NO estimate rather than a
  confidently wrong one.

**Known duplicate poll (not a percent owner, so not a rule violation):**
`AnalysisRunOrchestrationService.startProgressPollingForJob`
(`core/services/analysis-run-orchestration.service.ts`) still runs its own
`AnalysisProgressService.pollProgress(bookId, chapterId, jobId, stop$)` against
`analysis-progress/{jobId}` for every async analysis run, CONCURRENTLY with `JobRegistryService`'s
own poll of the very same job id, started when `AnalysisPanelComponent.handleRunEvent`'s
`'job-started'` case calls `jobRegistry.track('proofread', ...)`. Two pollers hit the same
endpoint for the same job. It survives because the orchestration stream still owns two things the
registry does not expose today: it is the only place that detects `failed` / `canceled` for the
analysis panel's own `runError` / `isRunning` state (`handleRunEvent`'s `'progress'` case reads
only `rawStatus`, never `percent`), and it is the only path that fetches the finished
`AnalysisResult` and emits it as `'job-result'` (`loadFinalResultForJob`, via
`AnalysisService.getByJob`) once the job succeeds. Collapsing the two pollers means re-homing both
of those onto the registry first: give `TrackedJob` a terminal-status signal the panel can
subscribe to instead of reading `'progress'` / `'error'` off the orchestration stream, and either
have the registry fetch and expose the final result itself or have the panel fetch it once
`jobById$` reports `succeeded`. Until that happens this is a documented duplicate read, not an
invisible one.

**The run LIFECYCLE travels on ONE channel too, and it is not the registry.** The registry owns the
percent, but it only knows about a run once a `'job-started'` produced a trackable job id. Before that
(and for a whole sync run, which never gets one) the only thing a host surface has is
`AnalysisPanelComponent`'s `(runEvent)` output: the `AnalysisRunEvent` stream, minus `'streaming-token'`.

That channel is NOT a byte-for-byte copy of the orchestration stream, and two of its members exist only
on it - the panel emits them, no observable in `AnalysisRunOrchestrationService` ever produces either:

- `{ kind: 'run-finished' }` is the run's TERMINAL. The panel emits it from `onRunFinished()` and from
  its own `ngOnDestroy` while a run is in flight.
- `{ kind: 'result-dropped' }` REPLACES a `'sync-result'` / `'job-result'` whose captured origin no
  longer matches the chapter/scene on screen when it lands. The panel discards such a result rather than
  injecting a prior chapter's suggestions and offsets into the document now open, so the raw success must
  not reach a host surface either: the run dialog would latch "Done" at 100% for suggestions that were
  shown nowhere (an untracked sync run has no Activity Center row and no in-page banner). The origin
  question is asked exactly once, by `resultBelongsToRunOrigin`, and both the fan-out and the panel's own
  apply/drop branch read that one predicate.

Because the channel is `void`-switched at both ends, the compiler does not enforce that a consumer
answers a new member: `switch (event.kind)` over a union in a `void` method is legal with cases missing.
Adding either member above was therefore not a compile error anywhere. Both switches
(`AnalysisPanelComponent.handleRunEvent`, `AnalysisRunDialogComponent.onRunEvent`) now end in a
`default:` arm calling `assertUnhandledRunEvent(event: never)`, so the NEXT member does fail the build
until each consumer decides what to do with it, including deciding explicitly to ignore it.

Two rules follow, and both were paid for once already:

- **Do not add a second lifecycle output.** `analysisCompleted` and `asyncJobStarted` were exactly that.
  When the blocking overlay was deleted their last consumer went with it, and `analysisCompleted` was
  the run terminal, so a run that ended without one of the orchestration service's own terminal events
  (`sync-result` / `job-result` / `streaming-complete` / `error`) told the host nothing. The panel is
  `@if`-mounted in the editor and the run dialog is not, so a sub-tab switch destroyed the panel,
  cancelled the run, and left the dialog on "Starting..." forever. Deleted in the c01 fix; the terminal
  lives on `runEvent`.
- **A consumer of `run-finished` must be single-resolve and must not use it for a TRACKED job.** On a
  normal run it arrives AFTER the real terminal event. And a registry-tracked job keeps running
  server-side after the panel goes away, which is the whole point of the minimize gesture, so
  `AnalysisRunDialogComponent` fences its `run-finished` handling (and every other `(a) -> (c)` arm) and
  leaves state (b) to resolve off the registry alone.

  **The fence is state (b) itself, NOT "a jobId was captured" (c03, 2026-08-04).** Those two are not the
  same predicate, and the gap between them is reachable. `AnalysisPanelComponent.handleRunEvent` fans
  `'job-started'` out to the host - which is what makes the dialog capture the id - and only AFTERWARDS
  calls `jobRegistry.track(...)`, behind a guard. Meanwhile the c01 start budget has already been
  cancelled, because `provesServerAnswered` returns true for `'job-started'`. So a guard that declines
  leaves the dialog holding an id with no registry row: state (a), modal and indeterminate, budget spent,
  and - on the old `jobId === null` fence - every terminal latch switched off, with nothing left that
  could resolve it. The dialog's `registryOwnsRun` (`jobId !== null && trackedJob !== null`) is now the
  single predicate behind the `'tracked'` arm of `state`, all five fences in `onRunEvent` (the three
  `(a) -> (c)` latches on the result kinds / `error` / `run-finished`, plus `result-dropped`, which
  abandons the card rather than latching, plus the state-(a)-only `status` message), and the c02
  retraction predicate `supersedesExpiredStartBudget`. So "the registry owns this run's terminal" is
  literally what the code tests. Keep them one predicate: the class
  of bug here is two conditions that are assumed to be the same one. And note what the fix is NOT - no
  timer was added to the dialog (see the rule below); the escape arrives on the run stream it already
  reads. The panel's decline is also logged (`[AnalysisRun] job-started with no bookId`), because an
  untracked job produces no HTTP error to correlate against.

An @Output emitted from `ngOnDestroy` does reach the parent: Angular's `destroyViewTree` cleans child
views first and `cleanUpView` runs `executeOnDestroys` before `processCleanups`, so the parent's output
subscription is still live. That is why the unmount case needs no editor-side reconcile keyed on the
`@if` predicate, which would be a copy of a condition the next template change can falsify.

## The run dialog is modal only while the run is LIVE

`shared/analysis-run-dialog/` is a centred modal in states (a) `starting` and (b) `tracked`, and stops
being one at (c) `terminal`. That split is the whole rule, and it exists because the dialog deliberately
does NOT auto-close: a modal that persists until dismissed would leave the app unusable after a run
finished, including after a FAILED one. So at the terminal state the dialog drops its modality and the
card stays up as a dismissible notice.

Concretely, at the `(b) -> (c)` transition: the `.rd-backdrop` element is REMOVED (removed, not faded -
an invisible scrim keeps eating pointer events), every `inert` attribute the dialog added is removed,
the focus trap is released, focus is restored to whatever held it before the dialog opened, and
`aria-modal` flips to `false`. A card that no longer traps focus must not keep claiming that it does.

Six things a future change here must preserve:

- **`inert` alone does NOT hold focus here, and this was measured (c01, 2026-08-03).** With the modal
  fully engaged on :4201 - backdrop up, `aria-modal="true"`, 25 elements marked `inert` - the overlay
  took focus and roughly 55ms later Syncfusion took it back to its hidden text-target iframe, which sits
  INSIDE the inert subtree: `inert` does not propagate into a nested browsing context. From there
  neither the Escape binding nor the Tab cycle could fire (both are bound on `.rd-overlay`, and keydown
  bubbles from wherever focus actually is), so four real Tab presses moved focus nowhere and a real
  Escape did not dismiss. A one-shot `overlay.focus()` on open cannot survive that. `containFocusWithin`
  in `modal-a11y.ts` is the layer that does: document-level `focusin` **and** a deferred `focusout`
  re-read of `activeElement`, because a move that originates inside the child document raises no
  `focusin` in the parent at all - a `focusin`-only containment (what the CDK focus monitor gives) would
  never have fired for this defect. It is released FIRST inside `releaseModality`, before the focus
  restore, or the listener fights that restore and yanks focus back into a card on its way out. Do not
  reduce this to a focus-on-open, and do not reorder the release.
- **The release has more than one trigger.** It fires at the `(b) -> (c)` transition (from
  `ngAfterViewChecked` -> `syncModality`, because nothing the USER does drives that transition), at
  dismiss/minimize, when the HOST writes `open = false` (the editor's per-context reconcile does this on
  a book change), and on destroy. A release wired only to dismiss leaves a live focus trap inside a card
  whose `aria-modal` already says `false` - the specific bug this design can produce, and the reason
  `analysis-run-dialog.component.spec.ts` drives the transition itself rather than only the dismiss.
- **Background inertness is `inert` on siblings, not a click-eating scrim.** The dialog is declared
  inside the editor page rather than portalled to `document.body`, so `inert` cannot go on the app root:
  that is an ANCESTOR of the dialog. `shared/analysis-run-dialog/modal-a11y.ts` walks from the dialog
  HOST up to `<body>` and marks every sibling at each level (the CDK's containment strategy, with
  `inert` instead of `aria-hidden`). Anchor the walk on the HOST, not on the overlay: the backdrop is
  the overlay's sibling, and anchoring on the overlay marks the dialog's own scrim inert. A scrim alone
  would stop the mouse and do nothing about the keyboard, which matters here because the dialog sits
  over a Syncfusion DocumentEditor full of tabbable controls. `inert` is what stops pointer input and
  hides the background from assistive tech; it is NOT what holds the keyboard (see the bullet above),
  and the walk is a one-shot snapshot, so anything appended to the background after engage is never
  marked. Neither layer replaces the other.
- **Escape is bound on the overlay CONTAINER** (`tabindex="-1"`), not on `document` and not on
  `.rd-card`. On `document` it minimizes a card that never had focus, which is the defect the
  analyze-progress-popup fixes plan's `c04` removed and which is still reachable in the non-modal state
  (c). On `.rd-card` it drops the FIRST Escape of every modal run, because focus-on-open lands on the
  container, which is outside the card.
- **Every visible state must have a LABELLED escape, and the BOUND on state (a) does not live in the
  dialog.** The actions row has one branch per visible state and that is the invariant: (b) minimize,
  (a) close, (c) close. A state with no branch there is left with only the header `✕`, and an
  accessible name is treated here as necessary and NOT sufficient - the user who hit this reported "no
  button to dismiss" while an accessible-named `✕` was on screen. c01 applied that to (a) and left (c)
  bare; the P1-1 fix (2026-08-04) closed it, and (c) is the state where it matters most, because (a)
  and (b) resolve on their own while (c) persists until dismissed - an undiscovered glyph there leaves
  a card over the editor indefinitely, and the expiry copy c01 wrote literally ends "close this
  window". The terminal row carries NO hint: both hint strings promise a live run.

  State (a) needs a second thing on top of the labelled control, because it is modal, indeterminate and
  has no minimize (nothing is registry-tracked yet), so it is the one blocking state a user can be stuck
  in with no information. `AnalysisRunOrchestrationService.withStartTimeout` bounds how long a run may
  go without ANY answer from the server (180s, `runStartTimeoutMs`) and publishes the expiry as an
  ordinary `{ kind: 'error' }` event on the run stream, so the dialog's existing terminal latch fires and
  the release above happens through the one path it already had. Do not move that timer into the dialog:
  the dialog is a VIEW over `runEvents$` plus the registry, it runs no clock of its own, and `isModal`
  stays a projection of `state` rather than a second notion of "the run is over". The budget is cancelled
  by the first event that proves the server answered (everything except the client-composed `'status'`),
  so a slow-but-healthy run is never killed. Both layers are load-bearing: the labelled control is what
  the user reaches for, the budget is what rescues them when they never look.
- **A SYNC run is deliberately NOT registry-tracked, so state (a) offers a CLOSE and never a minimize
  (c02, 2026-08-03).** This is the rule most likely to be "fixed" by someone reading the state machine
  and concluding minimize was merely forgotten. It was not. A sub-threshold (single-chunk) analysis goes
  out as one blocking `/analyze` request and persists its result with a NULL `JobId` (verified in the
  database), so there is no `job-started` event, no `JobRegistryService.track()` call, no Activity Center
  row and no in-page indicator. The user asked for minimize on such a run directly; tracking it behind a
  client-minted synthetic id was costed and rejected on three facts. (1) It has no existence outside the
  mounted panel: `AnalysisPanelComponent.ngOnDestroy` unsubscribes the run and emits `run-finished`, so
  leaving the editor CANCELS it, while the Activity Center is app-level cross-book chrome whose promise
  is precisely that you can navigate away. (2) It can never be reattached, in this tab or after a
  refresh: no backend read can rediscover a run with no job row, and its work lives in an XHR a reload
  aborts. (3) `track()` unconditionally starts a poll, and polling an id the server never minted 404s
  into `finalize(jobId, 'failed')` - the same trap the dialog already documents about the sync response's
  own `result.jobId`. So minimize would have no destination, and `minimizeRequested` stays state-(b)-only:
  its one consumer, `EditorPageComponent.onRunDialogMinimize`, calls `flyToActivityCenter`
  unconditionally, so a widened emit would animate a card into an empty corner. What state (a) gets
  instead is the labelled close plus a WEAKER hint (`keepsRunningWhileOpen`, not state (b)'s
  unconditional `keepsRunning`): the card invites the user to close it and go elsewhere, so it must not
  promise a background survival the sync route cannot deliver. The decision is fenced in TWO places,
  and it needs both: `three-surface-parity.spec.ts` pins the RENDERED absence of all three surfaces,
  but its host drives the registry directly and never mounts the analysis panel, so it cannot see a
  synthetic `track()` added in production (measured - that change left it green); the production-source
  guard is in `analysis-panel.component.spec.ts` ("c02: a SYNC run (no job-started) is NEVER tracked").

## Activity Center bell direction

`ActivityCenterComponent` (`shared/activity-center/`) hardcodes its own direction, independent of
the book/document. It sets `appLang = 'he'` (no global i18n service exists yet) and binds
`[attr.dir]="'rtl'"` on its own host, so `.ac-bell` — pinned via `inset-inline-start` — always
resolves to the physical RIGHT, regardless of the current book's language or `document.body`'s
direction (which can legitimately be `ltr` for an English book). Found live in the browser during
`analyze-progress-popup` (2026-08-03): anything that needs to animate or position itself relative
to the bell must resolve direction from the Activity Center **host element**, never from
`document.body` or the book/document language. See
`src/app/shared/analysis-run-dialog/minimize-flight.ts` (`resolveBellSideDirection`) for the
pattern — it reads the host's own resolved `direction` and only falls back to the document when
the host is absent.

## Run chrome is client-composed, never backend prose

`src/app/core/i18n/run-strings.ts` is the single source of every user-facing string an analysis run
can put on screen. Two rules hold there, and both were paid for:

**1. The backend's progress `message` is diagnostic, not chrome.** `AnalysisProgressTracker` sends
English prose (`Running chunk 2/10`, `Proofread finished`, a raw `ex.Message` on a failure) and
`JobRegistryService` carries it on `TrackedJob.message`. NO surface renders it. The run dialog used
to, and a Hebrew book therefore showed `Running chunk 2/10` in RTL chrome next to a correctly
localized `בריצה` pill. The dialog now composes its detail line from the STRUCTURED progress fields
the same DTO already carries (`status` / `completedChunks` / `totalChunks` / `currentChunk`). If you
are about to bind `job.message` into a template: don't. The alternatives were considered and rejected
in the plan's `## c02 decision` (a server that emits localized prose puts UI copy in the API; a client
that pattern-matches the English prose is a parser over prose).

**2. There are TWO language sources and they stay separate.** The run dialog and the analysis panel
are BOOK-scoped (`bookLanguage`); the Activity Center is APP-level Hebrew-default. `runChromeLang()`
is the one normalization all of them share (`en*` gives English, everything else gives Hebrew), so the
orchestration service - which composes in the run's `ctx.language`, itself the panel's normalized
`bookLanguage` - cannot disagree with the surface that renders its output. Do not unify the two
sources; a book-scoped surface following the app language is a different bug.

The ONE deliberate exception is a `{ error: "..." }` body the API chose to send: it is the only
channel carrying WHY a request was rejected, so it is passed through verbatim. Localizing it needs a
server-side error-CODE contract.

Fences: `core/i18n/run-strings.spec.ts` (map parity, no em-dash, no English left in the Hebrew map)
and `shared/analysis-run-dialog/run-chrome-i18n.spec.ts` (the RENDERED DOM of all three progress
surfaces contains no Latin letters for a Hebrew book, while the backend is feeding English prose).
The second one exists because a map assertion cannot catch a surface that never reads the map.
