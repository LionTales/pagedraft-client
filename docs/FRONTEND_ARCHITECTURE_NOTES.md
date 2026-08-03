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
  `AnalysisRunDialogComponent` guards its `run-finished` handling on `jobId === null` and leaves state
  (b) to resolve off the registry alone.

An @Output emitted from `ngOnDestroy` does reach the parent: Angular's `destroyViewTree` cleans child
views first and `cleanUpView` runs `executeOnDestroys` before `processCleanups`, so the parent's output
subscription is still live. That is why the unmount case needs no editor-side reconcile keyed on the
`@if` predicate, which would be a copy of a condition the next template change can falsify.

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
