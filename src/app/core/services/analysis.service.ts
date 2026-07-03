import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AnalysisResultDto, AnalysisChunkThresholdsDto, PromptTemplateDto, RunAnalysisRequest, StartAnalysisJobResponse } from '../models/analysis';
import { ActiveAnalysisJobDto } from '../models/active-analysis-job';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  constructor(private http: HttpClient) {}

  getTemplates(): Observable<PromptTemplateDto[]> {
    return this.http.get<PromptTemplateDto[]>(`/api/templates`);
  }

  /** Chunk thresholds from server (Proofread/LineEdit). Use to decide analysis-jobs vs sync /analyze. */
  getChunkThresholds(): Observable<AnalysisChunkThresholdsDto> {
    return this.http.get<AnalysisChunkThresholdsDto>('/api/config/analysis-chunk-thresholds');
  }

  getHistory(
    bookId: string,
    chapterId: string,
    analysisType?: string | null,
    sceneId?: string | null
  ): Observable<AnalysisResultDto[]> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analyses`;
    const params: Record<string, string> = {};
    if (analysisType) params['analysisType'] = analysisType;
    if (sceneId) params['sceneId'] = sceneId;
    if (Object.keys(params).length) {
      return this.http.get<AnalysisResultDto[]>(url, { params });
    }
    return this.http.get<AnalysisResultDto[]>(url);
  }

  /** Update the Outcome for a single server-side suggestion row (Accepted, Dismissed, Reverted, Superseded). */
  updateSuggestionOutcome(
    bookId: string,
    chapterId: string,
    suggestionId: string,
    outcome: 'Accepted' | 'Dismissed' | 'Reverted' | 'Superseded'
  ): Observable<void> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/suggestions/${suggestionId}/outcome`;
    return this.http.patch<void>(url, { outcome });
  }

  /** Request an explanation for a specific suggestion (cached on the server after first call). */
  explainSuggestion(
    bookId: string,
    chapterId: string,
    suggestionId: string
  ): Observable<{ explanation: string }> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/suggestions/${suggestionId}/explain`;
    return this.http.post<{ explanation: string }>(url, {});
  }

  run(
    bookId: string,
    chapterId: string,
    body: RunAnalysisRequest,
    sceneId?: string | null
  ): Observable<AnalysisResultDto> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analyze`;
    if (sceneId) {
      return this.http.post<AnalysisResultDto>(url, body, { params: { sceneId } });
    }
    return this.http.post<AnalysisResultDto>(url, body);
  }

  /**
   * Start an async analysis job (currently used for long-running Proofread runs).
   * Returns immediately with a jobId; progress can be polled via analysis-progress,
   * and the final result can be fetched via getByJob once the job completes.
   */
  startAsync(
    bookId: string,
    chapterId: string,
    body: RunAnalysisRequest,
    sceneId?: string | null
  ): Observable<StartAnalysisJobResponse> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analysis-jobs`;
    if (sceneId) {
      return this.http.post<StartAnalysisJobResponse>(url, body, { params: { sceneId } });
    }
    return this.http.post<StartAnalysisJobResponse>(url, body);
  }

  /**
   * List the in-flight (non-terminal) chapter/scene analysis jobs for a book (rf-b01).
   * Read-only over the backend's in-memory progress tracker; used by JobRegistryService.reattach
   * to re-track chapter Proofread/LineEdit jobs that were running before a browser refresh.
   * Book-level builds (summary/review/style-baseline) are NOT in this list - reattach reads those
   * from their own status endpoints' activeBuildJobId.
   */
  getActiveAnalysisJobs(bookId: string): Observable<ActiveAnalysisJobDto[]> {
    return this.http.get<ActiveAnalysisJobDto[]>(`/api/books/${bookId}/active-analysis-jobs`);
  }

  /** Fetch the final AnalysisResult for a completed async job. */
  getByJob(
    bookId: string,
    chapterId: string,
    jobId: string
  ): Observable<AnalysisResultDto> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analysis-jobs/${jobId}`;
    return this.http.get<AnalysisResultDto>(url);
  }

  createTemplate(payload: { name: string; type: string; templateText: string; language?: string }): Observable<PromptTemplateDto> {
    return this.http.post<PromptTemplateDto>(`/api/templates`, payload);
  }

  /**
   * Streaming analysis using the backend's /analyze SSE-like streaming mode.
   * Emits individual text tokens as they arrive.
   * Note: the streaming path does not currently persist AnalysisResult records.
   */
  runStream(
    bookId: string,
    chapterId: string,
    body: RunAnalysisRequest,
    sceneId?: string | null
  ): Observable<string> {
    let url = `/api/books/${bookId}/chapters/${chapterId}/analyze`;
    if (sceneId) url += `?sceneId=${encodeURIComponent(sceneId)}`;

    return new Observable<string>((observer) => {
      const controller = new AbortController();

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ...body, stream: true }),
        signal: controller.signal
      })
        .then(response => {
          if (!response.body) {
            observer.error(new Error('Streaming not supported on this response.'));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          const read = (): void => {
            reader.read().then(({ done, value }) => {
              if (done) {
                observer.complete();
                return;
              }

              buffer += decoder.decode(value, { stream: true });
              const chunks = buffer.split('\n\n');
              buffer = chunks.pop() ?? '';

              for (const chunk of chunks) {
                const line = chunk.trim();
                if (!line.startsWith('data:')) continue;

                const jsonText = line.slice(5).trim();
                try {
                  const payload = JSON.parse(jsonText) as { token?: string; done?: boolean };
                  if (payload.token) {
                    observer.next(payload.token);
                  }
                  if (payload.done) {
                    observer.complete();
                    return;
                  }
                } catch {
                  // ignore malformed lines
                }
              }

              read();
            }).catch(err => {
              observer.error(err);
            });
          };

          read();
        })
        .catch(err => observer.error(err));

      return () => controller.abort();
    });
  }
}

