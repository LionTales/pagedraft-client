import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ImportPreviewResponseDto,
  ImportConfirmationRequest,
  ImportConfirmationResultDto,
} from '../models/book';

@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly base = '/api/document';

  constructor(private http: HttpClient) {}

  uploadForPreview(bookId: string, file: File): Observable<ImportPreviewResponseDto> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<ImportPreviewResponseDto>(`${this.base}/import/${bookId}`, form);
  }

  confirmImport(bookId: string, request: ImportConfirmationRequest): Observable<ImportConfirmationResultDto> {
    return this.http.post<ImportConfirmationResultDto>(`${this.base}/import/${bookId}/confirm`, request);
  }
}

