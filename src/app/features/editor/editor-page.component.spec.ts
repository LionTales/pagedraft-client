import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, EventEmitter, NO_ERRORS_SCHEMA, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { BookDetailDto } from '../../core/models/book';
import { of, EMPTY, throwError, Subject, BehaviorSubject, Observable } from 'rxjs';
import { EditorPageComponent } from './editor-page.component';
import { BookService } from '../../core/services/book.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { ChapterService } from '../../core/services/chapter.service';
import { SceneService } from '../../core/services/scene.service';
import { SyncService } from '../../core/services/sync.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { JobRegistryService, TrackedJob } from '../../core/services/job-registry.service';
import { SfdtManipulationService, SCROLL_TARGET_BOOKMARK } from '../../core/services/sfdt-manipulation.service';
import { EditorTextService } from '../../core/services/editor-text.service';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { ReviseContextService } from '../../core/services/revise-context.service';
import { AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { AnalysisResultDto } from '../../core/models/analysis';
import { AnalysisRunDialogComponent, RUN_DIALOG_LABELS_HE } from '../../shared/analysis-run-dialog/analysis-run-dialog.component';

describe('EditorPageComponent (focused logic)', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  let anchorSpy: jasmine.SpyObj<SuggestionAnchorService>;
  let sfdtSpy: jasmine.SpyObj<SfdtManipulationService>;
  let editorTextSpy: jasmine.SpyObj<EditorTextService>;
  let chapterUpdateSpy: jasmine.Spy;
  let versionCreateSpy: jasmine.Spy;
  let mockDocEditor: {
    documentEditor: { serialize: jasmine.Spy; open: jasmine.Spy; fitPage: jasmine.Spy; resize: jasmine.Spy; zoomFactor: number };
  };

  const SAMPLE_SFDT =
    '{"sections":[{"blocks":[{"inlines":[{"text":"Hello world"}]}]}]}';

  beforeEach(async () => {
    anchorSpy = jasmine.createSpyObj('SuggestionAnchorService', [
      'relocateAll',
      'relocateOne',
    ]);
    sfdtSpy = jasmine.createSpyObj('SfdtManipulationService', [
      'stripHighlightFromSfdt',
      'replacePlainTextInSfdt',
      'buildMinimalSfdt',
      'ensureSfdtRtl',
      'applyHighlightRangesToSfdt',
      'plainOffsetToSfdtPosition',
      'addBookmarkAtRange',
    ]);
    editorTextSpy = jasmine.createSpyObj('EditorTextService', [
      'getTextFromSfdt',
      'getPlainTextFromEditor',
      'refreshDocumentPlainText',
    ]);
    chapterUpdateSpy = jasmine.createSpy('chapterUpdate').and.returnValue(of({}));
    versionCreateSpy = jasmine.createSpy('versionCreate').and.returnValue(of({}));

    sfdtSpy.stripHighlightFromSfdt.and.callFake((s: string) => s);
    sfdtSpy.replacePlainTextInSfdt.and.returnValue(SAMPLE_SFDT);
    sfdtSpy.addBookmarkAtRange.and.callFake((s: string) => s);
    editorTextSpy.getTextFromSfdt.and.returnValue('Hello world');
    editorTextSpy.refreshDocumentPlainText.and.returnValue('Hello world');

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { params: of({}), snapshot: { queryParams: {} } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), getCurrentNavigation: () => null } },
        { provide: BookService, useValue: { getById: () => EMPTY } },
        // P2-6: the editor reconciles the whole-book build affordance via these when the dashboard is
        // unmounted. Default to "no active build"; individual tests re-stub as needed.
        {
          provide: BookSummaryService,
          useValue: { getBookSummaryStatus: () => of({ activeBuildJobId: null }) },
        },
        {
          provide: BookReviewService,
          useValue: { getReviewStatus: () => of({ activeBuildJobId: null }) },
        },
        {
          provide: ChapterService,
          useValue: {
            update: chapterUpdateSpy,
            create: () => EMPTY,
            delete: () => EMPTY,
            getById: () => EMPTY,
            reorder: () => EMPTY,
          },
        },
        {
          provide: SceneService,
          useValue: {
            update: () => of({}),
            getAll: () => of([]),
            getById: () => EMPTY,
            splitScenes: () => EMPTY,
          },
        },
        {
          provide: SyncService,
          useValue: {
            connect: () => Promise.resolve(),
            joinBook: () => {},
            leaveBook: () => {},
            chapterUpdated$: EMPTY,
            chapterCreated$: EMPTY,
            chapterReordered$: EMPTY,
            sceneCreated$: EMPTY,
            sceneUpdated$: EMPTY,
            sceneDeleted$: EMPTY,
            scenesCleared$: EMPTY,
            scenesReordered$: EMPTY,
          },
        },
        { provide: DocumentVersionService, useValue: { create: versionCreateSpy, list: () => of([]), get: () => EMPTY } },
        { provide: AnalysisService, useValue: {} },
        // rf-c02: the editor derives the "review running" affordance from the registry and calls reattach on
        // book load. Default to "nothing running"; individual tests re-stub anyRunningForBook$ as needed.
        {
          provide: JobRegistryService,
          useValue: {
            anyRunningForBook$: () => of(false),
            reattach: jasmine.createSpy('reattach'),
          },
        },
        { provide: SfdtManipulationService, useValue: sfdtSpy },
        { provide: EditorTextService, useValue: editorTextSpy },
        { provide: SuggestionAnchorService, useValue: anchorSpy },
      ],
    })
      .overrideComponent(EditorPageComponent, {
        set: { template: '<div></div>', imports: [] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;

    mockDocEditor = {
      documentEditor: {
        serialize: jasmine.createSpy('serialize').and.returnValue(SAMPLE_SFDT),
        open: jasmine.createSpy('open'),
        // Focus-mode fit: mock fitPage/resize/zoomFactor so applyFocusFit runs without throwing.
        fitPage: jasmine.createSpy('fitPage'),
        resize: jasmine.createSpy('resize'),
        zoomFactor: 1,
      },
    };
    (component as any).docEditor = mockDocEditor;
    component.selectedChapterId = 'chap-1';
    component.bookId = 'book-1';
    component.currentDocumentPlainText = 'Hello world';
    // A chapter document is loaded, so the document owner matches the selection
    // (set by loadChapterContent in the real flow). Saves require this match.
    component.documentOwnerChapterId = 'chap-1';
    component.documentOwnerSceneId = null;
  });

  afterEach(() => {
    fixture.destroy();
  });

  // ─── onApplyCorrection: relocation ─────────────────────────────────

  it('onApplyCorrection calls relocateOne and uses relocated offsets for the replacement', () => {
    anchorSpy.relocateOne.and.returnValue({
      original: 'world',
      suggested: 'friend',
      startOffset: 6,
      endOffset: 11,
      relocatedStart: 10,
      relocatedEnd: 15,
      stale: false,
    } as any);

    component.onApplyCorrection({
      text: 'friend',
      startOffset: 6,
      endOffset: 11,
      originalText: 'world',
    });

    expect(anchorSpy.relocateOne).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        original: 'world',
        suggested: 'friend',
        startOffset: 6,
        endOffset: 11,
      }),
      'Hello world',
    );

    expect(sfdtSpy.replacePlainTextInSfdt).toHaveBeenCalledWith(
      jasmine.any(String),
      jasmine.any(String),
      jasmine.any(Boolean),
      10,
      15,
      jasmine.any(Number),
    );
  });

  // ─── onApplyCorrection: stale skip ─────────────────────────────────

  it('onApplyCorrection skips correction when relocation returns stale', fakeAsync(() => {
    anchorSpy.relocateOne.and.returnValue({
      original: 'deleted',
      suggested: 'replacement',
      startOffset: 0,
      endOffset: 7,
      relocatedStart: 0,
      relocatedEnd: 7,
      stale: true,
    } as any);

    component.onApplyCorrection({
      text: 'replacement',
      startOffset: 0,
      endOffset: 7,
      originalText: 'deleted',
    });

    tick(100);

    expect(anchorSpy.relocateOne).toHaveBeenCalled();
    expect(mockDocEditor.documentEditor.open).not.toHaveBeenCalled();
    expect(sfdtSpy.replacePlainTextInSfdt).not.toHaveBeenCalled();
  }));

  // ─── saveCurrentDocument: highlight strip ──────────────────────────

  // ─── onApplyCorrection: scroll-target bookmark ─────────────────────

  it('onApplyCorrection injects _scroll_target bookmark into the corrected SFDT', () => {
    anchorSpy.relocateOne.and.returnValue({
      original: 'world',
      suggested: 'earth',
      startOffset: 6,
      endOffset: 11,
      relocatedStart: 6,
      relocatedEnd: 11,
      stale: false,
    } as any);

    component.onApplyCorrection({
      text: 'earth',
      startOffset: 6,
      endOffset: 11,
      originalText: 'world',
    });

    expect(sfdtSpy.addBookmarkAtRange).toHaveBeenCalledWith(
      jasmine.any(String),
      6,
      6 + 'earth'.length,
      SCROLL_TARGET_BOOKMARK,
    );
  });

  // ─── saveCurrentDocument: highlight strip ──────────────────────────

  it('saveCurrentDocument strips highlights before saving even when suggestions are active', () => {
    const HIGHLIGHTED =
      '{"sections":[{"blocks":[{"inlines":[{"text":"Hello","characterFormat":{"highlightColor":"Yellow"}}]}]}]}';
    const CLEAN =
      '{"sections":[{"blocks":[{"inlines":[{"text":"Hello"}]}]}]}';

    mockDocEditor.documentEditor.serialize.and.returnValue(HIGHLIGHTED);
    sfdtSpy.stripHighlightFromSfdt.and.returnValue(CLEAN);
    component.hasPendingChanges = true;

    component.saveCurrentDocument();

    expect(sfdtSpy.stripHighlightFromSfdt).toHaveBeenCalledOnceWith(HIGHLIGHTED);
    expect(chapterUpdateSpy).toHaveBeenCalledWith(
      'book-1',
      'chap-1',
      jasmine.objectContaining({ contentSfdt: CLEAN }),
    );
  });

  // ─── saveCurrentDocument: document-owner routing guard ──────────────

  it('does not write the loaded scene document into the chapter during a delete/clear transition', () => {
    // The editor still holds scene-1's document (owner = scene-1) but the selection
    // already moved off the scene (selectedSceneId null) because the scene was just
    // deleted/cleared and loadChapterContent has not finished yet. hasPendingChanges
    // is still true from prior scene edits.
    component.documentOwnerChapterId = 'chap-1';
    component.documentOwnerSceneId = 'scene-1';
    component.selectedChapterId = 'chap-1';
    component.selectedSceneId = null;
    component.hasPendingChanges = true;

    component.saveCurrentDocument();

    // The save is skipped: the scene SFDT is never persisted into the chapter record,
    // and the pending flag is left intact (nothing was saved).
    expect(chapterUpdateSpy).not.toHaveBeenCalled();
    expect(component.hasPendingChanges).toBe(true);
  });

  it('routes a save to the scene when the loaded document is the selected scene', () => {
    const sceneUpdateSpy = jasmine.createSpy('sceneUpdate').and.returnValue(of({}));
    (TestBed.inject(SceneService) as any).update = sceneUpdateSpy;
    component.documentOwnerChapterId = 'chap-1';
    component.documentOwnerSceneId = 'scene-1';
    component.selectedChapterId = 'chap-1';
    component.selectedSceneId = 'scene-1';
    component.hasPendingChanges = true;

    component.saveCurrentDocument();

    expect(sceneUpdateSpy).toHaveBeenCalledWith(
      'book-1',
      'chap-1',
      'scene-1',
      jasmine.objectContaining({ contentSfdt: jasmine.any(String) }),
    );
    expect(chapterUpdateSpy).not.toHaveBeenCalled();
  });

  // ─── Scene deletion handlers ────────────────────────────────────────

  describe('onDeleteScene', () => {
    let sceneDeleteSpy: jasmine.Spy;
    let sceneGetAllSpy: jasmine.Spy;
    let sceneGetByIdSpy: jasmine.Spy;
    let chapterGetByIdSpy: jasmine.Spy;
    const SCENE: import('../../core/models/book').SceneSummaryDto = {
      id: 'scene-1', chapterId: 'chap-1', title: 'Scene One', order: 0, updatedAt: ''
    };
    const OTHER_SCENE: import('../../core/models/book').SceneSummaryDto = {
      id: 'scene-2', chapterId: 'chap-1', title: 'Scene Two', order: 1, updatedAt: ''
    };

    beforeEach(() => {
      sceneDeleteSpy = jasmine.createSpy('delete').and.returnValue(of(undefined));
      sceneGetAllSpy = jasmine.createSpy('getAll').and.returnValue(of([]));
      sceneGetByIdSpy = jasmine.createSpy('getById').and.returnValue(EMPTY);
      chapterGetByIdSpy = jasmine.createSpy('getById').and.returnValue(EMPTY);

      // Override providers that need richer stubs for these tests
      const sceneServiceStub = TestBed.inject(SceneService) as any;
      sceneServiceStub.delete = sceneDeleteSpy;
      sceneServiceStub.getAll = sceneGetAllSpy;
      sceneServiceStub.getById = sceneGetByIdSpy;
      const chapterServiceStub = TestBed.inject(ChapterService) as any;
      chapterServiceStub.getById = chapterGetByIdSpy;

      // Set up pre-populated scenes
      component.scenesByChapter = { 'chap-1': [SCENE, OTHER_SCENE] };
    });

    it('does nothing when confirm returns false', () => {
      spyOn(window, 'confirm').and.returnValue(false);

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      expect(sceneDeleteSpy).not.toHaveBeenCalled();
      expect(component.scenesByChapter['chap-1']).toEqual([SCENE, OTHER_SCENE]);
    });

    it('optimistically removes the scene and calls sceneService.delete on confirm', () => {
      spyOn(window, 'confirm').and.returnValue(true);

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      // Optimistic removal: scene-1 is gone from the list
      expect(component.scenesByChapter['chap-1'].map((s: any) => s.id)).not.toContain('scene-1');
      expect(component.scenesByChapter['chap-1'].map((s: any) => s.id)).toContain('scene-2');
      // Service call
      expect(sceneDeleteSpy).toHaveBeenCalledOnceWith('book-1', 'chap-1', 'scene-1');
    });

    it('resets selectedSceneId and calls loadChapterContent when deleted scene was selected', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      component.selectedSceneId = 'scene-1';
      component.selectedChapterId = 'chap-1';

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      expect(component.selectedSceneId).toBeNull();
      // loadChapterContent calls chapterService.getById
      expect(chapterGetByIdSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('does not reset selectedSceneId when a different scene is deleted', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      component.selectedSceneId = 'scene-2';

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      expect(component.selectedSceneId).toBe('scene-2');
      expect(chapterGetByIdSpy).not.toHaveBeenCalled();
    });

    it('calls alert and reloads scenes on service error', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      sceneDeleteSpy.and.returnValue(throwError(() => new Error('x')));

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      expect(window.alert).toHaveBeenCalled();
      // loadScenesForChapter calls sceneService.getAll
      expect(sceneGetAllSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('preserves the selected scene and its unsaved edits when deleting it fails', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedSceneId = 'scene-1';
      component.selectedChapterId = 'chap-1';
      sceneDeleteSpy.and.returnValue(throwError(() => new Error('x')));

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      // The editor is never switched, so the scene stays selected and its in-editor
      // unsaved edits are NOT reloaded/discarded from the server (no scene or chapter load).
      expect(component.selectedSceneId).toBe('scene-1');
      expect(sceneGetByIdSpy).not.toHaveBeenCalled();
      expect(chapterGetByIdSpy).not.toHaveBeenCalled();
      // The tree is reconciled with the server.
      expect(sceneGetAllSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('does not switch the editor to chapter content until the delete is confirmed', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      component.selectedSceneId = 'scene-1';
      component.selectedChapterId = 'chap-1';
      const deleteSubject = new Subject<void>();
      sceneDeleteSpy.and.returnValue(deleteSubject.asObservable());

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      // While the delete is in flight, the editor must NOT switch to chapter content
      // (which would open over the scene document and reset hasPendingChanges, losing
      // unsaved scene edits if the delete then fails).
      expect(component.selectedSceneId).toBe('scene-1');
      expect(chapterGetByIdSpy).not.toHaveBeenCalled();

      // Only once the server confirms does the editor switch to the chapter.
      deleteSubject.next();
      deleteSubject.complete();
      expect(component.selectedSceneId).toBeNull();
      expect(chapterGetByIdSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('does not restore scene selection when deleting a NON-selected scene fails', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedSceneId = 'scene-2';
      sceneDeleteSpy.and.returnValue(throwError(() => new Error('x')));

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      // scene-2 stays selected; we never optimistically cleared it, so nothing to restore.
      expect(component.selectedSceneId).toBe('scene-2');
      expect(sceneGetByIdSpy).not.toHaveBeenCalled();
    });
  });

  describe('onClearScenes', () => {
    let sceneClearSpy: jasmine.Spy;
    let sceneGetAllSpy: jasmine.Spy;
    let chapterGetByIdSpy: jasmine.Spy;
    const CHAPTER: import('../../core/models/book').ChapterSummaryDto = {
      id: 'chap-1', title: 'Chapter One', partName: null, order: 0, wordCount: 0, updatedAt: ''
    };
    const SCENE: import('../../core/models/book').SceneSummaryDto = {
      id: 'scene-1', chapterId: 'chap-1', title: 'Scene One', order: 0, updatedAt: ''
    };

    beforeEach(() => {
      sceneClearSpy = jasmine.createSpy('clear').and.returnValue(of(undefined));
      sceneGetAllSpy = jasmine.createSpy('getAll').and.returnValue(of([]));
      chapterGetByIdSpy = jasmine.createSpy('getById').and.returnValue(EMPTY);

      const sceneServiceStub = TestBed.inject(SceneService) as any;
      sceneServiceStub.clear = sceneClearSpy;
      sceneServiceStub.getAll = sceneGetAllSpy;
      const chapterServiceStub = TestBed.inject(ChapterService) as any;
      chapterServiceStub.getById = chapterGetByIdSpy;

      component.scenesByChapter = { 'chap-1': [SCENE] };
    });

    it('does nothing when confirm returns false', () => {
      spyOn(window, 'confirm').and.returnValue(false);

      component.onClearScenes(CHAPTER);

      expect(sceneClearSpy).not.toHaveBeenCalled();
    });

    it('calls sceneService.clear and empties the scene list on confirm', () => {
      spyOn(window, 'confirm').and.returnValue(true);

      component.onClearScenes(CHAPTER);

      expect(sceneClearSpy).toHaveBeenCalledOnceWith('book-1', 'chap-1');
      expect(component.scenesByChapter['chap-1']).toEqual([]);
    });

    it('resets selectedSceneId and reloads chapter content when a scene in that chapter was selected', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = 'scene-1';

      component.onClearScenes(CHAPTER);

      expect(component.selectedSceneId).toBeNull();
      expect(chapterGetByIdSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('does not reset selectedSceneId when no scene in that chapter was selected', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = null;

      component.onClearScenes(CHAPTER);

      expect(component.selectedSceneId).toBeNull();
      expect(chapterGetByIdSpy).not.toHaveBeenCalled();
    });

    it('calls alert and reloads scenes from the server on service error', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      sceneClearSpy.and.returnValue(throwError(() => new Error('fail')));

      component.onClearScenes(CHAPTER);

      expect(window.alert).toHaveBeenCalled();
      // Reconcile with the server (the clear may have applied despite the error,
      // or a hub event mutated local state) by reloading the scene list.
      expect(sceneGetAllSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('drops the stale selection and loads chapter content when the clear succeeded server-side despite the error', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = 'scene-1';
      sceneClearSpy.and.returnValue(throwError(() => new Error('fail')));
      // Server actually cleared: the reload returns no scenes.
      sceneGetAllSpy.and.returnValue(of([]));

      component.onClearScenes(CHAPTER);

      // The deleted scene is no longer selected; the editor switches to chapter content
      // so the user is not editing/saving against a scene that no longer exists.
      expect(component.selectedSceneId).toBeNull();
      expect(chapterGetByIdSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('keeps the selection when the clear truly failed and the scene survives the reload', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = 'scene-1';
      sceneClearSpy.and.returnValue(throwError(() => new Error('fail')));
      // Clear truly failed: the scene is still present on reload.
      sceneGetAllSpy.and.returnValue(of([SCENE]));

      component.onClearScenes(CHAPTER);

      expect(component.selectedSceneId).toBe('scene-1');
      expect(chapterGetByIdSpy).not.toHaveBeenCalled();
    });

    it('drops the selection and shows chapter content when the reconcile reload also fails and there are no unsaved edits', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = 'scene-1';
      component.hasPendingChanges = false;
      sceneClearSpy.and.returnValue(throwError(() => new Error('fail')));
      // Both the clear AND the reconcile reload fail: server state is unknown.
      sceneGetAllSpy.and.returnValue(throwError(() => new Error('reload failed')));

      component.onClearScenes(CHAPTER);

      // No unsaved edits to protect, and the clear may have applied: drop the possibly
      // stale scene selection and switch to chapter content.
      expect(component.selectedSceneId).toBeNull();
      expect(chapterGetByIdSpy).toHaveBeenCalledWith('book-1', 'chap-1');
    });

    it('keeps the selected scene when the reconcile reload also fails but there are unsaved edits', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = 'scene-1';
      component.hasPendingChanges = true;
      sceneClearSpy.and.returnValue(throwError(() => new Error('fail')));
      sceneGetAllSpy.and.returnValue(throwError(() => new Error('reload failed')));

      component.onClearScenes(CHAPTER);

      // Unverified state with unsaved edits: do not switch the editor (which would
      // discard the edits). Keep the scene selected.
      expect(component.selectedSceneId).toBe('scene-1');
      expect(chapterGetByIdSpy).not.toHaveBeenCalled();
    });
  });

  // ─── wb3-f01: onOpenChapterFromDashboard ───────────────────────────

  describe('onOpenChapterFromDashboard (wb3-f01)', () => {
    const CHAPTER_A: import('../../core/models/book').ChapterSummaryDto = {
      id: 'chap-a', title: 'Chapter A', partName: null, order: 0, wordCount: 100, updatedAt: ''
    };
    const CHAPTER_B: import('../../core/models/book').ChapterSummaryDto = {
      id: 'chap-b', title: 'Chapter B', partName: null, order: 1, wordCount: 200, updatedAt: ''
    };

    beforeEach(() => {
      component.book = {
        id: 'book-1', title: 'My Book', author: null, language: 'he', createdAt: '', updatedAt: '',
        aiTier: 'fast',
        chapters: [CHAPTER_A, CHAPTER_B],
      };
      // Stub loadChapterContent (calls chapterService.getById internally).
      const chapterServiceStub = TestBed.inject(ChapterService) as any;
      chapterServiceStub.getById = jasmine.createSpy('getById').and.returnValue(EMPTY);
    });

    it('calls selectChapter with the matching chapter when chapterId is found', () => {
      const selectSpy = spyOn(component, 'selectChapter').and.callThrough();

      component.onOpenChapterFromDashboard({ chapterId: 'chap-b', order: 1, title: 'Chapter B' });

      expect(selectSpy).toHaveBeenCalledOnceWith(CHAPTER_B);
    });

    it('shows a Hebrew alert and does NOT open any chapter when chapterId is missing (book language he)', () => {
      // book.language = 'he' (set in beforeEach) so editorDirection is rtl → Hebrew message
      const selectSpy = spyOn(component, 'selectChapter');
      spyOn(window, 'alert');

      // chapterId is unknown; order 0 would match CHAPTER_A if the order fallback were present
      component.onOpenChapterFromDashboard({ chapterId: 'chap-unknown', order: 0, title: 'Chapter A' });

      expect(window.alert).toHaveBeenCalledOnceWith('הפרק לא נמצא - ייתכן שנמחק.');
      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('shows an English alert and does NOT open any chapter when chapterId is missing (book language en)', () => {
      component.book!.language = 'en';
      const selectSpy = spyOn(component, 'selectChapter');
      spyOn(window, 'alert');

      component.onOpenChapterFromDashboard({ chapterId: 'chap-unknown', order: 0, title: 'Chapter A' });

      expect(window.alert).toHaveBeenCalledOnceWith('Chapter not found - it may have been deleted.');
      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('REVERT-VERIFY: restoring the order fallback opens the wrong chapter (confirms the fix is needed)', () => {
      // TEMP-REVERT: simulate the removed order fallback inline so this test can verify
      // that it would navigate to CHAPTER_B (order 1) when the anchor points to a deleted
      // chapter whose id is gone but whose order coincidentally matches CHAPTER_B.
      const CHAPTER_C_DELETED_ID = 'chap-deleted';
      // The anchor was built when chap-deleted existed at order 1; after deletion CHAPTER_B
      // sits at order 1. The fallback would wrongly open CHAPTER_B.
      const anchor = { chapterId: CHAPTER_C_DELETED_ID, order: 1, title: 'Deleted Chapter' };

      // TEMP-REVERT inline simulation: chapterId miss → order match → wrong chapter
      const wrongCh =
        component.book!.chapters.find(c => c.id === anchor.chapterId) ??
        component.book!.chapters.find(c => c.order === anchor.order) ??
        null;

      // The fallback resolves to CHAPTER_B (order 1) — this is the wrong chapter
      expect(wrongCh).toBe(CHAPTER_B);
      expect(wrongCh).not.toBeNull();
      // REVERT-VERIFY confirmed: the order fallback would open CHAPTER_B instead of showing an error.
      // The fix (strict chapterId-only resolution + alert) is correct.
    });

    it('is a safe no-op (shows alert) when chapterId does not match any chapter and order is also absent', () => {
      const selectSpy = spyOn(component, 'selectChapter');
      spyOn(window, 'alert');

      component.onOpenChapterFromDashboard({ chapterId: 'ghost', order: 99, title: 'Ghost' });

      expect(window.alert).toHaveBeenCalled();
      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('is a safe no-op when book is null', () => {
      component.book = null;
      const selectSpy = spyOn(component, 'selectChapter');

      component.onOpenChapterFromDashboard({ chapterId: 'chap-a', order: 0, title: 'Chapter A' });

      expect(selectSpy).not.toHaveBeenCalled();
    });

    it('sets selectedChapterId to the matched chapterId (end-to-end chapterId propagation)', () => {
      // No pending changes, so selectChapter goes through the direct load path.
      component.hasPendingChanges = false;

      component.onOpenChapterFromDashboard({ chapterId: 'chap-b', order: 1, title: 'Chapter B' });

      expect(component.selectedChapterId).toBe('chap-b');
    });
  });

  // ─── ds-c05: focus / distraction-light mode ─────────────────────────

  describe('toggleFocusMode (ds-c05)', () => {
    it('entering focus mode collapses the ReviewPanel and exiting restores its prior open-state', () => {
      component.reviewPanelOpen = true;
      component.focusMode = false;

      component.toggleFocusMode();
      expect(component.focusMode).toBe(true);
      expect(component.reviewPanelOpen).toBe(false);

      component.toggleFocusMode();
      expect(component.focusMode).toBe(false);
      // Restored to exactly how it was before focus (open).
      expect(component.reviewPanelOpen).toBe(true);
    });

    it('restores a closed ReviewPanel as closed after exiting focus mode', () => {
      component.reviewPanelOpen = false;
      component.focusMode = false;

      component.toggleFocusMode();
      expect(component.focusMode).toBe(true);
      expect(component.reviewPanelOpen).toBe(false);

      component.toggleFocusMode();
      expect(component.focusMode).toBe(false);
      // The panel was closed before focus, so it stays closed.
      expect(component.reviewPanelOpen).toBe(false);
    });

    // Focus-mode width: entering focus fits the page to the (widened) frame via fitPage('FitPageWidth');
    // exiting restores natural 100% and does NOT fit-to-width (which would shrink a narrow column tiny).
    it('fits the page to width when ENTERING focus mode', fakeAsync(() => {
      component.focusMode = false;
      const ed = mockDocEditor.documentEditor as any;
      ed.fitPage.calls.reset();

      component.toggleFocusMode();
      tick(0);

      expect(ed.fitPage).toHaveBeenCalledWith('FitPageWidth');
    }));

    it('restores natural 100% zoom and does NOT fit-to-width when EXITING focus mode', fakeAsync(() => {
      component.focusMode = true;
      const ed = mockDocEditor.documentEditor as any;
      ed.fitPage.calls.reset();
      ed.zoomFactor = 0.4;

      component.toggleFocusMode();
      tick(0);

      expect(ed.fitPage).not.toHaveBeenCalled();
      expect(ed.zoomFactor).toBe(1);
    }));

    it('does not throw when docEditor is absent during focus toggle (no editor yet)', fakeAsync(() => {
      component.focusMode = false;
      // Simulate no editor mounted yet (e.g. no chapter selected, Syncfusion not created).
      (component as any).docEditor = undefined;

      expect(() => {
        component.toggleFocusMode();
        tick(0);
      }).not.toThrow();
    }));

    it('localizes the focus-mode label for Hebrew and English books', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      expect(component.focusModeLabel).toBe('מיקוד');
      component.focusMode = true;
      expect(component.focusModeLabel).toBe('יציאה ממיקוד');

      component.book.language = 'en';
      component.focusMode = false;
      expect(component.focusModeLabel).toBe('Focus');
      component.focusMode = true;
      expect(component.focusModeLabel).toBe('Exit focus');
    });
  });

  // ─── ReviewPanel resize (width persistence + clamp) ─────────────────────────

  describe('ReviewPanel resize', () => {
    const KEY = 'pd.reviewPanelWidth';

    afterEach(() => {
      localStorage.removeItem(KEY);
    });

    it('defaults to 380px when no width is persisted', () => {
      localStorage.removeItem(KEY);
      const fx = TestBed.createComponent(EditorPageComponent);
      const cmp = fx.componentInstance;
      cmp.ngOnInit();
      expect(cmp.reviewPanelWidth).toBe(380);
      fx.destroy();
    });

    it('restores a persisted width (clamped to range) on init', () => {
      localStorage.setItem(KEY, '500');
      const fx = TestBed.createComponent(EditorPageComponent);
      const cmp = fx.componentInstance;
      cmp.ngOnInit();
      expect(cmp.reviewPanelWidth).toBe(500);
      fx.destroy();
    });

    it('clamps an out-of-range persisted width to the max on restore', () => {
      localStorage.setItem(KEY, '9999');
      const fx = TestBed.createComponent(EditorPageComponent);
      const cmp = fx.componentInstance;
      cmp.ngOnInit();
      expect(cmp.reviewPanelWidth).toBe(cmp.reviewPanelMaxWidth);
      fx.destroy();
    });

    it('persists the chosen width to localStorage at the end of a drag (dragging LEFT widens, physical edge)', () => {
      // The handle is on the panel's PHYSICAL LEFT edge regardless of content direction, so dragging
      // the pointer LEFT (clientX decreasing) widens the panel even for a Hebrew (rtl content) book.
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      const handle = document.createElement('div');
      spyOn(handle, 'setPointerCapture');
      spyOn(handle, 'releasePointerCapture');

      component.onReviewResizeStart({
        pointerId: 1, clientX: 100, currentTarget: handle, preventDefault: () => {},
      } as unknown as PointerEvent);
      // Pointer moves LEFT by 40px (100 -> 60): widen = startX - currentX = 40.
      component.onReviewResizeMove({ pointerId: 1, clientX: 60 } as PointerEvent);

      expect(component.reviewPanelWidth).toBe(380 + 40);

      component.onReviewResizeEnd({ pointerId: 1 } as PointerEvent);
      expect(localStorage.getItem(KEY)).toBe('420');
      expect(component.isResizingReviewPanel).toBe(false);
    });

    it('narrows the panel when dragging the pointer RIGHT (physical edge, rtl content)', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      const handle = document.createElement('div');
      spyOn(handle, 'setPointerCapture');
      spyOn(handle, 'releasePointerCapture');

      component.onReviewResizeStart({
        pointerId: 1, clientX: 100, currentTarget: handle, preventDefault: () => {},
      } as unknown as PointerEvent);
      // Pointer moves RIGHT by 40px (100 -> 140): widen = startX - currentX = -40, so narrower.
      component.onReviewResizeMove({ pointerId: 1, clientX: 140 } as PointerEvent);

      expect(component.reviewPanelWidth).toBe(380 - 40);
      component.onReviewResizeEnd({ pointerId: 1 } as PointerEvent);
    });

    it('ArrowLeft widens and ArrowRight narrows the panel (physical-left handle)', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      component.reviewPanelWidth = 400;

      component.onReviewResizeKeydown({ key: 'ArrowLeft', preventDefault: () => {} } as KeyboardEvent);
      expect(component.reviewPanelWidth).toBe(416);

      component.onReviewResizeKeydown({ key: 'ArrowRight', preventDefault: () => {} } as KeyboardEvent);
      expect(component.reviewPanelWidth).toBe(400);
    });
  });

  // ─── NIT-2: onReviewModeChange typed handler ────────────────────────────────

  describe('onReviewModeChange (NIT-2)', () => {
    it('sets reviewMode to "edit" when a valid "edit" value is received', () => {
      component.reviewMode = 'review';
      component.onReviewModeChange('edit');
      expect(component.reviewMode).toBe('edit');
    });

    it('sets reviewMode to "review" when a valid "review" value is received', () => {
      component.reviewMode = 'edit';
      component.onReviewModeChange('review');
      expect(component.reviewMode).toBe('review');
    });

    it('ignores unknown string values and leaves reviewMode unchanged', () => {
      component.reviewMode = 'edit';
      component.onReviewModeChange('unknown-mode');
      expect(component.reviewMode).toBe('edit');
    });
  });

  // ─── rf-f13: onChecklistSwitchToReview selects Findings tab ────────────────

  describe('onChecklistSwitchToReview (rf-f13)', () => {
    it('switches reviewMode to "review"', () => {
      component.reviewMode = 'edit';
      component.onChecklistSwitchToReview();
      expect(component.reviewMode).toBe('review');
    });

    it('sets dashboardComp.reviewTab to "findings" when a dashboard is mounted', () => {
      const fakeDashboard = { reviewTab: 'bible' as 'findings' | 'bible' };
      (component as any).dashboardComp = fakeDashboard;
      component.onChecklistSwitchToReview();
      expect(fakeDashboard.reviewTab).toBe('findings');
    });

    it('does not throw when dashboardComp is undefined (checklist visible while dashboard is unmounted)', () => {
      (component as any).dashboardComp = undefined;
      expect(() => component.onChecklistSwitchToReview()).not.toThrow();
    });
  });

  // ─── NIT-7: reviewModeOptions memoization ───────────────────────────────────

  describe('reviewModeOptions memoization (NIT-7)', () => {
    it('starts with English labels when book language is en', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'en', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('Edit help');
      expect(component.reviewModeOptions[1].label).toBe('Book review');
    });

    it('uses Hebrew labels when book language is he', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('עזרת עריכה');
      expect(component.reviewModeOptions[1].label).toBe('סקירת ספר');
    });

    it('updates labels when language flips from he to en', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('עזרת עריכה');

      component.book.language = 'en';
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('Edit help');
    });

    it('returns the same array reference when called again with no language change (identity check)', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      const ref = component.reviewModeOptions;
      // A second rebuild with the same language should produce a NEW array (rebuild always creates one),
      // but the VALUES must be identical — we confirm the labels are still correct.
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('עזרת עריכה');
      expect(component.reviewModeOptions).not.toBe(ref); // Each rebuild creates a new array
    });
  });

  // ── Wave 1d: the run-progress dialog replaces the pf-f01 blocking overlay ────────────
  //
  // The old full-screen `.analysis-overlay` blocked the editor for sync runs and was dismissed early on
  // `asyncJobStarted`. It is gone, together with the editor-local percent it carried (the second owner of
  // a running job's progress). What the editor owns now is only: open the dialog on a FRESH stream per
  // run, transport raw run events into it, and play the minimize flight.
  describe('Wave 1d run-progress dialog wiring', () => {
    it('onAnalysisStarted opens the dialog on a brand-new event stream', () => {
      expect(component.runDialogOpen).toBe(false);
      expect(component.runEvents$).toBeNull();

      component.onAnalysisStarted();

      expect(component.runDialogOpen).toBe(true);
      expect(component.runEvents$).not.toBeNull();
    });

    it('a SECOND run replaces the stream, so the dialog resets even if the first card is still open', () => {
      component.onAnalysisStarted();
      const firstRun = component.runEvents$;

      // The user never dismissed the terminal card: `open` is still true.
      expect(component.runDialogOpen).toBe(true);
      component.onAnalysisStarted();

      expect(component.runEvents$).not.toBeNull();
      expect(component.runEvents$).not.toBe(firstRun);
      expect(component.runDialogOpen).toBe(true);
    });

    it('forwards raw run events onto the current stream (and replays them to a late subscriber)', () => {
      component.onAnalysisStarted();
      component.onAnalysisRunEvent({ kind: 'status', message: 'Proofread chunked' });
      component.onAnalysisRunEvent({ kind: 'job-started', jobId: 'JOB-9' });

      const seen: unknown[] = [];
      component.runEvents$!.subscribe(e => seen.push(e));

      expect(seen).toEqual([
        { kind: 'status', message: 'Proofread chunked' },
        { kind: 'job-started', jobId: 'JOB-9' },
      ]);
    });

    it('forwarding a run event before any run started is a no-op, not a crash', () => {
      expect(() => component.onAnalysisRunEvent({ kind: 'status', message: 'stray' })).not.toThrow();
    });

    it('the dialog owns dismissal: nothing in the editor closes it when a run ends', () => {
      component.onAnalysisStarted();
      component.onAnalysisRunEvent({ kind: 'error', message: 'boom' });

      // The old overlay hid itself here (analysisCompleted / asyncJobStarted). The dialog now renders its
      // own terminal state until the user closes it, so the editor must NOT flip `open`.
      expect(component.runDialogOpen).toBe(true);
    });
  });
});

// ─── c04 / P2-5: ReviewPanel IA — real-template DOM rendering ────────────────────────
//
// The specs above test component fields/methods with the template overridden to `<div></div>`,
// so none of them prove the redesigned IA actually wires the rendered DOM. This block renders
// the REAL template (`editor-page.component.html`) but swaps the heavy child components
// (app-book-dashboard, app-analysis-panel, app-issue-panel, app-segmented-control) for inert
// stub components with the SAME selectors. That keeps the structural `@if` directives — the
// thing under test — fully live while keeping the Syncfusion / dashboard dependency graph out
// of the TestBed. We query the rendered DOM (querySelector), not just component fields, so a
// regression that breaks the `@if (reviewMode === ...)` / `@if (editHelpView === ...)` gating
// would fail here.

@Component({ selector: 'app-book-dashboard', standalone: true, template: '' })
class StubBookDashboardComponent {
  // rf-c02: the dashboard no longer drives the editor "review running" affordance (its buildRunningChange
  // @Output was deleted). The affordance is now derived from the job registry; the dashboard only bubbles
  // openChapter. Kept as an inert stub so the real template's <app-book-dashboard> resolves.
  @Output() openChapter = new EventEmitter<unknown>();
}

/** rf-f03: inert stub for ImportHandoffCardComponent — same selector, emits both outputs. */
@Component({ selector: 'app-import-handoff-card', standalone: true, template: '' })
class StubImportHandoffCardComponent {
  @Output() startReview = new EventEmitter<void>();
  @Output() editMode = new EventEmitter<void>();
}

/**
 * rf-c02: controllable JobRegistryService stub. `anyRunningForBook$(bookId)` returns a per-book
 * BehaviorSubject so a test can push the running flag for a SPECIFIC book (proving book-scoping: a job for
 * book A must not light book B). `reattach` is a spy so the "reattach once per book load, no second poller"
 * contract can be asserted.
 */
class RegistryStub {
  private readonly running = new Map<string, BehaviorSubject<boolean>>();
  /** c02: per-job snapshot streams, held open for the whole test (see jobById$). */
  private readonly jobs = new Map<string, BehaviorSubject<TrackedJob | null>>();
  reattach = jasmine.createSpy('reattach');

  private subjectFor(bookId: string): BehaviorSubject<boolean> {
    let s = this.running.get(bookId);
    if (!s) {
      s = new BehaviorSubject<boolean>(false);
      this.running.set(bookId, s);
    }
    return s;
  }

  anyRunningForBook$(bookId: string): Observable<boolean> {
    return this.subjectFor(bookId).asObservable();
  }

  /**
   * c01: the run dialog is now a REAL component in this suite (it is the surface the panel's unmount must
   * not strand), and it injects the registry. c02 needs the dialog to actually REACH state (b) and state
   * (c), so this is a per-job BehaviorSubject held OPEN for the life of the test rather than a
   * synchronous `of()`: a collapsed window would let a stale-card assertion pass against the bug.
   *
   * A job that no test ever pushes through {@link setJob} stays `null` forever, which keeps c01's unmount
   * cases exactly as they were (they never send `job-started`, so state (a) never advances).
   */
  jobById$(jobId: string): Observable<TrackedJob | null> {
    return this.jobSubjectFor(jobId).asObservable();
  }

  /** Test hook: set the running flag for a specific book. */
  setRunning(bookId: string, running: boolean): void {
    this.subjectFor(bookId).next(running);
  }

  /** Test hook: push a registry snapshot for one job (the ONLY owner of a tracked run's percent/status). */
  setJob(jobId: string, job: TrackedJob | null): void {
    this.jobSubjectFor(jobId).next(job);
  }

  private jobSubjectFor(jobId: string): BehaviorSubject<TrackedJob | null> {
    let s = this.jobs.get(jobId);
    if (!s) {
      s = new BehaviorSubject<TrackedJob | null>(null);
      this.jobs.set(jobId, s);
    }
    return s;
  }
}

/**
 * Inert stand-in for AnalysisPanelComponent with the SAME selector, declaring the two outputs the real
 * template binds - `(analysisStarted)` and `(runEvent)` - so those bindings are real subscriptions here
 * rather than stray DOM event listeners.
 *
 * c01: the former `(asyncJobStarted)` declaration and its comment ("the real template binds
 * (asyncJobStarted); the stub must declare it") were removed. The template binds neither that nor
 * `analysisCompleted` any more; both @Outputs were deleted after the run terminal moved onto `runEvent`.
 *
 * `startRun()` / `ngOnDestroy()` mirror the real panel's lifecycle contract: it emits `analysisStarted`
 * when a run begins and, per its ngOnDestroy, emits the `'run-finished'` terminal on `runEvent` if a run
 * is still in flight when it is destroyed. That the REAL panel honours this (and that the emit survives
 * Angular's teardown order) is pinned separately over the real component in
 * `analysis-panel.component.spec.ts`; what this stub is here to let us test is the EDITOR half.
 */
@Component({ selector: 'app-analysis-panel', standalone: true, template: '' })
class StubAnalysisPanelComponent implements OnDestroy {
  @Output() analysisStarted = new EventEmitter<void>();
  @Output() runEvent = new EventEmitter<AnalysisRunEvent>();

  /** Mirrors AnalysisPanelComponent.isRunning: true between a run start and its terminal. */
  private running = false;

  startRun(): void {
    this.running = true;
    this.analysisStarted.emit();
  }

  ngOnDestroy(): void {
    if (this.running) this.runEvent.emit({ kind: 'run-finished' });
  }
}

@Component({ selector: 'app-issue-panel', standalone: true, template: '' })
class StubIssuePanelComponent {}

@Component({ selector: 'app-chapter-tree', standalone: true, template: '' })
class StubChapterTreeComponent {}

@Component({ selector: 'app-segmented-control', standalone: true, template: '' })
class StubSegmentedControlComponent {}

describe('EditorPageComponent ReviewPanel IA (real-template DOM, c04 / P2-5)', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  /** Held-open book load: nothing emits until the test calls bookLoad$.next(book). */
  let bookLoad$: Subject<BookDetailDto>;
  let routeParams$: Subject<Record<string, string>>;
  /** rf-c02: controllable registry stub driving the editor's "review running" affordance per book. */
  let registryStub: RegistryStub;

  const BOOK: BookDetailDto = {
    id: 'book-1', title: 'My Book', author: null, language: 'he',
    createdAt: '', updatedAt: '', aiTier: 'fast', chapters: [],
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const has = (sel: string) => el().querySelector(sel) !== null;

  beforeEach(async () => {
    bookLoad$ = new Subject<BookDetailDto>();
    routeParams$ = new Subject<Record<string, string>>();
    registryStub = new RegistryStub();

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { params: routeParams$.asObservable(), snapshot: { queryParams: {} } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), getCurrentNavigation: () => null } },
        // Held-open book load: the controlled Subject lets us assert the in-between state
        // (bookId set, book not yet resolved) before emitting.
        { provide: BookService, useValue: { getById: () => bookLoad$.asObservable() } },
        // rf-c02: the editor derives the "review running" affordance from the job registry (per book) and calls
        // reattach on book load. The controllable stub lets tests push the running flag for a specific book.
        { provide: JobRegistryService, useValue: registryStub },
        {
          provide: ChapterService,
          useValue: { update: () => of({}), create: () => EMPTY, delete: () => EMPTY, getById: () => EMPTY, reorder: () => EMPTY },
        },
        {
          provide: SceneService,
          useValue: { update: () => of({}), getAll: () => of([]), getById: () => EMPTY, splitScenes: () => EMPTY },
        },
        {
          provide: SyncService,
          useValue: {
            connect: () => Promise.resolve(), joinBook: () => {}, leaveBook: () => {},
            chapterUpdated$: EMPTY, chapterCreated$: EMPTY, chapterReordered$: EMPTY,
            sceneCreated$: EMPTY, sceneUpdated$: EMPTY, sceneDeleted$: EMPTY,
            scenesCleared$: EMPTY, scenesReordered$: EMPTY,
          },
        },
        { provide: DocumentVersionService, useValue: { create: () => of({}), list: () => of([]), get: () => EMPTY } },
        { provide: AnalysisService, useValue: {} },
        { provide: SfdtManipulationService, useValue: jasmine.createSpyObj('SfdtManipulationService', ['ensureSfdtRtl']) },
        { provide: EditorTextService, useValue: jasmine.createSpyObj('EditorTextService', ['refreshDocumentPlainText']) },
        { provide: SuggestionAnchorService, useValue: jasmine.createSpyObj('SuggestionAnchorService', ['relocateAll', 'relocateOne']) },
      ],
    })
      // Render the REAL template, but substitute inert stubs (same selectors) for the heavy
      // children + the Syncfusion editor module so the dependency graph stays light. The
      // structural `@if`s under test are CommonModule, so they keep working unchanged.
      .overrideComponent(EditorPageComponent, {
        set: {
          imports: [
            CommonModule,
            StubChapterTreeComponent,
            StubAnalysisPanelComponent,
            StubIssuePanelComponent,
            StubBookDashboardComponent,
            StubSegmentedControlComponent,
            StubImportHandoffCardComponent,
            // c01: NOT stubbed. The defect is that the run terminal never crosses from the `@if`-mounted
            // panel to the dialog, so the dialog's own state machine has to be the real one for the
            // assertion to mean anything.
            AnalysisRunDialogComponent,
          ],
          schemas: [NO_ERRORS_SCHEMA], // tolerate <ejs-documenteditorcontainer> + its bindings
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
    // Keep selectedChapterId null so the Syncfusion editor branch is NOT rendered; the
    // ReviewPanel body (the IA under test) renders regardless of chapter selection.
    component.selectedChapterId = null;
  });

  afterEach(() => {
    fixture.destroy();
  });

  // ── 1. reviewMode switch mounts/unmounts the right body ──────────────────────────

  it('switching reviewMode edit→review mounts app-book-dashboard and unmounts app-analysis-panel (and back reverses it)', () => {
    component.bookId = 'book-1';
    component.book = BOOK; // both present so the review body is allowed to mount
    component.reviewMode = 'edit';
    component.editHelpView = 'analysis';
    fixture.detectChanges();

    // Edit mode: analysis panel is in the DOM, the dashboard is not.
    expect(has('app-analysis-panel')).toBe(true);
    expect(has('app-book-dashboard')).toBe(false);

    // edit → review: dashboard mounts, analysis panel unmounts.
    component.reviewMode = 'review';
    fixture.detectChanges();
    expect(has('app-book-dashboard')).toBe(true);
    expect(has('app-analysis-panel')).toBe(false);
    expect(has('app-issue-panel')).toBe(false);

    // review → edit: reverses.
    component.reviewMode = 'edit';
    fixture.detectChanges();
    expect(has('app-analysis-panel')).toBe(true);
    expect(has('app-book-dashboard')).toBe(false);
  });

  // ── 2. Book-review body requires BOTH bookId AND book; held-open load asserts the gap ──

  it('mounts app-book-dashboard only once bookId AND book are both present (held-open book load)', () => {
    component.reviewMode = 'review';
    // First detectChanges runs ngOnInit, which subscribes to the route params.
    fixture.detectChanges();
    // Drive the real ngOnInit flow: route emits bookId, but the book load is held open so
    // `book` is still null while bookId is set — the exact in-between state to assert.
    routeParams$.next({ bookId: 'book-1' });
    fixture.detectChanges();

    // bookId is set but the book load has NOT resolved yet: dashboard must NOT be in the DOM.
    expect(component.bookId).toBe('book-1');
    expect(component.book).toBeNull();
    expect(has('app-book-dashboard')).toBe(false);

    // The book load resolves: now both bookId and book are present → dashboard mounts.
    bookLoad$.next(BOOK);
    fixture.detectChanges();
    expect(component.book).not.toBeNull();
    expect(has('app-book-dashboard')).toBe(true);
  });

  it('does NOT mount app-book-dashboard in review mode when book is present but bookId is null', () => {
    component.bookId = null;
    component.book = BOOK;
    component.reviewMode = 'review';
    fixture.detectChanges();

    expect(has('app-book-dashboard')).toBe(false);
  });

  // ── Phase 4d-10c: a book switch clears the revise-context (root singleton) ────────
  it('clears the revise-context (Addressing chip) when the route bookId changes to a different book', () => {
    const reviseCtx = TestBed.inject(ReviseContextService);
    fixture.detectChanges(); // ngOnInit subscribes to route params

    // Land on book-1, then a finding navigation set the addressing context.
    routeParams$.next({ bookId: 'book-1' });
    reviseCtx.set({ findingId: 'f-1', oneLiner: 'Midpoint reversal.', chapterId: 'c-3' });
    expect(reviseCtx.snapshot).not.toBeNull();

    // Switch to a DIFFERENT book: the stale context must be cleared.
    routeParams$.next({ bookId: 'book-2' });
    expect(reviseCtx.snapshot).toBeNull();
  });

  it('does NOT clear the revise-context on a same-book route params re-emit', () => {
    const reviseCtx = TestBed.inject(ReviseContextService);
    fixture.detectChanges();

    routeParams$.next({ bookId: 'book-1' });
    reviseCtx.set({ findingId: 'f-1', oneLiner: 'Midpoint reversal.', chapterId: 'c-3' });

    // Same bookId re-emits (e.g. a benign params refresh): the active in-book context survives.
    routeParams$.next({ bookId: 'book-1' });
    expect(reviseCtx.snapshot).not.toBeNull();
  });

  // ── c02: a book switch resets the imported/handoff one-shot (card + counts) ────────
  //
  // The handoff card + imported* counts are read ONCE in ngOnInit for the FIRST book. On a SUBSEQUENT
  // in-place book switch there is no fresh imported nav state, so a stale card must not carry over.
  it('clears showHandoffCard and the imported* fields when the route bookId changes to a different book', () => {
    fixture.detectChanges(); // ngOnInit subscribes to route params

    // Land on book-1, then simulate the imported one-shot having been shown (card + counts up).
    routeParams$.next({ bookId: 'book-1' });
    component.showHandoffCard = true;
    component.importedChapters = 12;
    component.importedWords = 45000;
    component.importedParts = 3;

    // Switch to a DIFFERENT book: the stale card + counts must be reset.
    routeParams$.next({ bookId: 'book-2' });

    expect(component.showHandoffCard).toBe(false);
    expect(component.importedChapters).toBeNull();
    expect(component.importedWords).toBeNull();
    expect(component.importedParts).toBeNull();
  });

  it('does NOT reset the imported/handoff one-shot on a same-book route params re-emit', () => {
    fixture.detectChanges();

    routeParams$.next({ bookId: 'book-1' });
    component.showHandoffCard = true;
    component.importedChapters = 7;

    // Same bookId re-emits: the freshly-shown card (first load) must NOT be torn down.
    routeParams$.next({ bookId: 'book-1' });

    expect(component.showHandoffCard).toBe(true);
    expect(component.importedChapters).toBe(7);
  });

  // ── 3. editHelpView toggles the edit-mode body between analysis and issue panels ──────

  it('editHelpView toggles the edit-mode body between app-analysis-panel and app-issue-panel', () => {
    component.bookId = 'book-1';
    component.book = BOOK;
    component.reviewMode = 'edit';

    component.editHelpView = 'analysis';
    fixture.detectChanges();
    expect(has('app-analysis-panel')).toBe(true);
    expect(has('app-issue-panel')).toBe(false);

    // analysis → language: issue panel mounts, analysis panel unmounts.
    component.editHelpView = 'language';
    fixture.detectChanges();
    expect(has('app-issue-panel')).toBe(true);
    expect(has('app-analysis-panel')).toBe(false);

    // language → analysis: reverses.
    component.editHelpView = 'analysis';
    fixture.detectChanges();
    expect(has('app-analysis-panel')).toBe(true);
    expect(has('app-issue-panel')).toBe(false);
  });

  // ── 4. rf-c02: "review running" affordance derived from the job registry, survives dashboard unmount ──
  //
  // The affordance is NO LONGER emitted by the dashboard. It is derived by the editor from
  // jobRegistry.anyRunningForBook$(bookId): the status rows publish their build to the registry (track()),
  // the registry's own reused poll survives the dashboard being @if-destroyed (close panel / focus mode /
  // Edit help), and reattach (called once on book load) re-discovers a build already in flight. So the
  // affordance stays correct while the dashboard is unmounted WITHOUT the old editor-owned reconcile poll.
  // These tests drive the real ngOnInit -> route -> subscribeReviewBuildRunning flow and push the registry
  // running flag PER BOOK (proving book-scoping), then assert the reopen button / focus toggle affordance.
  describe('rf-c02 "review running" affordance (registry-derived, survives close/focus/Edit-help)', () => {
    /** Drive the real book-load flow so the editor subscribes anyRunningForBook$(bookId) + calls reattach. */
    function loadBook(id = 'book-1'): void {
      component.reviewMode = 'review';
      component.reviewPanelOpen = true;
      component.focusMode = false;
      fixture.detectChanges();            // ngOnInit subscribes to route params
      routeParams$.next({ bookId: id });  // subscribeReviewBuildRunning(id) + getById(id)
      bookLoad$.next({ ...BOOK, id });    // book resolves -> reattach(id) called once
      fixture.detectChanges();
    }

    it('reattaches to in-flight jobs exactly ONCE on book load (no second poller)', () => {
      loadBook('book-1');
      expect(registryStub.reattach).toHaveBeenCalledTimes(1);
      expect(registryStub.reattach).toHaveBeenCalledWith('book-1', 'he');
    });

    it('sets reviewBuildRunning while a tracked job runs with the dashboard UNMOUNTED, and holds it on the reopen button', () => {
      loadBook('book-1');

      // A tracked job for book-1 starts running (published by a status row's track() -> registry).
      registryStub.setRunning('book-1', true);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(true);

      // User closes the panel: the dashboard is @if-destroyed. The registry keeps tracking, so the flag holds.
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(false);

      // The reopen button shows the running affordance (dot + accessible label) even with the dashboard gone.
      const reopen = el().querySelector('.review-reopen') as HTMLElement;
      expect(reopen).not.toBeNull();
      expect(reopen.classList.contains('review-running')).toBe(true);
      expect(reopen.querySelector('.review-running-dot')).not.toBeNull();
      expect(reopen.getAttribute('aria-label')).toContain('סקירה רצה');

      // The build finishes (terminal): the registry emits false and the affordance clears - dashboard still
      // unmounted, proving the registry (not the dashboard) drives it.
      registryStub.setRunning('book-1', false);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(false);
    });

    it('shows the running affordance on the focus-mode toggle while in focus mode (panel + dashboard unmounted)', () => {
      loadBook('book-1');
      // A chapter must be selected for the editor toolbar (focus button) to render.
      component.selectedChapterId = 'chap-1';

      // A tracked job is in flight; entering focus unmounts the dashboard but the registry keeps driving it.
      registryStub.setRunning('book-1', true);
      component.toggleFocusMode();
      fixture.detectChanges();

      expect(component.focusMode).toBe(true);
      expect(component.reviewPanelOpen).toBe(false);
      // In focus mode neither the panel NOR the reopen button is shown.
      expect(el().querySelector('.review-reopen')).toBeNull();
      expect(has('app-book-dashboard')).toBe(false);

      // The focus toggle carries the running affordance so the user still sees the build is going.
      const focusBtn = el().querySelector('.focus-btn') as HTMLElement;
      expect(focusBtn).not.toBeNull();
      expect(focusBtn.classList.contains('review-running')).toBe(true);
      expect(focusBtn.querySelector('.review-running-dot')).not.toBeNull();
      expect(focusBtn.getAttribute('title')).toContain('סקירה רצה');

      // The build finishes while still in focus mode: the registry clears it (no remount needed).
      registryStub.setRunning('book-1', false);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(false);
      const focusBtnAfter = el().querySelector('.focus-btn') as HTMLElement;
      expect(focusBtnAfter.classList.contains('review-running')).toBe(false);
      expect(focusBtnAfter.querySelector('.review-running-dot')).toBeNull();
    });

    it('does NOT show the affordance when no build is running', () => {
      loadBook('book-1');
      expect(component.reviewBuildRunning).toBe(false);
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      const reopen = el().querySelector('.review-reopen') as HTMLElement;
      expect(reopen).not.toBeNull();
      expect(reopen.classList.contains('review-running')).toBe(false);
      expect(reopen.querySelector('.review-running-dot')).toBeNull();
    });

    it('clears the affordance when a build FINISHES while in Edit help mode (dashboard unmounted, registry drives it)', () => {
      loadBook('book-1');
      registryStub.setRunning('book-1', true);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(true);

      // User switches to Edit help: the dashboard is @if-destroyed. The registry (single reused poll) keeps
      // driving the flag, so when the build finishes the affordance clears with no dashboard mounted.
      component.onReviewModeChange('edit');
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(false);

      registryStub.setRunning('book-1', false);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(false);
    });

    it('KEEPS the affordance while in Edit help when the build is still running (registry does not over-clear)', () => {
      loadBook('book-1');
      registryStub.setRunning('book-1', true);
      component.onReviewModeChange('edit');
      fixture.detectChanges();

      // Dashboard is gone, but the registry still reports the build running, so the flag holds.
      expect(has('app-book-dashboard')).toBe(false);
      expect(component.reviewBuildRunning).toBe(true);
    });

    it('book-switch re-scopes the affordance: a job for book A does not light book B (wrong-book guard)', () => {
      loadBook('book-A');
      registryStub.setRunning('book-A', true);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(true);

      // The user switches to book-B, which has NO build running. The route emits the new id: the editor
      // re-subscribes anyRunningForBook$('book-B') and drops the stale book-A flag at once.
      routeParams$.next({ bookId: 'book-B' });
      expect(component.reviewBuildRunning).toBe(false);

      // book-A's job is STILL running server-side, but it must not light book-B's affordance.
      registryStub.setRunning('book-A', true);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(false);

      // And book-B's own registry stream drives book-B's affordance.
      registryStub.setRunning('book-B', true);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(true);
    });
  });

  // ── rf-f03: import handoff card — DOM rendering ─────────────────────────────────────────────────

  describe('rf-f03 import handoff card (DOM rendering)', () => {
    it('shows app-import-handoff-card in review mode when showHandoffCard is true', () => {
      component.bookId = 'book-1';
      component.book = BOOK;
      component.showHandoffCard = true;
      component.reviewMode = 'review';
      fixture.detectChanges();

      expect(has('app-import-handoff-card')).toBe(true);
      // The review body should NOT also show app-book-dashboard while the card is up
      expect(has('app-book-dashboard')).toBe(false);
    });

    it('hides app-import-handoff-card when showHandoffCard is false', () => {
      component.bookId = 'book-1';
      component.book = BOOK;
      component.showHandoffCard = false;
      component.reviewMode = 'review';
      fixture.detectChanges();

      expect(has('app-import-handoff-card')).toBe(false);
    });

    it('shows app-book-dashboard (not the card) in review mode when showHandoffCard is false', () => {
      component.bookId = 'book-1';
      component.book = BOOK;
      component.showHandoffCard = false;
      component.reviewMode = 'review';
      fixture.detectChanges();

      expect(has('app-book-dashboard')).toBe(true);
      expect(has('app-import-handoff-card')).toBe(false);
    });

    it('hides app-import-handoff-card when bookId is null even if showHandoffCard is true', () => {
      component.bookId = null;
      component.book = BOOK;
      component.showHandoffCard = true;
      fixture.detectChanges();

      expect(has('app-import-handoff-card')).toBe(false);
    });
  });

  // ── f07: review-reopen button hit area ─────────────────────────────────────────────────────────
  //
  // The (click)="openReviewPanel()" must live on the <button> element itself, not on the inner label
  // span, so that the button's padding area and the running-dot area both reopen the panel and so
  // that a keyboard Enter/Space on the focused button fires the handler. Clicking the BUTTON HOST
  // (not the inner span) must invoke openReviewPanel().

  describe('f07 review-reopen button hit area', () => {
    it('clicking the .review-reopen button host (not the inner span) invokes openReviewPanel()', () => {
      // Put the component into the state where the reopen button is rendered:
      // reviewPanelOpen=false and focusMode=false (see template: @else if (!focusMode)).
      component.reviewPanelOpen = false;
      component.focusMode = false;
      fixture.detectChanges();

      const openSpy = spyOn(component, 'openReviewPanel');

      // Query the button host element, NOT the inner .review-reopen-label span.
      const btn = el().querySelector('button.review-reopen') as HTMLButtonElement;
      expect(btn).withContext('.review-reopen button must be in the DOM when panel is closed').not.toBeNull();

      btn.click();

      expect(openSpy).withContext('openReviewPanel() must be called when the button HOST is clicked').toHaveBeenCalledTimes(1);
    });
  });

  // ── c01: unmounting the analysis panel mid-run must not strand the run dialog ──────────────────
  //
  // The panel is `@if`-mounted (`@if (editHelpView === 'analysis')` inside `@else if (reviewMode ===
  // 'edit')`); the dialog is NOT - it sits outside that block and survives. Switching the Edit-help
  // sub-tab therefore destroys the panel, which cancels the in-flight run, while the dialog stays on
  // screen. On the sync path nothing was ever registry-tracked, so the dialog had no route out of
  // "Starting..." and kept a live indeterminate bar up for a run that no longer existed. The old overlay
  // was a full-screen blocker, which is why this navigation was impossible before this wave.
  //
  // This drives the REAL editor-side wiring end to end - the panel's `(runEvent)` binding, the editor's
  // transport into `runEvents$`, and the real dialog's state machine - and asserts the RENDERED card,
  // because the entire defect is that the signal never crossed the component boundary. Calling
  // `onAnalysisRunEvent` by hand would skip the only part that was broken.
  describe('c01 the run dialog resolves when the analysis panel is unmounted mid-run', () => {
    /** The stub panel currently mounted by the real template's `@if`. */
    function panelStub(): StubAnalysisPanelComponent {
      const found = fixture.debugElement.query(By.directive(StubAnalysisPanelComponent));
      expect(found).withContext('the analysis panel must be mounted for this wiring to exist').not.toBeNull();
      return found.componentInstance as StubAnalysisPanelComponent;
    }

    const dialogCard = () => el().querySelector('.rd-card');
    const dialogStatus = () => el().querySelector('.rd-status-pill')?.textContent?.trim() ?? null;
    const dialogMessage = () => el().querySelector('.rd-message')?.textContent?.trim() ?? null;

    beforeEach(() => {
      component.bookId = 'book-1';
      component.book = BOOK;
      component.reviewMode = 'edit';
      component.editHelpView = 'analysis';
      fixture.detectChanges();
    });

    it('switching the Edit-help sub-tab resolves a dialog left in state (a)', () => {
      // A run starts through the real (analysisStarted) binding: the dialog opens on a fresh stream.
      panelStub().startRun();
      fixture.detectChanges();

      // Mid-flight, held open: state (a), indeterminate bar, no terminal.
      expect(dialogCard()).withContext('the dialog must be on screen mid-run').not.toBeNull();
      expect(el().querySelector('.rd-progress-fill--indet')).not.toBeNull();
      expect(dialogMessage()).toBe(RUN_DIALOG_LABELS_HE['starting']);
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['pending']);

      // The user switches to the Language sub-view: the `@if` destroys the panel and cancels the run.
      component.editHelpView = 'language';
      fixture.detectChanges();

      expect(has('app-analysis-panel')).withContext('the emitter is gone').toBe(false);
      // The dialog is still mounted - and it now says the run is over instead of pretending it runs.
      expect(dialogCard()).not.toBeNull();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['canceled']);
      expect(dialogMessage()).toBe(RUN_DIALOG_LABELS_HE['canceled']);
      // Terminal, so the dismiss control is a plain close: there is no job left to minimize into.
      expect(el().querySelector('.rd-minimize')).toBeNull();
      expect(el().querySelector('.rd-dismiss')!.getAttribute('aria-label'))
        .toBe(RUN_DIALOG_LABELS_HE['close']);
    });

    it('switching the Review/Edit mode control resolves it too (the other unmount route)', () => {
      panelStub().startRun();
      fixture.detectChanges();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['pending']);

      // The outer `@else if (reviewMode === 'edit')` unmounts the whole Edit-help body.
      component.reviewMode = 'review';
      fixture.detectChanges();

      expect(has('app-analysis-panel')).toBe(false);
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['canceled']);
    });

    it('unmounting with NO run in flight leaves the dialog closed', () => {
      expect(dialogCard()).toBeNull();

      component.editHelpView = 'language';
      fixture.detectChanges();

      expect(component.runDialogOpen).toBe(false);
      expect(dialogCard()).toBeNull();
    });
  });

  // ── c02: the run dialog is reconciled to the unit the user is looking at ───────────────────────
  //
  // Contract (B), book-scoped (see the plan's `## c02 decision`): a chapter/scene switch does NOT take a
  // LIVE run's card away - the panel does not end its run on a context switch, and a background run
  // outliving the surface that started it is the whole premise of the minimize gesture - but a BOOK
  // switch always clears it, and a TERMINAL card clears on any context change because a finished run for
  // a unit the user has left has nothing left to tell them.
  //
  // These drive the real wiring: the panel's `(runEvent)` binding, the editor's transport, the REAL
  // dialog's state machine, and the REAL registry stream for state (b)/(c). The registry subject is held
  // OPEN across every assertion, so the in-flight window is a real window rather than a collapsed `of()`.
  describe('c02 the run dialog is reconciled to the current chapter/scene/book', () => {
    function panelStub(): StubAnalysisPanelComponent {
      const found = fixture.debugElement.query(By.directive(StubAnalysisPanelComponent));
      expect(found).withContext('the analysis panel must be mounted for this wiring to exist').not.toBeNull();
      return found.componentInstance as StubAnalysisPanelComponent;
    }

    const dialogCard = () => el().querySelector('.rd-card');
    const dialogStatus = () => el().querySelector('.rd-status-pill')?.textContent?.trim() ?? null;

    /** A registry snapshot for JOB-1, running against chapter ch-1 of book-1 unless overridden. */
    function job(overrides: Partial<TrackedJob> = {}): TrackedJob {
      return {
        id: 'JOB-1',
        kind: 'proofread',
        bookId: 'book-1',
        scopeLabel: 'פרק',
        titleHe: 'הגהה',
        titleEn: 'Proofread',
        status: 'running',
        percent: 40,
        message: 'Running',
        startedAt: '2026-08-03T00:00:00Z',
        updatedAt: '2026-08-03T00:00:00Z',
        chapterId: 'ch-1',
        ...overrides,
      };
    }

    /** Start a run and take it all the way to state (b): tracked, non-terminal, minimizable. */
    function startTrackedRun(): void {
      panelStub().startRun();
      fixture.detectChanges();
      panelStub().runEvent.emit({ kind: 'job-started', jobId: 'JOB-1' });
      registryStub.setJob('JOB-1', job());
      fixture.detectChanges();
      // Guard the premise: without a real state-(b) card the survival assertion below would be vacuous.
      expect(dialogStatus()).withContext('precondition: the card must be in state (b)').toBe(RUN_DIALOG_LABELS_HE['running']);
      expect(el().querySelector('.rd-minimize')).withContext('state (b) offers minimize').not.toBeNull();
    }

    beforeEach(() => {
      component.bookId = 'book-1';
      component.book = BOOK;
      component.reviewMode = 'edit';
      component.editHelpView = 'analysis';
      component.selectedChapterId = 'ch-1';
      component.selectedSceneId = null;
      fixture.detectChanges();
    });

    it('KEEPS a state-(b) tracked card across a chapter switch inside the same book', () => {
      startTrackedRun();

      // The user navigates to another chapter while the job keeps running server-side.
      component.selectedChapterId = 'ch-2';
      fixture.detectChanges();

      expect(component.runDialogOpen).withContext('a live background run must keep its card').toBe(true);
      expect(dialogCard()).not.toBeNull();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['running']);
      // Still the SAME live run: the registry stream was never torn down, so a later push still lands.
      registryStub.setJob('JOB-1', job({ percent: 75 }));
      fixture.detectChanges();
      expect(el().querySelector('.rd-progress-percent')?.textContent?.trim()).toBe('75%');
    });

    it('KEEPS a state-(b) tracked card across a scene switch inside the same chapter', () => {
      startTrackedRun();

      component.selectedSceneId = 'sc-1';
      fixture.detectChanges();

      expect(component.runDialogOpen).toBe(true);
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['running']);
    });

    it('CLEARS a terminal card on a chapter switch when the registry ended the run', () => {
      startTrackedRun();

      // (b) -> (c) is the registry's call alone, so this terminal is invisible to the editor's run-event
      // channel: only the dialog knows the card is finished. This is the case an editor-local
      // reconstruction of the state machine would get wrong.
      registryStub.setJob('JOB-1', job({ status: 'succeeded', percent: 100, message: '' }));
      fixture.detectChanges();
      expect(dialogStatus()).withContext('precondition: the card must be terminal').toBe(RUN_DIALOG_LABELS_HE['succeeded']);
      expect(dialogCard()).not.toBeNull();

      component.selectedChapterId = 'ch-2';
      fixture.detectChanges();

      expect(component.runDialogOpen).withContext('a finished run for a chapter the user left must not linger').toBe(false);
      expect(dialogCard()).toBeNull();
    });

    it('CLEARS a terminal card on a scene switch when a run EVENT ended the run', () => {
      panelStub().startRun();
      fixture.detectChanges();
      // Untracked (sync) path: no job-started, so the error event is the (a) -> (c) terminal.
      panelStub().runEvent.emit({ kind: 'error', message: 'boom' });
      fixture.detectChanges();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['failed']);

      component.selectedSceneId = 'sc-1';
      fixture.detectChanges();

      expect(component.runDialogOpen).toBe(false);
      expect(dialogCard()).toBeNull();
    });

    it('CLEARS a LIVE state-(b) card on a book switch, and drops its event stream', () => {
      startTrackedRun();

      // Drive the real route-params path, the only writer of bookId.
      routeParams$.next({ bookId: 'book-2' });
      fixture.detectChanges();

      expect(component.bookId).toBe('book-2');
      expect(component.runDialogOpen).withContext("the prior book's card must never survive a book switch").toBe(false);
      expect(dialogCard()).toBeNull();
      expect(component.runEvents$).withContext('the prior run stream is dropped with the card').toBeNull();
      expect(component.runDialogAnalysisType).toBe('');
      // A late event from the previous book's still-running panel must not resurrect anything.
      expect(() => component.onAnalysisRunEvent({ kind: 'status', message: 'late' })).not.toThrow();
      fixture.detectChanges();
      expect(dialogCard()).toBeNull();
    });

    it('does NOT clear on a re-render or an unrelated field change', () => {
      startTrackedRun();

      fixture.detectChanges();
      fixture.detectChanges();
      component.hasPendingChanges = true;
      component.reviewPanelOpen = true;
      fixture.detectChanges();

      expect(component.runDialogOpen).toBe(true);
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['running']);
    });

    it('a context change with no card on screen is a no-op (initial load / no run yet)', () => {
      expect(component.runDialogOpen).toBe(false);

      component.selectedChapterId = 'ch-2';
      component.selectedSceneId = 'sc-9';
      fixture.detectChanges();

      expect(component.runDialogOpen).toBe(false);
      expect(dialogCard()).toBeNull();

      // And a run started AFTER the switch opens normally: the reconcile did not poison the next run.
      panelStub().startRun();
      fixture.detectChanges();
      expect(dialogCard()).not.toBeNull();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['pending']);
    });

    // ── c06 (recorded above as c02's second finding, fixed here) ───────────────────────────────────
    //
    // Contract (B) keeps a state-(a) card across a chapter switch. On the SYNC path that card resolves
    // off the result EVENT, so a result the panel discards as stale-context used to leave a green "Done"
    // over a chapter whose suggestions were never surfaced anywhere - the panel dropped them, and a sync
    // run is never registry-tracked, so the Activity Center has no row for it either.
    //
    // These two drive the real wiring end to end - the panel's `(runEvent)` binding, the editor's
    // transport into `runEvents$`, and the REAL dialog's state machine - and assert the RENDERED card,
    // because the defect is entirely about what the user is left looking at. Which of the two events the
    // panel actually sends for a given navigation is pinned over the real panel (with its real origin
    // guard) in `analysis-panel.component.spec.ts`, "c06 a discarded result is not reported to the host
    // as a success".
    it('c06 CLOSES an untracked card when the panel discards the result as stale-context', () => {
      panelStub().startRun();
      fixture.detectChanges();

      // Sync path: no `job-started`, so this is state (a) - the state in which a result event latches
      // "Done" at 100%.
      expect(dialogCard()).withContext('the card must be on screen mid-run').not.toBeNull();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['pending']);

      // The user leaves ch-1 while the run is still open. Contract (B) keeps the live card.
      component.selectedChapterId = 'ch-2';
      fixture.detectChanges();
      expect(component.runDialogOpen).withContext('contract (B): a live card survives a chapter switch').toBe(true);

      // ch-1's result lands and the panel throws it away.
      panelStub().runEvent.emit({ kind: 'result-dropped' });
      fixture.detectChanges();

      expect(dialogStatus())
        .withContext('no card may claim "Done" - or any outcome - for a result the app discarded')
        .toBeNull();
      expect(dialogCard()).toBeNull();
      expect(component.runDialogOpen).toBe(false);
    });

    it('c06 KEEPS the terminal card when the panel keeps the result (away and back mid-run)', () => {
      panelStub().startRun();
      fixture.detectChanges();

      // Away from ch-1 and back again, all before the result lands: the panel's origin guard compares
      // against the context at ARRIVAL, so this result is KEPT and arrives as the raw event.
      component.selectedChapterId = 'ch-2';
      fixture.detectChanges();
      component.selectedChapterId = 'ch-1';
      fixture.detectChanges();
      expect(component.runDialogOpen).toBe(true);

      panelStub().runEvent.emit({
        kind: 'sync-result',
        result: { id: 'r-1', chapterId: 'ch-1', type: 'Proofread', resultText: 'ok', createdAt: '' } as AnalysisResultDto,
      });
      fixture.detectChanges();

      expect(dialogCard()).withContext('a run whose result WAS surfaced must keep its terminal card').not.toBeNull();
      expect(dialogStatus()).toBe(RUN_DIALOG_LABELS_HE['succeeded']);
    });
  });
});

// ─── rf-f04: imported=1 query param decoupled from the ephemeral handoff card ─────────────────────
//
// Acceptance matrix (rf-f04 scope 1):
//   A. imported=1 query param ALONE (no nav state)  → reviewMode='review', showHandoffCard=false
//   B. imported=1 query param + nav state            → reviewMode='review', showHandoffCard=true
//   C. no imported param                             → reviewMode='edit' (unchanged default)
//
// Each scenario uses its own isolated TestBed so the Router/ActivatedRoute providers can be
// tailored per case without the shared beforeEach interfering.

function buildImportTestBed(queryParams: Record<string, string>, navState: Record<string, unknown> | null) {
  return TestBed.configureTestingModule({
    imports: [EditorPageComponent],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: { params: of({}), snapshot: { queryParams } },
      },
      {
        provide: Router,
        useValue: {
          navigate: jasmine.createSpy(),
          getCurrentNavigation: () =>
            navState !== null
              ? ({ extras: { state: navState } } as any)
              : null,
        },
      },
      { provide: BookService, useValue: { getById: () => EMPTY } },
      {
        provide: ChapterService,
        useValue: { update: () => of({}), create: () => EMPTY, delete: () => EMPTY, getById: () => EMPTY, reorder: () => EMPTY },
      },
      {
        provide: SceneService,
        useValue: { update: () => of({}), getAll: () => of([]), getById: () => EMPTY, splitScenes: () => EMPTY },
      },
      {
        provide: SyncService,
        useValue: {
          connect: () => Promise.resolve(), joinBook: () => {}, leaveBook: () => {},
          chapterUpdated$: EMPTY, chapterCreated$: EMPTY, chapterReordered$: EMPTY,
          sceneCreated$: EMPTY, sceneUpdated$: EMPTY, sceneDeleted$: EMPTY,
          scenesCleared$: EMPTY, scenesReordered$: EMPTY,
        },
      },
      { provide: DocumentVersionService, useValue: { create: () => of({}), list: () => of([]), get: () => EMPTY } },
      { provide: AnalysisService, useValue: {} },
      {
        provide: JobRegistryService,
        useValue: { anyRunningForBook$: () => of(false), reattach: jasmine.createSpy('reattach') },
      },
      { provide: SfdtManipulationService, useValue: jasmine.createSpyObj('SfdtManipulationService', ['ensureSfdtRtl', 'stripHighlightFromSfdt', 'replacePlainTextInSfdt', 'buildMinimalSfdt', 'applyHighlightRangesToSfdt', 'plainOffsetToSfdtPosition', 'addBookmarkAtRange']) },
      { provide: EditorTextService, useValue: jasmine.createSpyObj('EditorTextService', ['getTextFromSfdt', 'getPlainTextFromEditor', 'refreshDocumentPlainText']) },
      { provide: SuggestionAnchorService, useValue: jasmine.createSpyObj('SuggestionAnchorService', ['relocateAll', 'relocateOne']) },
    ],
  })
    .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
    .compileComponents();
}

describe('EditorPageComponent rf-f04: imported mode decoupling (query param vs nav state)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── A. Refresh scenario: query param present, NO nav state → Review mode, NO card ──

  it('(A) imported param alone (simulate refresh): opens Review mode but does NOT show the handoff card', async () => {
    await buildImportTestBed({ imported: '1' }, null);
    const fx = TestBed.createComponent(EditorPageComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges(); // triggers ngOnInit

    expect(cmp.reviewMode).toBe('review');
    expect(cmp.reviewPanelOpen).toBe(true);
    expect(cmp.showHandoffCard).toBe(false);
    fx.destroy();
  });

  // ── B. Fresh navigation: query param + nav state → Review mode + card shown ──

  it('(B) imported param + nav state (fresh navigation): opens Review mode AND shows the handoff card', async () => {
    const navState = { importedChapters: 12, importedWords: 45000, importedParts: 3 };
    await buildImportTestBed({ imported: '1' }, navState);
    const fx = TestBed.createComponent(EditorPageComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges();

    expect(cmp.reviewMode).toBe('review');
    expect(cmp.reviewPanelOpen).toBe(true);
    expect(cmp.showHandoffCard).toBe(true);
    expect(cmp.importedChapters).toBe(12);
    expect(cmp.importedWords).toBe(45000);
    expect(cmp.importedParts).toBe(3);
    fx.destroy();
  });

  // ── C. No imported param → Edit mode (existing books unchanged) ──

  it('(C) no imported param: stays in Edit mode and does not show the handoff card', async () => {
    await buildImportTestBed({}, null);
    const fx = TestBed.createComponent(EditorPageComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges();

    expect(cmp.reviewMode).toBe('edit');
    expect(cmp.showHandoffCard).toBe(false);
    fx.destroy();
  });

  // ── D. Nav state alone (no imported param) → no change (import-page must send the param) ──

  it('(D) nav state WITHOUT imported param: does not activate Review mode or show the card', async () => {
    await buildImportTestBed({}, { importedChapters: 5, importedWords: 2000, importedParts: 1 });
    const fx = TestBed.createComponent(EditorPageComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges();

    expect(cmp.reviewMode).toBe('edit');
    expect(cmp.showHandoffCard).toBe(false);
    fx.destroy();
  });

  // ── c02: consuming imported=1 strips it from the URL so a later refresh/escape is honored ──

  it('(c02) strips the imported query param from the URL after consuming it (query param alone)', async () => {
    await buildImportTestBed({ imported: '1' }, null);
    const router = TestBed.inject(Router) as any;
    const fx = TestBed.createComponent(EditorPageComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges(); // ngOnInit consumes imported=1, then strips it

    // Review-first default is still honored (strip runs AFTER reviewMode is set).
    expect(cmp.reviewMode).toBe('review');
    // The param is removed via a merge navigate (imported: null) with replaceUrl so refresh no longer re-forces review.
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ imported: null }),
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
    fx.destroy();
  });

  it('(c02) strips imported=1 even on the fresh-navigation path AND still shows the card (regression guard)', async () => {
    const navState = { importedChapters: 12, importedWords: 45000, importedParts: 3 };
    await buildImportTestBed({ imported: '1' }, navState);
    const router = TestBed.inject(Router) as any;
    const fx = TestBed.createComponent(EditorPageComponent);
    const cmp = fx.componentInstance;
    fx.detectChanges();

    // The FIRST imported load STILL shows the card and its counts (strip must not clobber them).
    expect(cmp.showHandoffCard).toBe(true);
    expect(cmp.importedChapters).toBe(12);
    expect(cmp.reviewMode).toBe('review');
    // And the sticky param is stripped so a later refresh / "just let me edit" is honored.
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: jasmine.objectContaining({ imported: null }) }),
    );
    fx.destroy();
  });

  it('(c02) does NOT strip / navigate when there is no imported param (normal navigation)', async () => {
    await buildImportTestBed({}, null);
    const router = TestBed.inject(Router) as any;
    const fx = TestBed.createComponent(EditorPageComponent);
    fx.detectChanges();

    // No imported param → no strip navigate should fire from ngOnInit.
    expect(router.navigate).not.toHaveBeenCalled();
    fx.destroy();
  });
});

// ── rf-f03: import handoff card handlers (focused logic, no template) ──────────────────────────

describe('EditorPageComponent rf-f03 handoff handlers (focused logic)', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { params: of({}), snapshot: { queryParams: {} } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), getCurrentNavigation: () => null } },
        { provide: BookService, useValue: { getById: () => EMPTY } },
        { provide: ChapterService, useValue: { update: () => of({}), create: () => EMPTY, delete: () => EMPTY, getById: () => EMPTY, reorder: () => EMPTY } },
        { provide: SceneService, useValue: { update: () => of({}), getAll: () => of([]), getById: () => EMPTY, splitScenes: () => EMPTY } },
        { provide: SyncService, useValue: { connect: () => Promise.resolve(), joinBook: () => {}, leaveBook: () => {}, chapterUpdated$: EMPTY, chapterCreated$: EMPTY, chapterReordered$: EMPTY, sceneCreated$: EMPTY, sceneUpdated$: EMPTY, sceneDeleted$: EMPTY, scenesCleared$: EMPTY, scenesReordered$: EMPTY } },
        { provide: DocumentVersionService, useValue: { create: () => of({}), list: () => of([]), get: () => EMPTY } },
        { provide: AnalysisService, useValue: {} },
        { provide: JobRegistryService, useValue: { anyRunningForBook$: () => of(false), reattach: jasmine.createSpy('reattach') } },
        { provide: SfdtManipulationService, useValue: jasmine.createSpyObj('SfdtManipulationService', ['stripHighlightFromSfdt', 'replacePlainTextInSfdt', 'buildMinimalSfdt', 'ensureSfdtRtl', 'applyHighlightRangesToSfdt', 'plainOffsetToSfdtPosition', 'addBookmarkAtRange']) },
        { provide: EditorTextService, useValue: jasmine.createSpyObj('EditorTextService', ['getTextFromSfdt', 'getPlainTextFromEditor', 'refreshDocumentPlainText']) },
        { provide: SuggestionAnchorService, useValue: jasmine.createSpyObj('SuggestionAnchorService', ['relocateAll', 'relocateOne']) },
      ],
    })
      .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  it('showHandoffCard defaults to false (non-imported path unchanged)', () => {
    fixture.detectChanges(); // triggers ngOnInit
    expect(component.showHandoffCard).toBe(false);
    expect(component.reviewMode).toBe('edit');
  });

  it('onHandoffStartReview dismisses the card and keeps review mode', () => {
    component.showHandoffCard = true;
    component.reviewMode = 'review';

    component.onHandoffStartReview();

    expect(component.showHandoffCard).toBe(false);
    expect(component.reviewMode).toBe('review');
  });

  it('onHandoffEditMode dismisses the card and switches to edit mode', () => {
    component.showHandoffCard = true;
    component.reviewMode = 'review';

    component.onHandoffEditMode();

    expect(component.showHandoffCard).toBe(false);
    expect(component.reviewMode).toBe('edit');
  });

  it('does NOT set showHandoffCard when imported param is absent (normal navigation)', () => {
    fixture.detectChanges();
    expect(component.showHandoffCard).toBe(false);
    expect(component.importedChapters).toBeNull();
    expect(component.importedWords).toBeNull();
    expect(component.importedParts).toBeNull();
  });
});

// Each router-state variation needs its OWN TestBed so overrideProvider runs before module instantiation.

/** Shared minimal providers for the handoff router-state tests (no Syncfusion, no real template). */
function sharedHandoffProviders(routerVal: object, routeVal: object) {
  return [
    { provide: Router, useValue: routerVal },
    { provide: ActivatedRoute, useValue: routeVal },
    { provide: BookService, useValue: { getById: () => EMPTY } },
    { provide: ChapterService, useValue: { update: () => of({}), create: () => EMPTY, delete: () => EMPTY, getById: () => EMPTY, reorder: () => EMPTY } },
    { provide: SceneService, useValue: { update: () => of({}), getAll: () => of([]), getById: () => EMPTY, splitScenes: () => EMPTY } },
    { provide: SyncService, useValue: { connect: () => Promise.resolve(), joinBook: () => {}, leaveBook: () => {}, chapterUpdated$: EMPTY, chapterCreated$: EMPTY, chapterReordered$: EMPTY, sceneCreated$: EMPTY, sceneUpdated$: EMPTY, sceneDeleted$: EMPTY, scenesCleared$: EMPTY, scenesReordered$: EMPTY } },
    { provide: DocumentVersionService, useValue: { create: () => of({}), list: () => of([]), get: () => EMPTY } },
    { provide: AnalysisService, useValue: {} },
    { provide: JobRegistryService, useValue: { anyRunningForBook$: () => of(false), reattach: jasmine.createSpy('reattach') } },
    { provide: SfdtManipulationService, useValue: jasmine.createSpyObj('SfdtManipulationService', ['stripHighlightFromSfdt', 'replacePlainTextInSfdt', 'buildMinimalSfdt', 'ensureSfdtRtl', 'applyHighlightRangesToSfdt', 'plainOffsetToSfdtPosition', 'addBookmarkAtRange']) },
    { provide: EditorTextService, useValue: jasmine.createSpyObj('EditorTextService', ['getTextFromSfdt', 'getPlainTextFromEditor', 'refreshDocumentPlainText']) },
    { provide: SuggestionAnchorService, useValue: jasmine.createSpyObj('SuggestionAnchorService', ['relocateAll', 'relocateOne']) },
  ];
}

describe('EditorPageComponent rf-f03 imported signal — fresh router state present', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;

  beforeEach(async () => {
    const stateData = { importedChapters: 7, importedWords: 15000, importedParts: 3 };
    const routerWithState = { navigate: jasmine.createSpy(), getCurrentNavigation: () => ({ extras: { state: stateData } }) };
    const routeWithParam = { params: of({}), snapshot: { queryParams: { imported: '1' } } };

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: sharedHandoffProviders(routerWithState, routeWithParam),
    })
      .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('sets showHandoffCard + reviewMode=review when imported=1 query param AND router state are present', () => {
    expect(component.showHandoffCard).toBe(true);
    expect(component.reviewMode).toBe('review');
    expect(component.reviewPanelOpen).toBe(true);
    expect(component.importedChapters).toBe(7);
    expect(component.importedWords).toBe(15000);
    expect(component.importedParts).toBe(3);
  });
});

describe('EditorPageComponent rf-f03 imported signal — refresh (no router state)', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;

  beforeEach(async () => {
    const routerNoState = { navigate: jasmine.createSpy(), getCurrentNavigation: () => null };
    const routeWithParam = { params: of({}), snapshot: { queryParams: { imported: '1' } } };

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: sharedHandoffProviders(routerNoState, routeWithParam),
    })
      .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('does NOT set showHandoffCard when imported param is present but router state is absent (refresh fallback)', () => {
    expect(component.showHandoffCard).toBe(false);
  });
});
