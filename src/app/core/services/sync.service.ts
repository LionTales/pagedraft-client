import { Injectable } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import type {
  ChapterUpdatedEvent,
  ChapterCreatedEvent,
  ChapterDeletedEvent,
  ChapterReorderedEvent,
  SceneCreatedEvent,
  SceneUpdatedEvent,
  SceneDeletedEvent,
  ScenesReorderedEvent
} from '../models/book';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private connection: signalR.HubConnection | null = null;
  private currentBookId: string | null = null;

  readonly chapterUpdated$ = new Subject<ChapterUpdatedEvent>();
  readonly chapterCreated$ = new Subject<ChapterCreatedEvent>();
  readonly chapterDeleted$ = new Subject<ChapterDeletedEvent>();
  readonly chapterReordered$ = new Subject<ChapterReorderedEvent>();
  readonly sceneCreated$ = new Subject<SceneCreatedEvent>();
  readonly sceneUpdated$ = new Subject<SceneUpdatedEvent>();
  readonly sceneDeleted$ = new Subject<SceneDeletedEvent>();
  readonly scenesReordered$ = new Subject<ScenesReorderedEvent>();

  async connect(): Promise<void> {
    if (this.connection?.state === signalR.HubConnectionState.Connected) return;
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/booksync')
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .build();
    this.connection.on('ChapterUpdated', (e: ChapterUpdatedEvent) => this.chapterUpdated$.next(e));
    this.connection.on('ChapterCreated', (e: ChapterCreatedEvent) => this.chapterCreated$.next(e));
    this.connection.on('ChapterDeleted', (e: ChapterDeletedEvent) => this.chapterDeleted$.next(e));
    this.connection.on('ChapterReordered', (e: ChapterReorderedEvent) => this.chapterReordered$.next(e));
    this.connection.on('SceneCreated', (e: SceneCreatedEvent) => this.sceneCreated$.next(e));
    this.connection.on('SceneUpdated', (e: SceneUpdatedEvent) => this.sceneUpdated$.next(e));
    this.connection.on('SceneDeleted', (e: SceneDeletedEvent) => this.sceneDeleted$.next(e));
    this.connection.on('ScenesReordered', (e: ScenesReorderedEvent) => this.scenesReordered$.next(e));
    await this.connection.start();
    if (this.currentBookId) await this.joinBook(this.currentBookId);
  }

  async disconnect(): Promise<void> {
    if (this.currentBookId) await this.leaveBook(this.currentBookId);
    await this.connection?.stop();
    this.connection = null;
    this.currentBookId = null;
  }

  async joinBook(bookId: string): Promise<void> {
    this.currentBookId = bookId;
    await this.connection?.invoke('JoinBook', bookId);
  }

  async leaveBook(bookId: string): Promise<void> {
    if (this.currentBookId === bookId) this.currentBookId = null;
    await this.connection?.invoke('LeaveBook', bookId);
  }
}
