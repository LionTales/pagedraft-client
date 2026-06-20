import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SceneDto, SceneSummaryDto, CreateSceneDto, UpdateSceneDto } from '../models/book';

@Injectable({ providedIn: 'root' })
export class SceneService {
  private readonly base = (bookId: string, chapterId: string) =>
    `/api/books/${bookId}/chapters/${chapterId}/scenes`;

  constructor(private http: HttpClient) {}

  getAll(bookId: string, chapterId: string): Observable<SceneSummaryDto[]> {
    return this.http.get<SceneSummaryDto[]>(this.base(bookId, chapterId));
  }

  getById(bookId: string, chapterId: string, sceneId: string): Observable<SceneDto> {
    return this.http.get<SceneDto>(`${this.base(bookId, chapterId)}/${sceneId}`);
  }

  create(bookId: string, chapterId: string, body: CreateSceneDto): Observable<SceneDto> {
    return this.http.post<SceneDto>(this.base(bookId, chapterId), body);
  }

  update(
    bookId: string,
    chapterId: string,
    sceneId: string,
    body: UpdateSceneDto
  ): Observable<SceneDto> {
    return this.http.patch<SceneDto>(`${this.base(bookId, chapterId)}/${sceneId}`, body);
  }

  delete(bookId: string, chapterId: string, sceneId: string): Observable<void> {
    return this.http.delete<void>(`${this.base(bookId, chapterId)}/${sceneId}`);
  }

  clear(bookId: string, chapterId: string): Observable<void> {
    return this.http.delete<void>(this.base(bookId, chapterId));
  }

  reorder(
    bookId: string,
    chapterId: string,
    scenes: { sceneId: string; order: number }[]
  ): Observable<SceneSummaryDto[]> {
    return this.http.put<SceneSummaryDto[]>(`${this.base(bookId, chapterId)}/reorder`, {
      scenes
    });
  }

  splitScenes(bookId: string, chapterId: string): Observable<SceneSummaryDto[]> {
    return this.http.post<SceneSummaryDto[]>(`${this.base(bookId, chapterId)}/split-scenes`, {});
  }
}
