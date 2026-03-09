---
name: analysis-progress-streaming-design
overview: Design a backend+frontend progress tracking system so PageDraft can show live analysis status (e.g. proofread chunk 1/4 → 4/4) in the editor spinner, inspired by the existing convert-status pattern from FormatBookWebApi.
todos:
  - id: backend-progress-tracker
    content: Add AnalysisProgressTracker service and wire it into UnifiedAnalysisService.RunProofreadChunkedAsync and AnalysisController.RunAnalysis with a jobId
    status: completed
  - id: backend-progress-endpoint
    content: Add GET api/books/{bookId}/chapters/{chapterId}/analysis-progress/{jobId} endpoint returning AnalysisProgressDto
    status: completed
  - id: frontend-progress-models
    content: Extend AnalysisResultDto and add AnalysisProgressDto/AnalysisProgressService for polling analysis progress
    status: completed
  - id: frontend-panel-integration
    content: Update AnalysisPanelComponent to start/stop polling for proofread job progress and emit status messages via analysisStatus
    status: completed
  - id: verify-ux-copy
    content: Tune progress messages and ensure the editor overlay updates smoothly from 1/4 → 4/4 and final states
    status: completed
  - id: backend-async-start-endpoint
    content: Add an async "start analysis" endpoint that kicks off chunked proofread in the background and returns jobId immediately
    status: completed
  - id: backend-final-result-by-job
    content: Expose a way to fetch the final AnalysisResult by jobId (or ensure the existing history endpoint can be reliably used after progress Succeeded)
    status: completed
  - id: frontend-async-flow
    content: Update AnalysisPanelComponent to use the async start endpoint, show overlay, poll /analysis-progress/{jobId} until terminal, then refresh history/final result
    status: completed
  - id: integration-testing
    content: Manually test long-running chunked proofreads to verify 1/4 → 4/4 progress, failure states, and final result loading
    status: completed
isProject: false
---

## Analysis streaming progress design

### High-level approach

- **Goal**: Show meaningful, step-wise progress for long-running analyses (especially chunked proofread) in the editor overlay, e.g. "Proofread 2/4 – running" and a short label for each phase.
- **Mechanism choice**: Use a **polling-based progress endpoint** ("convert-status" style) for robustness and simplicity, but shape the model so it can later be reused from an SSE endpoint if desired.
- **Scope for first iteration (DONE)**:
  - Backend: Track progress only for **chunked proofread** (`RunProofreadChunkedAsync`) and expose it through a dedicated endpoint.
  - Frontend: Enhance the existing spinner to **poll and display** `(currentStep/totalSteps)` plus a human-readable message.

### Backend design (Pagedraft.Api)

- **1. Introduce an analysis job identifier**
  - Add a GUID `**jobId`** concept separate from the persisted `AnalysisResult.Id`.
  - Generate a new `jobId` whenever a new `RunAsync` is invoked for a proofread that will be chunked.
  - Return this `jobId` to the client alongside the final `AnalysisResultDto` for now (so future async patterns are easy), but the main use is for progress polling.
  - Implementation options:
    - **Option A (lightweight)**: Add a `Guid? JobId` property on `AnalysisResult` (and `AnalysisResultDto`) and populate it when chunked proofread runs.
    - **Option B (strictly ephemeral)**: Keep `jobId` only in a transient in-memory store keyed by chapter/scene, but still return it to the client in the `RunAnalysis` response.
- **2. Shared in-memory progress store**
  - Create an in-memory service, e.g. `[Pagedraft.Api/Services/Analysis/AnalysisProgressTracker.cs]`, registered as a singleton.
  - Responsibilities:
    - Maintain a **thread-safe dictionary** keyed by `jobId` (and optionally by chapter/scene) with a value like:
      - `JobId`
      - `Scope` (Chapter/Scene)
      - `AnalysisType`
      - `TotalChunks`
      - `CompletedChunks`
      - `CurrentChunkIndex` (1-based) and/or `InFlight` count
      - `Status` (`Pending`, `Running`, `Succeeded`, `Failed`, `Canceled`)
      - `Message` (short label: "Preparing chunks", "Running chunk 2/4", "Merging results" etc.)
      - `LastUpdatedUtc`
    - Provide simple methods:
      - `StartJob(jobId, meta)` – initialize status when `RunProofreadChunkedAsync` begins.
      - `SetTotalChunks(jobId, total)` – set `TotalChunks` after `ChunkForProofread` runs.
      - `ChunkStarted(jobId, index)` / `ChunkCompleted(jobId, index)` – increment `CompletedChunks`, update `CurrentChunkIndex`, and `Message`.
      - `SetStatus(jobId, status, message)` – mark as `Succeeded`/`Failed` etc.
      - `TryGet(jobId)` – read-only snapshot for the status endpoint.
      - Optionally a cleanup policy (e.g. prune entries older than 30 minutes on each write/read).
- **3. Wire progress updates into `RunProofreadChunkedAsync`**
  - File: `[Pagedraft.Api/Services/Analysis/UnifiedAnalysisService.cs]`.
  - At the start of `RunProofreadChunkedAsync`:
    - Accept a `Guid jobId` parameter (added to `RunAsync` signature for the proofread-chunked path).
    - After chunking (`var chunks = ChunkForProofread(...);`), call `progressTracker.StartJob(jobId, meta)` and `progressTracker.SetTotalChunks(jobId, chunks.Count)` with a message like "Queued N proofread chunks".
  - Inside `ProcessChunk(int index)`:
    - Before calling `_router.CompleteAsync`, call `progressTracker.ChunkStarted(jobId, index + 1)`; message like `"Running chunk {index+1}/{chunks.Count}"`.
    - On success, after writing `corrected[index]`, call `progressTracker.ChunkCompleted(jobId, index + 1)`.
    - On exception fallback, still call `ChunkCompleted` but perhaps set a warning-style message.
  - After merging (`mergedResultText`), call `progressTracker.SetStatus(jobId, Succeeded, "Merging completed")` (or a final message like "Proofread finished").
  - On early failures (if any global exception path is added in future), call `SetStatus(jobId, Failed, ex.Message)`.
- **4. Surface `jobId` through the analysis API**
  - Update `RunAsync` signature to accept an optional `Guid? jobId` or generate it inside when chunked proofread is selected.
  - In `AnalysisController.RunAnalysis` (`[Pagedraft.Api/Controllers/AnalysisController.cs]`):
    - When calling `_unifiedAnalysis.RunAsync` and it decides to use chunked proofread, propagate or create a `jobId` and keep it consistent with the progress tracker.
    - Update `AnalysisResultDto` (record in `Pagedraft.Api/Models/Dtos/AnalysisDto.cs` and `src/app/core/models/analysis.ts`) to include an optional `jobId` so the client can know which status entry to poll.
- **5. New progress endpoint (polling)**
  - In `AnalysisController`, add e.g.:
    - `GET api/books/{bookId}/chapters/{chapterId}/analysis-progress/{jobId}`.
  - Response DTO (new type `AnalysisProgressDto`):
    - `jobId: Guid`
    - `analysisType: string`
    - `scope: string`
    - `status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Canceled'`
    - `currentChunk: int`
    - `totalChunks: int`
    - `message: string`
    - Optionally, `estimatedCompletionPercent: number` (derived as `CompletedChunks / TotalChunks * 100`).
  - Behavior:
    - If `jobId` unknown or expired: return 404 or `status = 'Unknown'` with a message, but the client can stop polling once it sees `Succeeded`/`Failed` or once the main `RunAnalysis` call resolves.
    - The endpoint does **not** start work; it only reads from `AnalysisProgressTracker`.
- **6. Room for SSE in the future**
  - With `AnalysisProgressTracker` in place, later we can add an **optional SSE endpoint**:
    - `GET api/books/{bookId}/chapters/{chapterId}/analysis-progress-stream/{jobId}` that subscribes to tracker updates and pushes them as SSE events.
    - The same DTO (`AnalysisProgressDto`) can be serialized into `data:` lines, reusing most logic.

### Frontend design (pagedraft-client)

- **1. Extend analysis models**
  - Update `AnalysisResultDto` in `[src/app/core/models/analysis.ts]` to include optional `jobId?: string | null;` to match the API.
  - If we create a dedicated `AnalysisProgressDto` on the backend, mirror it in the Angular models under the same file or a small new one (e.g. `analysis-progress.ts`).
- **2. Add progress polling service**
  - New service: `[src/app/core/services/analysis-progress.service.ts]`.
  - Responsibilities:
    - Expose a method like:
      - `pollProgress(bookId: string, chapterId: string, jobId: string): Observable<AnalysisProgressDto>`
      - It can internally use `interval()` + `switchMap` to call `GET /analysis-progress/{jobId}` every e.g. 1–2 seconds while `status` is `Pending` or `Running`.
    - Allow a `stop`/`takeUntil` signal so the component can cancel polling when the main run completes or fails.
    - Be careful to **not leak timers**: complete the observable when `status` becomes terminal or when unsubscribed.
- **3. Hook polling into `AnalysisPanelComponent`**
  - File: `[src/app/features/analysis-panel/analysis-panel.component.ts]`.
  - When a run starts and we get back a `result` with `jobId`:
    - Start polling via the new `AnalysisProgressService` while `isRunning` is true.
    - For each progress update:
      - Build a user-friendly message, e.g.: `Proofread 2/4 – Running chunk 2 of 4` or `Merging results…`.
      - Emit it through the **existing `analysisStatus` output** you already added: `this.analysisStatus.emit(message)`.
    - Stop polling once:
      - `status` is terminal (`Succeeded` or `Failed`), **or**
      - the main `run` observable completes and `isRunning` flips to `false`.
  - For non-chunked analyses or cases with no `jobId`:
    - Keep using the simple one-shot status string you already implemented ("Running Proofread…", "Running Custom analysis…").
- **4. Editor overlay behavior**
  - File: `[src/app/features/editor/editor-page.component.ts]`.
  - Current behavior (after your last change):
    - `onAnalysisStarted()` sets `analysisRunning = true` and initializes `analysisStatusText`.
    - `onAnalysisStatus(message)` updates the overlay text while the run is active.
    - `onAnalysisCompleted()` hides the overlay.
  - With progress polling:
    - No changes are required in the editor itself; it already receives `analysisStatus` and displays it.
    - The overlay will automatically update as the analysis panel emits `"Proofread 1/4"`, `"Proofread 2/4"`, etc.

### UX and wording

- **1. Progress phrasing**
  - For chunked proofread:
    - `Proofread 1/4 – Analyzing first part…`
    - `Proofread 2/4 – Analyzing middle sections…`
    - `Proofread 4/4 – Final part…`
    - `Proofread – Merging changes…`
  - For other analyses (no chunking): leave as short, generic messages ("Running Linguistic analysis…").
- **2. Failure and cancellation states**
  - When `status = Failed` from the backend:
    - Emit `"Proofread failed – see error message"` and rely on existing `runError` for details.
  - If user navigates away or cancels in the future, we can:
    - Stop polling on the client.
    - Optionally add a `Canceled` status in the tracker for consistency.

### Future enhancements (beyond first iteration)

- **Book/scene-wide pipelines**: If you later add multi-step flows (e.g. summarize chapters → run literary analysis → generate overview), extend `AnalysisProgressTracker` to store **step-level phases**, and have the frontend display both the step (`"Summarizing chapters"`) and intra-step chunk progress (`2/5`).
- **Shared status for LanguageEngine**: If language-tool detection or rewrite becomes long-running, consider reusing the same tracker shape for that flow as well, so the UI has one unified progress model.
- **SSE / WebSocket**: If polling becomes too chatty, layer an SSE endpoint on top of `AnalysisProgressTracker` and swap the Angular polling for `EventSource` logic.

### Minimal implementation set for a first PR

- **Backend**
  - Add `AnalysisProgressTracker` service.
  - Add `jobId` handling in `RunProofreadChunkedAsync` and `RunAnalysis` pipeline.
  - Extend `AnalysisResult`/`AnalysisResultDto` with optional `JobId`.
  - Implement `GET /analysis-progress/{jobId}` returning `AnalysisProgressDto`.
- **Frontend**
  - Extend `AnalysisResultDto` model with `jobId`.
  - Add `AnalysisProgressService` to poll progress.
  - In `AnalysisPanelComponent`, start/stop polling when proofread with `jobId` is running, and emit readable messages via `analysisStatus`.
  - Reuse existing overlay in `EditorPageComponent` (no major changes needed beyond what you already added).

### Next iteration – async job-based execution (not yet implemented)

The first iteration gives us end‑to‑end tracking and polling, but `POST /analyze` still runs synchronously, so the client only receives `jobId` after the chunked proofread completes. To get true live updates (1/4 → 4/4) while the overlay is visible, we need a second iteration that makes analysis execution job‑based and async:

- **Backend**
  - Add a "start analysis" endpoint (e.g. `POST /analysis-jobs`) that:
    - Validates input and decides whether to use chunked proofread.
    - Creates a `jobId`, stores initial progress in `AnalysisProgressTracker`, and queues the actual `RunProofreadChunkedAsync` work on a background task (hosted service, fire‑and‑forget, or job queue).
    - Returns immediately with `jobId` (and basic metadata) instead of waiting for completion.
  - Ensure the background worker:
    - Updates `AnalysisProgressTracker` exactly as in the current synchronous integration.
    - Persists the final `AnalysisResult` as today so existing history endpoints keep working.
  - Expose or document a way to resolve from `jobId` to the final `AnalysisResult` (e.g. via history filters or a `GET /analysis-jobs/{jobId}` that returns the linked analysis id once complete).
- **Frontend**
  - For long‑running Proofread runs, switch the panel to:
    - Call the async "start analysis" endpoint instead of the current blocking `/analyze`.
    - Immediately show the overlay with the estimated chunks message.
    - Start polling `/analysis-progress/{jobId}` until `status` is terminal, updating the overlay text with:
      - `Proofread 1/4 – Analyzing first part…`
      - `Proofread 2/4 – Analyzing middle sections…`
      - `Proofread 4/4 – Final part…`
      - `Proofread – Merging changes…`
      - Failure: `Proofread failed – see error message`.
    - Once progress is `Succeeded`, refresh history (or call a dedicated endpoint) to load and display the final `AnalysisResult`.
- **Out of scope for this iteration**
  - Streaming rewrite of the existing `/analyze` endpoint.
  - SSE/WebSocket push; we continue to rely on polling + the shared `AnalysisProgressTracker` model prepared in the first iteration.

