import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AnalysisResultDto, PromptTemplateDto, RunAnalysisRequest, StartAnalysisJobResponse, SuggestionOutcomeDto } from '../models/analysis';

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  constructor(private http: HttpClient) {}

  getTemplates(): Observable<PromptTemplateDto[]> {
    return this.http.get<PromptTemplateDto[]>(`/api/templates`);
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

  /** Load all suggestion outcomes (Accepted/Dismissed) for the chapter/scene so the History tab can restore state. */
  getSuggestionOutcomes(
    bookId: string,
    chapterId: string,
    sceneId?: string | null
  ): Observable<SuggestionOutcomeDto[]> {
    let url = `/api/books/${bookId}/chapters/${chapterId}/suggestion-outcomes`;
    if (sceneId) url += `?sceneId=${encodeURIComponent(sceneId)}`;
    return this.http.get<SuggestionOutcomeDto[]>(url);
  }

  /** Persist one suggestion outcome (Accepted, Dismissed, or Reverted). Call when the result has an id (saved run). */
  saveSuggestionOutcome(
    bookId: string,
    chapterId: string,
    analysisId: string,
    originalText: string,
    suggestedText: string,
    outcome: 'Accepted' | 'Dismissed' | 'Reverted'
  ): Observable<void> {
    const url = `/api/books/${bookId}/chapters/${chapterId}/analyses/${analysisId}/suggestion-outcomes`;
    return this.http.post<void>(url, {
      originalText,
      suggestedText,
      outcome
    });
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

