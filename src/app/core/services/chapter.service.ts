import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChapterDto, ChapterSummaryDto } from '../models/book';

@Injectable({ providedIn: 'root' })
export class ChapterService {
  private readonly base = (bookId: string) => `/api/books/${bookId}/chapters`;

  constructor(private http: HttpClient) {}

  getAll(bookId: string): Observable<ChapterSummaryDto[]> {
    return this.http.get<ChapterSummaryDto[]>(this.base(bookId));
  }

  getById(bookId: string, chapterId: string): Observable<ChapterDto> {
    return this.http.get<ChapterDto>(`${this.base(bookId)}/${chapterId}`);
  }

  create(bookId: string, title: string, partName?: string | null, order?: number): Observable<ChapterDto> {
    return this.http.post<ChapterDto>(this.base(bookId), { title, partName: partName ?? null, order: order ?? null });
  }

  update(bookId: string, chapterId: string, patch: { contentSfdt?: string; title?: string; partName?: string; order?: number }): Observable<ChapterSummaryDto> {
    return this.http.patch<ChapterSummaryDto>(`${this.base(bookId)}/${chapterId}`, patch);
  }

  delete(bookId: string, chapterId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(bookId)}/${chapterId}`);
  }

  reorder(bookId: string, chapters: { chapterId: string; order: number }[]): Observable<ChapterSummaryDto[]> {
    return this.http.put<ChapterSummaryDto[]>(`${this.base(bookId)}/reorder`, { chapters });
  }
}
