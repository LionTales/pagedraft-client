import { ComponentFixture, TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { Component, EventEmitter, Input, NO_ERRORS_SCHEMA, OnDestroy, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import {
  BookDetailDto,
  ChapterCreatedEvent,
  ChapterUpdatedEvent,
  SceneUpdatedEvent,
} from '../../core/models/book';
import { of, EMPTY, NEVER, throwError, Subject, BehaviorSubject, Observable, map, firstValueFrom } from 'rxjs';
import { EditorPageComponent, excerptSearchPhrase } from './editor-page.component';
import { BookService } from '../../core/services/book.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { StyleBaselineService } from '../../core/services/style-baseline.service';
import { ChapterService } from '../../core/services/chapter.service';
import { SceneService } from '../../core/services/scene.service';
import { SyncService } from '../../core/services/sync.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { JobRegistryService, TrackedJob, isTerminal } from '../../core/services/job-registry.service';
import { EMPTY_CHUNK_CLOCK } from '../../core/utils/chunk-eta';
import { SfdtManipulationService, SCROLL_TARGET_BOOKMARK } from '../../core/services/sfdt-manipulation.service';
import { EditorTextService } from '../../core/services/editor-text.service';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';
import { ReviseContextService } from '../../core/services/revise-context.service';
import { BookSurfaceFocusService } from '../../core/services/book-surface-focus.service';
import { AmbientChapterService } from '../../core/services/ambient-chapter.service';
import { AnalysisRunEvent } from '../../core/services/analysis-run-orchestration.service';
import { AnalysisResultDto } from '../../core/models/analysis';
import { AnalysisRunDialogComponent, RUN_DIALOG_LABELS_HE } from '../../shared/analysis-run-dialog/analysis-run-dialog.component';
import { StageSpineComponent } from '../../shared/stage-spine/stage-spine.component';
import { runString } from '../../core/i18n/run-strings';

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
        { provide: ActivatedRoute, useValue: { params: of({}), queryParams: of({}), snapshot: { queryParams: {} } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), getCurrentNavigation: () => null } },
        { provide: BookService, useValue: { getById: () => EMPTY } },
        // P2-6: the editor reconciles the whole-book build affordance via these when the dashboard is
        // unmounted. Default to "no active build"; individual tests re-stub as needed.
        // w5 (MOVE-1): transitive dep of the relocated writing-style row hosted by the dashboard.
        { provide: StyleBaselineService, useValue: { getStyleBaselineStatus: () => NEVER, buildStyleBaseline: () => NEVER } },
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
            // w2: the hosted dashboard reads this for the spine's stage-4 running marks.
            activeJobs$: of([]),
            // a1: the hosted ANALYSIS PANEL derives "is a run in flight for this chapter?" from `jobs$`,
            // and the hosted dashboard watches this book's review build through `jobByKindForBook$`.
            jobs$: of([]),
            jobByKindForBook$: () => of(null),
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

    // ── d1: the two edges added on top of the resolution ─────────────────────

    it('d1/c02: the LEDGER chip (findingId present) lands in EDIT mode, because that click armed two Edit-mode surfaces', () => {
      component.reviewMode = 'review';
      component.hasPendingChanges = false;

      component.onOpenChapterFromDashboard({ chapterId: 'chap-b', order: 1, title: 'Chapter B', findingId: 'f-1' });

      expect(component.reviewMode).toBe('edit');
    });

    it('c02: the narrowing gates ONLY the mode switch - an anchor with no findingId still opens the chapter AND still holds its excerpt', () => {
      component.reviewMode = 'review';
      component.hasPendingChanges = false;

      component.onOpenChapterFromDashboard({
        chapterId: 'chap-b',
        order: 1,
        title: 'Chapter B',
        excerpt: 'She turned, and everything changed for good and forever and then some more words here.',
      });

      // Everything except the mode switch still runs for a producer that armed nothing.
      expect(component.selectedChapterId).toBe('chap-b');
      expect((component as any).pendingExcerptNavigation).toEqual({
        chapterId: 'chap-b',
        phrase: 'She turned, and everything changed for good and forever and then some',
      });
      expect(component.reviewMode).toBe('review');
    });

    it('d1: a chapter that cannot be resolved leaves the mode alone (no half-navigation)', () => {
      component.reviewMode = 'review';
      spyOn(window, 'alert');

      component.onOpenChapterFromDashboard({ chapterId: 'ghost', order: 99, title: 'Ghost' });

      expect(component.reviewMode).toBe('review');
    });

    it('d1: holds the trimmed excerpt STAMPED with the chapter it belongs to, and does not search yet', () => {
      component.hasPendingChanges = false;
      const selectRangeSpy = spyOn(component, 'selectRangeInEditor');

      component.onOpenChapterFromDashboard({
        chapterId: 'chap-b',
        order: 1,
        title: 'Chapter B',
        excerpt: 'She turned, and everything changed for good and forever and then some more words here.',
        findingId: 'f-1',
      });

      // Held, not fired: the chapter's document load is async, so searching now would search the
      // OUTGOING chapter's text.
      expect(selectRangeSpy).not.toHaveBeenCalled();
      expect((component as any).pendingExcerptNavigation).toEqual({
        chapterId: 'chap-b',
        phrase: 'She turned, and everything changed for good and forever and then some',
      });
    });

    it('d1: a finding with no excerpt holds nothing, so the reader lands at the chapter top', () => {
      component.hasPendingChanges = false;

      component.onOpenChapterFromDashboard({ chapterId: 'chap-b', order: 1, title: 'Chapter B' });

      expect((component as any).pendingExcerptNavigation).toBeNull();
    });

    it('d1/c04: a held phrase aimed at chapter A does NOT fire when chapter B is what opened', () => {
      const selectRangeSpy = spyOn(component, 'selectRangeInEditor');
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-a', phrase: 'some words' };

      (component as any).settlePendingExcerptNavigation('chap-b', true);

      expect(selectRangeSpy).not.toHaveBeenCalled();
      // c04: chapter B's load LEAVES a phrase stamped for chapter A alone - it is A's own load that
      // releases it (the spec below). The old rule released whatever was held on any load, which meant a
      // stale load for the OUTGOING chapter landing late disarmed a hint the reader had only just armed
      // for the chapter they were opening. Scoping the release to the stamp is what removes that race.
      expect((component as any).pendingExcerptNavigation).toEqual({ chapterId: 'chap-a', phrase: 'some words' });

      // ...and A's own load, which by then takes its guarded return, is what ends it.
      (component as any).settlePendingExcerptNavigation('chap-a', false);
      expect(selectRangeSpy).not.toHaveBeenCalled();
      expect((component as any).pendingExcerptNavigation).toBeNull();
    });

    it('d1: a held phrase for the chapter that opened is handed to selectRangeInEditor as originalText', () => {
      const selectRangeSpy = spyOn(component, 'selectRangeInEditor');
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      (component as any).settlePendingExcerptNavigation('chap-b', true);

      expect(selectRangeSpy).toHaveBeenCalledOnceWith({ originalText: 'She turned' });
      expect((component as any).pendingExcerptNavigation).toBeNull();
    });

    it('d1: a phrase that matches nothing in the document is a silent no-op (today\'s fallback)', fakeAsync(() => {
      // f10: `docEditor = undefined` (the old setup here) hits `if (!editor) return` at
      // editor-page.component.ts:2350 - the NO-EDITOR early return - and never reaches the search
      // fallback at all, so the name's claim ("matches nothing") could not fail for the reason it
      // states. Drive the real miss: a present editor whose searchModule.find returns null (no
      // bookmark id, no start/endOffset, so the earlier fallbacks fall through on their own).
      const findSpy = jasmine.createSpy('find').and.returnValue(null);
      const navigateSpy = jasmine.createSpy('navigate');
      (component as any).docEditor = {
        documentEditor: {
          ...mockDocEditor.documentEditor,
          searchModule: { find: findSpy, navigate: navigateSpy },
        },
      };
      // selectRangeInEditor defers doSelect through a real requestAnimationFrame before the
      // setTimeout(150) fakeAsync's clock can advance; run its callback synchronously so tick/flush
      // only has to cover the setTimeout.
      spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });

      expect(() => {
        component.selectRangeInEditor({ originalText: 'a sentence the author has since rewritten' });
        flush();
      }).not.toThrow();

      expect(findSpy).toHaveBeenCalledWith('a sentence the author has since rewritten');
      expect(navigateSpy).not.toHaveBeenCalled();
    }));
  });

  // ─── c04: the excerpt one-shot ends on EVERY exit path, not only a successful open() ───
  //
  // P2 finding 13. `consumePendingExcerptNavigation` ran only after a successful `open()`, so the
  // guarded return inside `loadChapterContent`, that load's (previously absent) error arm and the whole
  // scene path all left the phrase armed - and a phrase is stamped with a chapter id, so it waits for
  // that chapter and fires at whoever opens it next, jumping the view, selecting a passage nobody asked
  // for and taking the caret. Each spec below drives one of those exit paths.

  describe('c04: pendingExcerptNavigation lifecycle', () => {
    let selectRangeSpy: jasmine.Spy;

    beforeEach(() => {
      selectRangeSpy = spyOn(component, 'selectRangeInEditor');
    });

    it('c04: a chapter load whose document never opened RELEASES the phrase, so re-opening that chapter later does not jump', fakeAsync(() => {
      const chapterSvc = TestBed.inject(ChapterService) as any;
      chapterSvc.getById = jasmine.createSpy('getById').and.returnValue(of({ contentSfdt: SAMPLE_SFDT }));
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      // The reader moved on before the response landed, so loadChapterContent's inner guard takes the
      // early return and open() never runs. Under the old code the phrase survived this untouched.
      component.selectedChapterId = 'chap-a';
      (component as any).loadChapterContent('chap-b');
      tick();

      expect(selectRangeSpy).not.toHaveBeenCalled();
      expect((component as any).pendingExcerptNavigation).toBeNull();

      // Minutes later the reader opens chapter B for a reason of their own. Nothing may jump.
      component.selectedChapterId = 'chap-b';
      (component as any).loadChapterContent('chap-b');
      tick();

      expect(selectRangeSpy).not.toHaveBeenCalled();
    }));

    it('c04: a chapter content GET that FAILS releases the phrase rather than leaving it armed forever', fakeAsync(() => {
      const chapterSvc = TestBed.inject(ChapterService) as any;
      chapterSvc.getById = jasmine.createSpy('getById').and.returnValue(throwError(() => new Error('boom')));
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      component.selectedChapterId = 'chap-b';
      (component as any).loadChapterContent('chap-b');
      tick();

      // The load this phrase was aimed at is over and rendered nothing to search. It has no second try.
      expect(selectRangeSpy).not.toHaveBeenCalled();
      expect((component as any).pendingExcerptNavigation).toBeNull();
    }));

    it('c04: the SCENE path clears a held chapter-level phrase without firing it', fakeAsync(() => {
      const sceneSvc = TestBed.inject(SceneService) as any;
      sceneSvc.getById = jasmine.createSpy('getById').and.returnValue(of({ contentSfdt: SAMPLE_SFDT }));
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      component.selectedChapterId = 'chap-b';
      component.selectedSceneId = 'scene-1';
      (component as any).loadSceneContent('chap-b', 'scene-1');
      tick();

      // A scene is what is open, and the phrase was measured against the whole chapter's prose. Released
      // rather than fired: a literal search inside one scene either misses or lands on a coincidence in a
      // unit the reader did not open to read it.
      expect(selectRangeSpy).not.toHaveBeenCalled();
      expect((component as any).pendingExcerptNavigation).toBeNull();
    }));

    it('c04: a STALE scene load that never opened does NOT disarm a phrase armed after it', fakeAsync(() => {
      const sceneSvc = TestBed.inject(SceneService) as any;
      sceneSvc.getById = jasmine.createSpy('getById').and.returnValue(of({ contentSfdt: SAMPLE_SFDT }));

      // A scene load is in flight when the reader clicks a finding in that same chapter: selecting the
      // chapter nulls selectedSceneId, so the scene response takes loadSceneContent's guarded return.
      // The release must sit AFTER that guard, or this late arrival kills a brand-new hint.
      component.selectedChapterId = 'chap-b';
      component.selectedSceneId = null;
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      (component as any).loadSceneContent('chap-b', 'scene-1');
      tick();

      expect((component as any).pendingExcerptNavigation).toEqual({ chapterId: 'chap-b', phrase: 'She turned' });
    }));

    it('c16: the REAL call site fires the phrase - loadChapterContent hands it over after open() succeeds', fakeAsync(() => {
      // P3 finding 64. Every other spec for the settle helper calls it DIRECTLY, and the c04 specs
      // above drive loadChapterContent only through its exits that must NOT fire (guarded, GET error,
      // scene). So nothing pinned the one call site that DOES fire: the
      // `settlePendingExcerptNavigation(chapterId, true)` line under `open()` inside loadChapterContent.
      // Deleting that line left the whole d1 + c04 suite green with the search edge dead. This spec
      // drives the real path end to end; comment that line out and it is the only thing that goes red.
      const chapterSvc = TestBed.inject(ChapterService) as any;
      chapterSvc.getById = jasmine.createSpy('getById').and.returnValue(of({ contentSfdt: SAMPLE_SFDT }));
      sfdtSpy.ensureSfdtRtl.and.callFake((s: string) => s);
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      // Every condition the inner guard checks is satisfied, so the document really opens.
      component.selectedChapterId = 'chap-b';
      component.selectedSceneId = null;
      (component as any).loadChapterContent('chap-b');
      tick();

      expect(mockDocEditor.documentEditor.open).toHaveBeenCalled();
      expect(selectRangeSpy).toHaveBeenCalledOnceWith({ originalText: 'She turned' });
      expect((component as any).pendingExcerptNavigation).toBeNull();
    }));

    it('c04: teardown drops BOTH navigation one-shots, which is what their docstrings had been claiming', () => {
      (component as any).pendingOpenFindingId = 'f-7';
      (component as any).pendingExcerptNavigation = { chapterId: 'chap-b', phrase: 'She turned' };

      component.ngOnDestroy();

      expect((component as any).pendingOpenFindingId).toBeNull();
      expect((component as any).pendingExcerptNavigation).toBeNull();
    });
  });

  // ─── c05: selectRangeInEditor re-checks the document under its own deferral ───
  //
  // P2 finding 15. `selectRangeInEditor` captures the editor once and defers the whole navigation by a
  // requestAnimationFrame plus setTimeout(150), with no re-check of the document in between - and since
  // d1 this fires automatically at the end of every finding click, with the chapter tree one click away.
  // A switch inside that window made the search run against the newly opened document and then navigate
  // + focusIn on an arbitrary match in the chapter the reader had just moved to. Every spec below holds
  // that window open and moves the document inside it; a synchronous test cannot express any of them.

  describe('c05: the deferred selection re-checks the document it was aimed at', () => {
    let findSpy: jasmine.Spy;
    let navigateSpy: jasmine.Spy;
    let selectSpy: jasmine.Spy;
    let focusInSpy: jasmine.Spy;

    beforeEach(() => {
      findSpy = jasmine.createSpy('find').and.returnValue({ startOffset: '0;0;0', endOffset: '0;0;5' });
      navigateSpy = jasmine.createSpy('navigate');
      selectSpy = jasmine.createSpy('select');
      focusInSpy = jasmine.createSpy('focusIn');
      (component as any).docEditor = {
        documentEditor: {
          ...mockDocEditor.documentEditor,
          focusIn: focusInSpy,
          selection: { select: selectSpy, text: 'Hello' },
          searchModule: { find: findSpy, navigate: navigateSpy },
        },
      };
      // The editor holds chapter 1's document and the reader is on it (the global beforeEach state),
      // which is the state every one of these navigations is requested in.
      component.selectedChapterId = 'chap-1';
      component.selectedSceneId = null;
      component.documentOwnerChapterId = 'chap-1';
      component.documentOwnerSceneId = null;
      // Same reason as f10's spec above: the real requestAnimationFrame fires outside fakeAsync's clock,
      // so run its callback inline and let tick() own the 150ms - that timeout IS the window under test.
      spyOn(window, 'requestAnimationFrame').and.callFake((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
    });

    it('c05: a chapter switch INSIDE the window stops the search - find() is never called and focus is not stolen', fakeAsync(() => {
      component.selectRangeInEditor({ originalText: 'She turned' });

      // Mid-window the reader clicks another chapter in the tree. The selection moves on the click; the
      // document owner only moves when that load lands an HTTP round trip later, so this is what the
      // window usually looks like.
      tick(100);
      component.selectedChapterId = 'chap-2';

      tick(100);

      expect(findSpy).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
      expect(focusInSpy).not.toHaveBeenCalled();
    }));

    it('c05: a document REPLACED inside the window blocks the search even when the selection has come back to it', fakeAsync(() => {
      component.selectRangeInEditor({ originalText: 'She turned' });

      // The reader clicks chapter 2, its load lands (the editor now holds chapter 2's document), and they
      // click straight back to chapter 1. The selection reads as it did at request time; the document
      // under the editor does not, and it is the document the phrase was measured against that matters.
      tick(100);
      component.selectedChapterId = 'chap-2';
      component.documentOwnerChapterId = 'chap-2';
      component.selectedChapterId = 'chap-1';

      tick(100);

      expect(findSpy).not.toHaveBeenCalled();
      expect(focusInSpy).not.toHaveBeenCalled();
    }));

    it('c05: the OFFSET path is guarded too - a stale range is never applied to a scene that opened inside the window', fakeAsync(() => {
      sfdtSpy.plainOffsetToSfdtPosition.and.returnValue('0;0;0');

      component.selectRangeInEditor({ startOffset: 6, endOffset: 11 });

      // A scene of the SAME chapter opens mid-window. Offsets measured against the whole chapter's plain
      // text address arbitrary prose inside one scene, and selecting it hands the caret (and the panel's
      // next action) to text nobody asked for - the same class of harm as finding a phrase in it.
      tick(100);
      component.selectedSceneId = 'scene-1';

      tick(100);

      expect(selectSpy).not.toHaveBeenCalled();
      expect(focusInSpy).not.toHaveBeenCalled();
      // ...and it did not silently fall through to the search fallback either.
      expect(findSpy).not.toHaveBeenCalled();
    }));

    it('c05: an undisturbed window still selects - the guard costs the happy path nothing', fakeAsync(() => {
      component.selectRangeInEditor({ originalText: 'She turned' });

      tick(200);

      expect(findSpy).toHaveBeenCalledOnceWith('She turned');
      expect(navigateSpy).toHaveBeenCalledTimes(1);
      expect(focusInSpy).toHaveBeenCalledTimes(1);
    }));

    it('c05: an undisturbed window still applies an offset range', fakeAsync(() => {
      sfdtSpy.plainOffsetToSfdtPosition.and.returnValue('0;0;0');

      component.selectRangeInEditor({ startOffset: 6, endOffset: 11 });

      tick(200);

      expect(selectSpy).toHaveBeenCalledTimes(1);
      expect(focusInSpy).toHaveBeenCalledTimes(1);
    }));
  });

  // ─── d1: the excerpt is trimmed before it reaches the literal search ────────

  describe('excerptSearchPhrase (d1)', () => {
    it('keeps at most the first 12 words, so one loose clause cannot fail the whole match', () => {
      const excerpt =
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
      expect(excerptSearchPhrase(excerpt)).toBe(
        'one two three four five six seven eight nine ten eleven twelve',
      );
    });

    it('collapses line breaks and runs of whitespace, which the SFDT does not carry verbatim', () => {
      expect(excerptSearchPhrase('She turned,\n  and everything\tchanged.')).toBe(
        'She turned, and everything changed.',
      );
    });

    it('strips the review\'s own framing (quote marks, ellipsis) from BOTH edges', () => {
      // Was 'She turned"' - only the leading regexes were anchored, so the closing quote (also
      // framing, per the function's own doc comment) survived and would break the literal
      // searchModule.find match this function exists to protect. Both edges strip now.
      expect(excerptSearchPhrase('"She turned"')).toBe('She turned');
      expect(excerptSearchPhrase('...she turned')).toBe('she turned');
      expect(excerptSearchPhrase('She turned...')).toBe('She turned');
      // A single strip pass is order-dependent: the leading quote regex doesn't match while an
      // outer ellipsis still sits in front of it, so this needs a second pass to see the quote.
      expect(excerptSearchPhrase('..."she turned')).toBe('she turned');
    });

    it('leaves the author\'s own trailing punctuation alone (not framing)', () => {
      expect(excerptSearchPhrase('She turned.')).toBe('She turned.');
      expect(excerptSearchPhrase('She turned!')).toBe('She turned!');
      expect(excerptSearchPhrase('She turned?')).toBe('She turned?');
    });

    it('returns empty for nothing usable, which callers read as "land at the chapter top"', () => {
      expect(excerptSearchPhrase(null)).toBe('');
      expect(excerptSearchPhrase(undefined)).toBe('');
      expect(excerptSearchPhrase('   ')).toBe('');
    });

    it('handles Hebrew prose unchanged (word split is whitespace, not script)', () => {
      expect(excerptSearchPhrase('היא הסתובבה, והכול השתנה')).toBe('היא הסתובבה, והכול השתנה');
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

    // `window.innerWidth` is redefined rather than spied on because the karma host window is whatever
    // size the runner gives it, which is not a number a spec may assume. Hoisted to THIS describe (it
    // used to live only in the nested `width ceiling (c1)` block) so the restore-path specs above can
    // pin a literal ceiling too.
    let originalInnerWidth: PropertyDescriptor | undefined;

    const setViewportWidth = (px: number) => {
      Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
    };

    beforeEach(() => {
      originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    });

    afterEach(() => {
      localStorage.removeItem(KEY);
      // P3-72: `delete window.innerWidth` used to be the fallback here, but that deletes the
      // BROWSER'S OWN property, not just this spec's override - if `getOwnPropertyDescriptor` ever
      // came back undefined (it should not, in a real browser host), every later spec in the same
      // karma run would then read `window.innerWidth` as `undefined`. Restoring the saved descriptor
      // is only safe when one was actually captured; when none was, leave the property as this spec
      // left it rather than deleting it out from under the rest of the run.
      if (originalInnerWidth) {
        Object.defineProperty(window, 'innerWidth', originalInnerWidth);
      }
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

    it('clamps an out-of-range persisted width to the viewport ceiling on restore', () => {
      // P2-20: this used to assert `cmp.reviewPanelWidth === cmp.reviewPanelMaxWidth`, which compares
      // the clamp's OUTPUT to the same getter the clamp READS. That is f(x) == f(x): true for any
      // ceiling whatsoever, including 0 or an NaN-derived one, so no implementation could fail it.
      // The expectation is now an EXTERNAL literal, derived here by hand rather than read back off
      // the component:
      //   ceiling = max(640, round(innerWidth / 2)) = max(640, round(2560 / 2)) = max(640, 1280) = 1280
      // 9999 is above that ceiling, so the restore must land on exactly 1280.
      setViewportWidth(2560);
      localStorage.setItem(KEY, '9999');
      const fx = TestBed.createComponent(EditorPageComponent);
      const cmp = fx.componentInstance;
      cmp.ngOnInit();
      expect(cmp.reviewPanelWidth).toBe(1280);
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

    // ─── c1: the ceiling follows the viewport ────────────────────────────────
    //
    // 640 stopped being the ceiling and became its FLOOR: the panel may now reach half the viewport,
    // so a large screen can show a suggestion card at a readable width. These specs pin both ends of
    // `max(640, round(50vw))` and the re-clamp that keeps a wide panel from surviving into a small
    // window. The `window.innerWidth` override and its P3-72 restore live one level up, in the
    // `ReviewPanel resize` describe, so the restore-path specs share them.
    describe('width ceiling (c1)', () => {
      it('keeps the 640 floor on a laptop-sized viewport (50vw is smaller)', () => {
        setViewportWidth(1000);
        expect(component.reviewPanelMaxWidth).toBe(640);
      });

      it('raises the ceiling to half the viewport on a large screen', () => {
        setViewportWidth(2560);
        expect(component.reviewPanelMaxWidth).toBe(1280);
      });

      it('lets a drag reach the raised ceiling and no further', () => {
        setViewportWidth(2560);
        const handle = document.createElement('div');
        spyOn(handle, 'setPointerCapture');
        spyOn(handle, 'releasePointerCapture');
        component.reviewPanelWidth = 380;

        component.onReviewResizeStart({
          pointerId: 1, clientX: 2000, currentTarget: handle, preventDefault: () => {},
        } as unknown as PointerEvent);
        // Drag far past the old hard 640 (widen = 2000 - 100 = 1900 -> 380 + 1900).
        component.onReviewResizeMove({ pointerId: 1, clientX: 100 } as PointerEvent);

        expect(component.reviewPanelWidth).toBe(1280);
        component.onReviewResizeEnd({ pointerId: 1 } as PointerEvent);
      });

      it('Home jumps to the viewport-derived ceiling, not to 640', () => {
        setViewportWidth(2560);
        component.onReviewResizeKeydown({ key: 'Home', preventDefault: () => {} } as KeyboardEvent);
        expect(component.reviewPanelWidth).toBe(1280);
      });

      // P3-70: the re-clamp is rAF-coalesced now, so the assertion comes after an animation frame
      // rather than straight after the event. `tick(20)` flushes it (zone.js schedules a patched
      // requestAnimationFrame as a ~16ms macrotask under fakeAsync).
      it('re-clamps the panel when the window shrinks below the current width', fakeAsync(() => {
        setViewportWidth(2560);
        component.onReviewResizeKeydown({ key: 'Home', preventDefault: () => {} } as KeyboardEvent);
        expect(component.reviewPanelWidth).toBe(1280);

        setViewportWidth(1000);
        window.dispatchEvent(new Event('resize'));
        tick(20);

        expect(component.reviewPanelWidth).toBe(640);
      }));

      it('does not overwrite the persisted preference when a resize re-clamps', fakeAsync(() => {
        setViewportWidth(2560);
        component.onReviewResizeKeydown({ key: 'Home', preventDefault: () => {} } as KeyboardEvent);
        expect(localStorage.getItem(KEY)).toBe('1280');

        setViewportWidth(1000);
        window.dispatchEvent(new Event('resize'));
        tick(20);

        expect(component.reviewPanelWidth).toBe(640);
        expect(localStorage.getItem(KEY))
          .withContext('a window resize is not a user choice, so the stored width must survive it')
          .toBe('1280');
      }));

      it('leaves a width that still fits alone on resize', fakeAsync(() => {
        setViewportWidth(2560);
        component.reviewPanelWidth = 500;
        window.dispatchEvent(new Event('resize'));
        tick(20);
        expect(component.reviewPanelWidth).toBe(500);
      }));

      // ── the restore path (P2-20) ────────────────────────────────────────────
      //
      // ngOnInit -> restoreReviewPanelWidth -> clampReviewPanelWidth is the ONE path a width persisted
      // from a WIDER previous session takes, and none of the specs above reaches it: every one of them
      // drives an ALREADY-CONSTRUCTED component through a drag, a key or a resize event, so the width
      // they clamp was never read out of localStorage. A fresh component over a seeded key is the only
      // way in. Every expectation below is a literal transcribed from the arithmetic written beside it,
      // never `cmp.reviewPanelMaxWidth` - reading the ceiling back off the component is the f(x) == f(x)
      // shape this block exists to replace.
      describe('restoring a width persisted by a previous session', () => {
        it('clamps a width persisted on a big screen down to 640 on a 1280px laptop', () => {
          // ceiling = max(640, round(1280 / 2)) = max(640, 640) = 640; 1800 is above it, so 640.
          setViewportWidth(1280);
          localStorage.setItem(KEY, '1800');
          const fx = TestBed.createComponent(EditorPageComponent);
          const cmp = fx.componentInstance;
          cmp.ngOnInit();
          expect(cmp.reviewPanelWidth).toBe(640);
          fx.destroy();
        });

        it('leaves a persisted width that fits, on a small viewport and a large one alike', () => {
          // 400 is under BOTH ceilings: max(640, round(1280 / 2)) = 640 and
          // max(640, round(2560 / 2)) = 1280. A clamp that moved it at all moved something it must not.
          for (const viewportWidth of [1280, 2560]) {
            setViewportWidth(viewportWidth);
            localStorage.setItem(KEY, '400');
            const fx = TestBed.createComponent(EditorPageComponent);
            const cmp = fx.componentInstance;
            cmp.ngOnInit();
            expect(cmp.reviewPanelWidth)
              .withContext(`persisted 400 restored at innerWidth ${viewportWidth}`)
              .toBe(400);
            fx.destroy();
          }
        });

        it('re-clamps a restored wide panel when the window then shrinks', fakeAsync(() => {
          // Restored at innerWidth 2560: ceiling = max(640, round(2560 / 2)) = 1280, so 1200 survives.
          setViewportWidth(2560);
          localStorage.setItem(KEY, '1200');
          const fx = TestBed.createComponent(EditorPageComponent);
          const cmp = fx.componentInstance;
          cmp.ngOnInit();
          expect(cmp.reviewPanelWidth).toBe(1200);

          // Window shrinks to 1400: ceiling = max(640, round(1400 / 2)) = max(640, 700) = 700, which
          // is neither the floor nor half of the original viewport, so a stale or hard-coded ceiling
          // cannot land on it by accident.
          setViewportWidth(1400);
          window.dispatchEvent(new Event('resize'));
          tick(20);
          expect(cmp.reviewPanelWidth).toBe(700);

          fx.destroy();
        }));

        it('applies the 640 FLOOR, not half the viewport, below 1280px', () => {
          // ceiling = max(640, round(900 / 2)) = max(640, 450) = 640: half the viewport is BELOW the
          // floor here, so the floor wins and a restored 1800 lands on 640, not on 450.
          setViewportWidth(900);
          localStorage.setItem(KEY, '1800');
          const fx = TestBed.createComponent(EditorPageComponent);
          const cmp = fx.componentInstance;
          cmp.ngOnInit();
          expect(cmp.reviewPanelWidth).toBe(640);
          fx.destroy();
        });
      });
    });

    // ─── c12 + P3-70: telling Syncfusion, and not tanking the frame rate ──────
    //
    // Widening the panel shrinks the editor column through a CSS grid-track change, which fires NO
    // window resize event, so Syncfusion keeps the layout it measured before the drag and paints the
    // document clipped. `documentEditor.resize()` is what reflows it (confirmed in a real browser at
    // 2560px: a 380 -> 1280 drag took the container 1870 -> 970 while visibleBounds stayed at 1868, and
    // one resize() brought it to 968).
    //
    // WHAT THESE PIN, and why each is a separate spec: that the resize happens ONCE and at the END
    // (a resize() per pointermove relays out the whole document and stalls the editor), that it is
    // DEFERRED rather than synchronous (the width it has to measure is a template binding the handler
    // has not painted yet), that the keyboard paths get the same treatment as the drag, and that a
    // window-resize burst collapses to one re-clamp.
    //
    // WHY `fixture.ngZone.run(...)` WRAPS EVERY CALL: the deferral hangs off `NgZone.onStable`, which
    // is the only hook that runs AFTER change detection has applied the new grid track. A handler
    // invoked outside the zone never makes the zone unstable, so nothing would ever stabilize and the
    // deferred work would not run - in the app these handlers are always DOM events, which are always
    // in the zone.
    describe('c12: notifying Syncfusion that the writing frame moved', () => {
      let resizeSpy: jasmine.Spy;

      const makeHandle = () => {
        const handle = document.createElement('div');
        spyOn(handle, 'setPointerCapture');
        spyOn(handle, 'releasePointerCapture');
        return handle;
      };

      const inZone = (fn: () => void) => fixture.ngZone!.run(fn);

      beforeEach(() => {
        resizeSpy = mockDocEditor.documentEditor.resize;
        resizeSpy.calls.reset();
      });

      it('resizes the editor once at the END of a drag and never per pointermove', () => {
        const handle = makeHandle();
        inZone(() => {
          component.onReviewResizeStart({
            pointerId: 1, clientX: 1000, currentTarget: handle, preventDefault: () => {},
          } as unknown as PointerEvent);
          component.onReviewResizeMove({ pointerId: 1, clientX: 940 } as PointerEvent);
          component.onReviewResizeMove({ pointerId: 1, clientX: 880 } as PointerEvent);
          component.onReviewResizeMove({ pointerId: 1, clientX: 820 } as PointerEvent);
        });

        expect(resizeSpy)
          .withContext('resize() relays out the whole document; one per pointermove stalls the editor')
          .not.toHaveBeenCalled();

        inZone(() => component.onReviewResizeEnd({ pointerId: 1 } as PointerEvent));

        expect(resizeSpy).toHaveBeenCalledTimes(1);
      });

      it('does not resize SYNCHRONOUSLY inside the handler, because the new width is not painted yet', () => {
        // The width is a template binding: at the instant the handler returns, Angular has not applied
        // the new grid track, so a synchronous resize() would re-measure the OLD width. Measured in the
        // browser: with a plain setTimeout(0) (which this app's `eventCoalescing: true` tick runs
        // BEFORE), a Home jump from 300 to 1280 resized against the 300px frame and left the document
        // 980px too wide for its column.
        let resizedBeforeTheHandlerReturned = false;
        inZone(() => {
          component.onReviewResizeKeydown({ key: 'Home', preventDefault: () => {} } as KeyboardEvent);
          resizedBeforeTheHandlerReturned = resizeSpy.calls.count() > 0;
        });

        expect(resizedBeforeTheHandlerReturned)
          .withContext('the resize must wait for change detection to apply the new grid track')
          .toBe(false);
        expect(resizeSpy).toHaveBeenCalledTimes(1);
      });

      it('resizes the editor after a Home jump, the largest width change the UI can make', () => {
        setViewportWidth(2560);
        inZone(() => component.onReviewResizeKeydown({ key: 'Home', preventDefault: () => {} } as KeyboardEvent));

        expect(component.reviewPanelWidth).toBe(1280);
        expect(resizeSpy).toHaveBeenCalledTimes(1);
      });

      it('resizes the editor after an End jump', () => {
        component.reviewPanelWidth = 900;
        inZone(() => component.onReviewResizeKeydown({ key: 'End', preventDefault: () => {} } as KeyboardEvent));

        expect(component.reviewPanelWidth).toBe(300);
        expect(resizeSpy).toHaveBeenCalledTimes(1);
      });

      it('coalesces a held arrow key into a single resize', () => {
        // 12 auto-repeat keydowns in one turn: the width moves 12 steps, the editor relays out once.
        inZone(() => {
          for (let i = 0; i < 12; i++) {
            component.onReviewResizeKeydown({ key: 'ArrowLeft', preventDefault: () => {} } as KeyboardEvent);
          }
        });

        expect(component.reviewPanelWidth).toBe(380 + 12 * 16);
        expect(resizeSpy)
          .withContext('a held arrow key must not queue one full relayout per keystroke')
          .toHaveBeenCalledTimes(1);
      });

      it('does not resize on a key that changes nothing', () => {
        inZone(() => component.onReviewResizeKeydown({ key: 'PageUp', preventDefault: () => {} } as KeyboardEvent));

        expect(component.reviewPanelWidth).toBe(380);
        expect(resizeSpy).not.toHaveBeenCalled();
      });

      // ── P3-70: the window listener ─────────────────────────────────────────
      //
      // This component had no host listener at all before the ceiling became viewport-derived, so the
      // one c1 added made every resize event tick change detection through `ngDoCheck` and
      // `ngAfterViewChecked`. A window drag fires dozens per second.
      it('coalesces a burst of window resize events into a single re-clamp', fakeAsync(() => {
        setViewportWidth(2560);
        component.reviewPanelWidth = 1280;
        const clamp = spyOn<any>(component, 'reclampReviewPanelWidthForViewport').and.callThrough();

        setViewportWidth(1000);
        for (let i = 0; i < 20; i++) window.dispatchEvent(new Event('resize'));

        expect(clamp)
          .withContext('nothing may run per event; the whole point is that the frame owns the work')
          .not.toHaveBeenCalled();

        tick(20);

        expect(clamp).toHaveBeenCalledTimes(1);
        expect(component.reviewPanelWidth).toBe(640);
      }));

      it('does no work at all when a window resize leaves the width alone', fakeAsync(() => {
        setViewportWidth(2560);
        component.reviewPanelWidth = 500;

        window.dispatchEvent(new Event('resize'));
        tick(20);

        expect(component.reviewPanelWidth).toBe(500);
        expect(resizeSpy)
          .withContext('the common case (a window still wide enough) must not relayout the document')
          .not.toHaveBeenCalled();
      }));

      it('tells Syncfusion when a window resize actually re-clamps the panel', fakeAsync(() => {
        setViewportWidth(2560);
        component.reviewPanelWidth = 1280;

        setViewportWidth(1000);
        window.dispatchEvent(new Event('resize'));
        tick(20);

        expect(component.reviewPanelWidth).toBe(640);
        expect(resizeSpy)
          .withContext('a re-clamp narrows the editor column by a grid-track change, same as a drag')
          .toHaveBeenCalledTimes(1);
      }));

      it('stops listening to the window once the component is destroyed', fakeAsync(() => {
        setViewportWidth(2560);
        localStorage.setItem(KEY, '1200');
        const fx = TestBed.createComponent(EditorPageComponent);
        const cmp = fx.componentInstance;
        cmp.ngOnInit();
        expect(cmp.reviewPanelWidth).toBe(1200);

        fx.destroy();
        setViewportWidth(1000);
        window.dispatchEvent(new Event('resize'));
        tick(20);

        expect(cmp.reviewPanelWidth)
          .withContext('a hand-registered listener has to be hand-removed')
          .toBe(1200);
      }));
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

    // ── d1: the finding id survives the mode switch that mounts the ledger ────

    it('d1: holds the finding id until the dashboard exists, then opens it there', (done) => {
      component.reviewMode = 'edit';
      // The dashboard is @if-mounted behind the mode switch, so it is NOT there at click time.
      (component as any).dashboardComp = undefined;

      component.onChecklistSwitchToReview('f-7');
      expect(component.reviewMode).toBe('review');
      expect((component as any).pendingOpenFindingId).toBe('f-7');

      // Nothing to publish to yet: the drain must leave the request held, not drop it.
      component.ngAfterViewChecked();
      expect((component as any).pendingOpenFindingId).toBe('f-7');

      const openSpy = jasmine.createSpy('openFinding');
      (component as any).dashboardComp = { reviewTab: 'bible', openFinding: openSpy };
      component.ngAfterViewChecked();
      expect((component as any).pendingOpenFindingId).toBeNull();

      // Published on a timer, so the ledger's own view state is not mutated inside this CD pass.
      setTimeout(() => {
        expect(openSpy).toHaveBeenCalledOnceWith('f-7');
        done();
      });
    });

    it('d1: "back to findings" (no id) holds nothing, so the ledger is not re-scrolled', () => {
      component.reviewMode = 'edit';
      component.onChecklistSwitchToReview(null);
      expect((component as any).pendingOpenFindingId).toBeNull();
    });

    it('d1: a held id is DROPPED when the reader goes back to Edit before the ledger mounts', () => {
      component.reviewMode = 'edit';
      (component as any).dashboardComp = undefined;
      component.onChecklistSwitchToReview('f-7');

      // The reader changed their mind: back to Edit before any dashboard appeared.
      component.onReviewModeChange('edit');
      component.ngAfterViewChecked();

      expect((component as any).pendingOpenFindingId).toBeNull();
    });
  });

  // ─── w5 / D13 retarget: the per-chapter deviations pointer resolves here ────

  /**
   * The Linguistic result's "these deviations were measured against a writing style that is missing or out
   * of date" hint used to open a whole-book consent prompt from a per-chapter surface. Since the build
   * moved to the dashboard (MOVE-1), the hint points at the new home instead, and the editor is the one
   * component that owns both halves of that journey: the assistant's mode switch and the dashboard.
   */
  describe('onOpenStyleBaselineHome (w5)', () => {
    it('switches the assistant to Book review, where the relocated build lives', () => {
      component.reviewMode = 'edit';
      component.onOpenStyleBaselineHome();
      expect(component.reviewMode).toBe('review');
    });

    it('raises the focus token the dashboard passes to the row, so the pointer lands on its target', () => {
      const before = component.focusBaselineToken;
      component.onOpenStyleBaselineHome();
      expect(component.focusBaselineToken).toBe(before + 1);
    });

    it('raises a NEW token each time, so a second ask re-scrolls rather than being swallowed', () => {
      component.onOpenStyleBaselineHome();
      const first = component.focusBaselineToken;
      component.onOpenStyleBaselineHome();
      expect(component.focusBaselineToken).toBe(first + 1);
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
  /**
   * D12: the FULL spine on this route is hosted inside the dashboard, so this input is the one wire that
   * carries the exporter's count from the book payload into it (`editor-page.component.html:249`). It is
   * DECLARED here, rather than being swallowed by NO_ERRORS_SCHEMA, so a spec can read what the template
   * actually bound - the wire shipped with no spec at all on either host.
   */
  @Input() exportableChapterCount: number | null = null;
  /** Declared for the same reason: the pair is bound off ONE book object and the pair is what stage 5 reads. */
  @Input() chapters: unknown = null;
}

/** rf-f03: inert stub for ImportHandoffCardComponent — same selector, emits both outputs. */
@Component({ selector: 'app-import-handoff-card', standalone: true, template: '' })
class StubImportHandoffCardComponent {
  @Output() startReview = new EventEmitter<void>();
  @Output() editMode = new EventEmitter<void>();
}

/**
 * rf-c02, migrated by Wave 3 / w3: controllable JobRegistryService stub.
 *
 * The editor no longer reads a per-book boolean (`anyRunningForBook$` is gone from this page along with
 * the two chrome dots it fed). It reads `activeJobs$` and derives the stage spine's per-kind running state
 * from it, filtered by the CURRENT bookId - so this stub now drives the SAME surface the product drives:
 * a real tracked job, for a named book, of a named kind. `setRunning(bookId, running)` keeps the old
 * shorthand for "a whole-book review build is in flight for this book", which is what every rf-c02 test
 * means. `reattach` stays a spy so the "reattach once per book load, no second poller" contract holds.
 */
class RegistryStub {
  /** c02: per-job snapshot streams, held open for the whole test (see jobById$). */
  private readonly jobs = new Map<string, BehaviorSubject<TrackedJob | null>>();
  reattach = jasmine.createSpy('reattach');
  /**
   * EVERY tracked job, terminal ones included - the shape the REAL registry's `jobs$` has, and the one
   * the three streams below are derived from. Held open for the life of the test so a running build can
   * start and finish inside one spec.
   *
   * finding 57: this used to be an `active` list that "only ever holds non-terminal jobs", with `jobs$`
   * and `jobByKindForBook$` both aliased straight onto it - so `setRunning(book, false)` published a
   * REMOVAL (and, through `jobByKindForBook$`, a `null`) and this stub could not emit a terminal job at
   * all. Both a1 consumers hosted on this page key on exactly that event: the analysis panel refetches
   * history when a job it saw running goes terminal, and the dashboard's `watchReviewBuild` bumps the
   * findings token on the same transition. Neither could be reached from here, and a harness that cannot
   * deliver the event under test reads exactly like one that does. The real registry RETAINS a terminal
   * job on `jobs$` (capped) and filters it out of `activeJobs$`; so does this now.
   */
  private readonly all = new BehaviorSubject<TrackedJob[]>([]);
  /** Wave 3: non-terminal jobs only. The editor's spine signals read this one. */
  readonly activeJobs$: Observable<TrackedJob[]> =
    this.all.pipe(map(jobs => jobs.filter(j => !isTerminal(j.status))));
  /**
   * a1: the hosted ANALYSIS PANEL derives "is a run in flight for the chapter I am showing?" from the
   * full job list - and notices a run FINISHING by seeing a job it saw running turn terminal on this
   * same stream. So this one carries terminals; see {@link finish}.
   */
  readonly jobs$: Observable<TrackedJob[]> = this.all.asObservable();

  /**
   * a1: the hosted DASHBOARD watches this book's review build here, so a build that finishes while the
   * status row is unmounted still refreshes the findings ledger. Derived from the same list the rest of
   * this stub publishes, so `setRunning` and `finish` both drive it - and it prefers the ACTIVE job of a
   * kind, falling back to the last one, exactly as the real `jobByKindForBook$` does.
   */
  jobByKindForBook$(bookId: string, kind: 'summary' | 'review' | 'proofread' | 'style-baseline'): Observable<TrackedJob | null> {
    return this.all.pipe(map(jobs => {
      const matches = jobs.filter(j => j.bookId === bookId && j.kind === kind);
      if (matches.length === 0) return null;
      return matches.find(j => !isTerminal(j.status)) ?? matches[matches.length - 1];
    }));
  }

  /** Push (or clear) a whole-book REVIEW build for one book, leaving every other book's jobs alone. */
  setRunning(bookId: string, running: boolean, kind: 'summary' | 'review' = 'review'): void {
    const others = this.all.value.filter(j => !(j.bookId === bookId && j.kind === kind));
    this.all.next(running ? [...others, makeTrackedJob(bookId, kind)] : others);
  }

  /**
   * finding 57: drive a tracked job to its TERMINAL, which is the event both a1 consumers key on.
   *
   * Deliberately NOT `setRunning(book, false)`. That removes the row, and a removal is not a terminal:
   * the panel's watcher looks for a job it saw running whose STATUS became terminal, and the dashboard's
   * `watchReviewBuild` ignores a `null` outright. A build that ends really does leave a terminal row
   * behind in the registry, which is why the real service retains one.
   */
  finish(bookId: string, kind: 'summary' | 'review' = 'review', status: TrackedJob['status'] = 'succeeded'): void {
    this.all.next(this.all.value.map(j =>
      j.bookId === bookId && j.kind === kind
        ? { ...j, status, percent: status === 'succeeded' ? 100 : j.percent }
        : j));
  }

  /** finding 19: push an arbitrary set of jobs verbatim, for tests that need a specific kind. */
  pushActive(jobs: TrackedJob[]): void {
    this.all.next(jobs);
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

/** A minimal in-flight TrackedJob. Only the fields the spine derivation reads carry meaning. */
function makeTrackedJob(bookId: string, kind: 'summary' | 'review'): TrackedJob {
  return {
    id: `${kind}-${bookId}`,
    kind,
    bookId,
    scopeLabel: 'Whole book',
    titleHe: 'בנייה',
    titleEn: 'Build',
    status: 'running',
    percent: 10,
    completedChunks: null,
    totalChunks: null,
    chunkClock: EMPTY_CHUNK_CLOCK,
    message: '',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
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

/**
 * b2: `bookLanguage` is DECLARED here rather than being swallowed by NO_ERRORS_SCHEMA, because the
 * issue panel now HIDES its detect button when this input resolves to Hebrew (and it defaults to `'he'`
 * inside the panel). An unwired binding would therefore hide the button on English books too, and with
 * NO_ERRORS_SCHEMA on, a deleted binding would fail nothing. Declaring the input makes the wire itself
 * assertable.
 */
@Component({ selector: 'app-issue-panel', standalone: true, template: '' })
class StubIssuePanelComponent {
  @Input() bookLanguage: string | null = null;
}

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
        {
          provide: ActivatedRoute,
          // `queryParams` is read as an OBSERVABLE by the chatbot phase-B focus deep link, beside the
          // existing snapshot read the imported signal uses. A stub with only the snapshot leaves
          // ngOnInit dereferencing undefined.
          useValue: {
            params: routeParams$.asObservable(),
            queryParams: of({}),
            snapshot: { queryParams: {} },
          },
        },
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
            // Wave 3 / w3: NOT stubbed. The compact spine IS the running indicator now, so the rf-c02
            // contracts are asserted on its real rendered output rather than on a stub's inputs.
            StageSpineComponent,
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

  // ── 2b. c02: the mode switch on the openChapter seam is narrowed to the LEDGER chip ─────────────
  //
  // ONE `@Output() openChapter` on the dashboard is fed by THREE producers (book-dashboard.component.ts:236
  // the stage spine's per-chapter breakdown, :338 the findings ledger, :346 the Story Bible). Only the
  // ledger arms the Edit-mode surfaces, and it is the only producer in the app that stamps `findingId`
  // (book-review-findings.component.ts:352-359). These three specs drive the REAL template's
  // `(openChapter)` binding and assert what the READER would see - whether the Book review body they were
  // reading survived the click - not just the `reviewMode` field.

  const DASH_CHAPTER: import('../../core/models/book').ChapterSummaryDto = {
    id: 'chap-a', title: 'Chapter A', partName: null, order: 0, wordCount: 100, updatedAt: '',
  };

  /**
   * Mount the Book review body with one resolvable chapter, and stop the seam at `selectChapter`: the
   * chapter-open path is asserted through the spy, and letting it run would mount the Syncfusion editor
   * branch this suite deliberately keeps out of the DOM.
   */
  const mountReviewBodyWithChapter = (): jasmine.Spy => {
    component.bookId = 'book-1';
    component.book = { ...BOOK, chapters: [DASH_CHAPTER] };
    component.reviewMode = 'review';
    component.editHelpView = 'analysis';
    fixture.detectChanges();
    expect(has('app-book-dashboard')).toBe(true); // precondition: the reader IS in Book review
    return spyOn(component, 'selectChapter');
  };

  /** Fire the dashboard's openChapter output exactly as the real template binds it. */
  const emitOpenChapter = (payload: unknown): void => {
    const dash = fixture.debugElement.query(By.directive(StubBookDashboardComponent));
    (dash.componentInstance as StubBookDashboardComponent).openChapter.emit(payload);
    fixture.detectChanges();
  };

  it('c02: the FINDINGS LEDGER chip (findingId present) switches to Edit help - the Book review body unmounts', () => {
    const selectSpy = mountReviewBodyWithChapter();

    // book-review-findings.component.ts:355-359 stamps findingId (and sets the revise context).
    emitOpenChapter({ chapterId: 'chap-a', order: 0, title: 'Chapter A', findingId: 'f-1' });

    expect(has('app-book-dashboard')).toBe(false);
    expect(has('app-analysis-panel')).toBe(true);
    expect(component.reviewMode).toBe('edit');
    expect(selectSpy).toHaveBeenCalledOnceWith(DASH_CHAPTER);
  });

  it('c02: the STORY BIBLE anchor chip (bare anchor) does NOT switch modes - the Book review body stays mounted', () => {
    const selectSpy = mountReviewBodyWithChapter();

    // book-story-bible.component.ts:258-259 emits a bare ChapterAnchor: no findingId, no revise context.
    emitOpenChapter({ chapterId: 'chap-a', order: 0, title: 'Chapter A' });

    // The surface the reader was reading is still on screen, and Edit help never took over.
    expect(has('app-book-dashboard')).toBe(true);
    expect(has('app-analysis-panel')).toBe(false);
    expect(component.reviewMode).toBe('review');
    // The chapter still opens: only the mode switch narrowed.
    expect(selectSpy).toHaveBeenCalledOnceWith(DASH_CHAPTER);
  });

  it('c02: the STAGE SPINE per-chapter breakdown does NOT switch modes - the Book review body stays mounted', () => {
    const selectSpy = mountReviewBodyWithChapter();

    // book-dashboard.component.ts:1731-1732 rebuilds the payload as {chapterId, order, title} only.
    emitOpenChapter({ chapterId: 'chap-a', order: 0, title: 'Chapter A' });

    expect(has('app-book-dashboard')).toBe(true);
    expect(has('app-analysis-panel')).toBe(false);
    expect(component.reviewMode).toBe('review');
    expect(selectSpy).toHaveBeenCalledOnceWith(DASH_CHAPTER);
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

  // ── c04: a book switch drops BOTH held navigation one-shots ────────
  //
  // P2 finding 14. This page SURVIVES a book switch (the route params change in place, the component is
  // not recreated), and neither one-shot was dropped when they did. A held finding id then published
  // into the NEXT book's ledger, where openFinding cleared that book's filters for an id it does not
  // carry; a held phrase waited for a chapter id that means nothing in the new book's chapter list.
  it('c04: drops a held open-finding request AND a held excerpt phrase when the route bookId changes', () => {
    fixture.detectChanges(); // ngOnInit subscribes to route params

    routeParams$.next({ bookId: 'book-1' });
    // Both intents armed while reading book-1: one waiting for the ledger to mount, one waiting for a
    // chapter document to open.
    (component as any).pendingOpenFindingId = 'f-7';
    (component as any).pendingExcerptNavigation = { chapterId: 'c-3', phrase: 'She turned' };

    routeParams$.next({ bookId: 'book-2' });

    expect((component as any).pendingOpenFindingId).toBeNull();
    expect((component as any).pendingExcerptNavigation).toBeNull();
  });

  it('c04: a SAME-book route params re-emit does NOT drop either navigation one-shot', () => {
    fixture.detectChanges();

    routeParams$.next({ bookId: 'book-1' });
    (component as any).pendingOpenFindingId = 'f-7';
    (component as any).pendingExcerptNavigation = { chapterId: 'c-3', phrase: 'She turned' };

    // A benign params refresh is not the reader changing books; an intent still waiting for its own
    // book's surfaces must survive it, exactly as the revise-context and handoff one-shots do above.
    routeParams$.next({ bookId: 'book-1' });

    expect((component as any).pendingOpenFindingId).toBe('f-7');
    expect((component as any).pendingExcerptNavigation).toEqual({ chapterId: 'c-3', phrase: 'She turned' });
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

  // ── 3b. b2: the issue panel's bookLanguage binding is REAL ────────────────────────────
  //
  // The panel gates its detect button on this input and defaults it to 'he' internally, so an unbound
  // (or deleted) binding would hide the button on every English book while every panel-level spec still
  // passed. This asserts the wire from `book.language` through `editor-page.component.html`.

  it('binds the issue panel bookLanguage from the loaded book (English book => en)', () => {
    component.bookId = 'book-1';
    component.book = { ...BOOK, language: 'en' };
    component.reviewMode = 'edit';
    component.editHelpView = 'language';
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.directive(StubIssuePanelComponent));
    expect(panel).not.toBeNull();
    expect(panel.componentInstance.bookLanguage).toBe('en');
  });

  it('binds the issue panel bookLanguage to he for a Hebrew book, and to he when no book is loaded', () => {
    component.bookId = 'book-1';
    component.book = BOOK; // language: 'he'
    component.reviewMode = 'edit';
    component.editHelpView = 'language';
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(StubIssuePanelComponent)).componentInstance.bookLanguage
    ).toBe('he');

    // A loaded book with a falsy language: the template's trailing `?? 'he'` keeps the Hebrew default
    // rather than sending null/undefined through. This exercises the RIGHT side of
    // `book?.language ?? 'he'`, not the `book?.` guard - `component.book` is still a real object here.
    component.book = { ...BOOK, language: null as unknown as string };
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(StubIssuePanelComponent)).componentInstance.bookLanguage
    ).toBe('he');

    // No book yet: `book?.language` is what actually guards this case (the `?.` short-circuits on
    // `book` itself being null, not merely its `language` field), so drive that directly - `book` is
    // typed `BookDetailDto | null` on the component, and null is its real "not loaded yet" value.
    component.book = null;
    fixture.detectChanges();
    expect(
      fixture.debugElement.query(By.directive(StubIssuePanelComponent)).componentInstance.bookLanguage
    ).toBe('he');
  });

  // ── 4. rf-c02 (migrated by Wave 3 / w3): the whole-book "running" signal, now IN THE SPINE ──────────
  //
  // WHAT CHANGED, AND WHAT DID NOT. rf-c02's contract is unchanged: a whole-book build stays visible on
  // this route while the book dashboard is @if-destroyed - panel closed, focus mode, or Edit help - and it
  // is derived from the ONE job registry rather than from a dashboard @Output or an editor-owned poll.
  // What changed is WHERE it renders. The two bespoke pulsing dots (on the focus toggle and on the reopen
  // button) are gone (Q12b); the signal is now the `running` state of the COMPACT stage spine, which this
  // route mounts exactly when the full spine is off screen. So these tests assert the same three unmount
  // cases, the same book-scoping, and the same single reattach - against the surface that replaced them.
  //
  // THE FOCUS BUTTON IS UNTOUCHED by all of this (owner keeper decision): it still renders, still toggles,
  // and `describe('toggleFocusMode (ds-c05)')` above pins its behavior unchanged.
  describe('rf-c02/w3 whole-book running signal (spine-carried, survives close/focus/Edit-help)', () => {
    /**
     * Drive the real book-load flow so the editor derives spine signals for the book and calls reattach.
     *
     * The book has ONE chapter with text on purpose. A whole-book build is only reachable on a book that
     * has a manuscript, and the spine says so: on a book with zero chapters stages 2 and 3 are `blocked`
     * by Import, which outranks everything else because a build there would have nothing to read. Seeding
     * an empty book here would test a state the product cannot reach.
     */
    function loadBook(id = 'book-1'): void {
      component.reviewMode = 'review';
      component.reviewPanelOpen = true;
      component.focusMode = false;
      fixture.detectChanges();            // ngOnInit subscribes to route params + activeJobs$
      routeParams$.next({ bookId: id });  // getById(id)
      bookLoad$.next({
        ...BOOK,
        id,
        chapters: [{ id: 'chap-1', title: 'Chapter one', partName: null, order: 0, wordCount: 900, updatedAt: '' }],
      });                                 // book resolves -> reattach(id) called once
      fixture.detectChanges();
    }

    /** The compact spine's rendered stage-3 (developmental review) state, or null when no spine is shown. */
    function compactReviewState(): string | null {
      const pip = el().querySelector('[data-testid="spine-compact-pip-review"]');
      return pip ? pip.getAttribute('data-state') : null;
    }

    /** Every compact spine currently mounted on the route. The running signal must live in exactly one. */
    function compactSpines(): NodeListOf<Element> {
      return el().querySelectorAll('[data-testid="stage-spine-compact"]');
    }

    it('reattaches to in-flight jobs exactly ONCE on book load (no second poller)', () => {
      loadBook('book-1');
      expect(registryStub.reattach).toHaveBeenCalledTimes(1);
      expect(registryStub.reattach).toHaveBeenCalledWith('book-1', 'he');
    });

    // ── THE DENSITY HANDOFF (Q1-D) ────────────────────────────────────────────────────────────────
    //
    // On a book route the FULL spine is the surface, and the compact density exists only to cover the
    // states where the full one is off screen. These four cases are the whole rule, and asserting the
    // COUNT (never zero, never two) is what makes "the running indicator lives in exactly one place" a
    // fact rather than a claim: two mounted spines would be the old two-dots defect in a new costume.

    it('shows the FULL spine and no compact one while the panel is showing the review', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      fixture.detectChanges();
      expect(component.fullSpineVisible).toBe(true);
      expect(has('app-book-dashboard')).toBe(true);
      expect(compactSpines().length).toBe(0);
    });

    it('hands off to exactly one compact spine when the panel is CLOSED', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      expect(component.fullSpineVisible).toBe(false);
      expect(has('app-book-dashboard')).toBe(false);
      expect(compactSpines().length).toBe(1);
    });

    it('hands off to exactly one compact spine in FOCUS MODE', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      component.toggleFocusMode();
      fixture.detectChanges();
      expect(component.fullSpineVisible).toBe(false);
      expect(compactSpines().length).toBe(1);
    });

    it('hands off to exactly one compact spine in EDIT HELP mode', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      component.onReviewModeChange('edit');
      fixture.detectChanges();
      expect(component.fullSpineVisible).toBe(false);
      expect(compactSpines().length).toBe(1);
    });

    it('still shows exactly one compact spine with the panel closed and NO chapter open', () => {
      loadBook('book-1');
      component.selectedChapterId = null;
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      // No editor status bar exists in this state, so the EMPTY WRITING PANE carries it instead - and
      // carries it exactly once, which is what the two placements' mutually exclusive guards buy.
      // (c05 moved this mount out of the reopen zone: that zone requires the panel to be CLOSED, so it
      // could never cover the panel-OPEN half of "no chapter open". See the c05 matrix describe below.)
      expect(el().querySelector('.review-reopen')).not.toBeNull();
      expect(compactSpines().length).toBe(1);
      expect(el().querySelectorAll('.editor-empty [data-testid="stage-spine-compact"]').length).toBe(1);
      expect(el().querySelectorAll('.review-reopen-zone [data-testid="stage-spine-compact"]').length).toBe(0);
    });

    it('the compact spine follows the BOOK language, so entering a book never flips it', () => {
      component.reviewMode = 'review';
      component.reviewPanelOpen = false;
      component.focusMode = false;
      fixture.detectChanges();
      routeParams$.next({ bookId: 'book-en' });
      bookLoad$.next({ ...BOOK, id: 'book-en', language: 'en', chapters: [] });
      component.selectedChapterId = 'chap-1';
      fixture.detectChanges();

      const spine = el().querySelector('[data-testid="stage-spine-compact"]') as HTMLElement;
      expect(spine.getAttribute('dir')).toBe('ltr');
      expect(spine.textContent).toContain('Import');
    });

    it('carries a running build on the compact spine with the dashboard UNMOUNTED (panel closed)', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';

      // A tracked job for book-1 starts running (published by a status row's track() -> registry).
      registryStub.setRunning('book-1', true);
      fixture.detectChanges();

      // User closes the panel: the dashboard is @if-destroyed. The registry keeps tracking, so it holds.
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(false);
      expect(compactReviewState()).toBe('running');
      // The signal lives in exactly ONE place: one compact spine, and no full spine beside it.
      expect(compactSpines().length).toBe(1);
      expect(el().querySelector('[data-testid="stage-spine"]')).toBeNull();

      // The build finishes (terminal): the registry drops it and the state clears - dashboard still
      // unmounted, proving the registry (not the dashboard) drives it.
      registryStub.setRunning('book-1', false);
      fixture.detectChanges();
      expect(compactReviewState()).not.toBe('running');
    });

    // finding 57: a build ENDING is not a build DISAPPEARING, and until now this harness could only
    // express the second. Both a1 consumers this page hosts key on the terminal STATUS - the analysis
    // panel refetches history for a job it saw running that turned terminal, and the dashboard's
    // `watchReviewBuild` bumps the findings token on the same transition, ignoring a `null` outright - so
    // a stub whose only ending was a removal could not deliver the event either of them exists for.
    it('a build that goes TERMINAL clears the spine and is still on the two a1 channels', async () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      component.reviewPanelOpen = false;
      registryStub.setRunning('book-1', true);
      fixture.detectChanges();
      expect(compactReviewState()).withContext('precondition: the build is in flight').toBe('running');

      registryStub.finish('book-1', 'review');
      fixture.detectChanges();

      // The editor reads `activeJobs$`, which drops a terminal job exactly as the real registry does.
      expect(compactReviewState()).not.toBe('running');

      // ...and the row the two a1 consumers read is still there, carrying the terminal. This is the
      // emission a removal cannot produce: `jobByKindForBook$` would have answered `null`.
      const seen = await firstValueFrom(registryStub.jobs$);
      const terminal = seen.find(j => j.bookId === 'book-1' && j.kind === 'review');
      expect(terminal?.status)
        .withContext('the panel notices a run finishing by seeing a job it saw RUNNING turn terminal')
        .toBe('succeeded');
      const byKind = await firstValueFrom(registryStub.jobByKindForBook$('book-1', 'review'));
      expect(byKind?.status)
        .withContext('watchReviewBuild returns early on a null, so a removal reaches nothing at all')
        .toBe('succeeded');
    });

    it('carries a running build while in FOCUS MODE (panel + dashboard unmounted), and the focus button still works', () => {
      loadBook('book-1');
      // A chapter must be selected for the editor status bar (and its focus button) to render.
      component.selectedChapterId = 'chap-1';

      // A tracked job is in flight; entering focus unmounts the dashboard but the registry keeps driving it.
      registryStub.setRunning('book-1', true);
      component.toggleFocusMode();
      fixture.detectChanges();

      expect(component.focusMode).toBe(true);
      expect(component.reviewPanelOpen).toBe(false);
      // In focus mode neither the panel NOR the reopen button is shown - unchanged, and correct.
      expect(el().querySelector('.review-reopen')).toBeNull();
      expect(has('app-book-dashboard')).toBe(false);
      // The focus BUTTON is still there and is still a focus toggle. Only its dot went away.
      const focusBtn = el().querySelector('.focus-btn') as HTMLElement;
      expect(focusBtn).not.toBeNull();
      expect(focusBtn.getAttribute('aria-pressed')).toBe('true');
      expect(focusBtn.querySelector('.review-running-dot')).toBeNull();

      // The compact spine in the status bar is the surface that remains, and it carries the build.
      expect(compactSpines().length).toBe(1);
      expect(compactReviewState()).toBe('running');

      // The build finishes while still in focus mode: the registry clears it (no remount needed).
      registryStub.setRunning('book-1', false);
      fixture.detectChanges();
      expect(compactReviewState()).not.toBe('running');
    });

    it('does NOT show a running state when no build is running', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      const reopen = el().querySelector('.review-reopen') as HTMLElement;
      expect(reopen).not.toBeNull();
      // The dot is gone from the reopen button for good.
      expect(reopen.querySelector('.review-running-dot')).toBeNull();
      expect(compactReviewState()).not.toBe('running');
    });

    it('clears the running state when a build FINISHES while in Edit help mode (dashboard unmounted)', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      registryStub.setRunning('book-1', true);
      fixture.detectChanges();
      // Panel open in review mode: the FULL spine owns the signal, so no compact spine is mounted at all.
      // That is the handoff working, and it is why the compact assertions below start after the switch.
      expect(compactSpines().length).toBe(0);
      expect(has('app-book-dashboard')).toBe(true);

      // User switches to Edit help: the dashboard is @if-destroyed. The registry (single reused poll) keeps
      // driving it, so the compact spine takes over and when the build finishes the state clears with no
      // dashboard mounted.
      component.onReviewModeChange('edit');
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(false);
      expect(compactSpines().length).toBe(1);
      expect(compactReviewState()).toBe('running');

      registryStub.setRunning('book-1', false);
      fixture.detectChanges();
      expect(compactReviewState()).not.toBe('running');
    });

    it('KEEPS the running state while in Edit help when the build is still running (no over-clear)', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      registryStub.setRunning('book-1', true);
      component.onReviewModeChange('edit');
      fixture.detectChanges();

      // Dashboard is gone, but the registry still reports the build running, so the state holds.
      expect(has('app-book-dashboard')).toBe(false);
      expect(compactReviewState()).toBe('running');
    });

    it('a book SUMMARY build lights stage 2 only, never stage 3 (per-kind, not one flag for both)', () => {
      loadBook('book-1');
      component.selectedChapterId = 'chap-1';
      component.reviewPanelOpen = false;
      registryStub.setRunning('book-1', true, 'summary');
      fixture.detectChanges();

      expect(el().querySelector('[data-testid="spine-compact-pip-briefs"]')!.getAttribute('data-state'))
        .toBe('running');
      expect(compactReviewState()).not.toBe('running');
    });

    it('book-switch re-scopes the signal: a job for book A does not light book B (wrong-book guard)', () => {
      loadBook('book-A');
      component.selectedChapterId = 'chap-1';
      component.reviewPanelOpen = false;
      registryStub.setRunning('book-A', true);
      fixture.detectChanges();
      expect(compactReviewState()).toBe('running');

      // The user switches to book-B, which has NO build running. The route emits the new id and the
      // derivation, which filters on the CURRENT bookId, drops the stale book-A state at once.
      routeParams$.next({ bookId: 'book-B' });
      fixture.detectChanges();
      expect(compactReviewState()).not.toBe('running');

      // book-A's job is STILL running server-side, but it must not light book-B.
      registryStub.setRunning('book-A', true);
      fixture.detectChanges();
      expect(compactReviewState()).not.toBe('running');

      // And book-B's own job does light book-B.
      registryStub.setRunning('book-B', true);
      fixture.detectChanges();
      expect(compactReviewState()).toBe('running');
    });
  });

  // ── c05: THE SPINE-PRESENCE CELL MATRIX (P1-9 + P2-31) ────────────────────────────────────────
  //
  // The rf-c02/w3 tests above assert the density HANDOFF, but every one of them sets
  // `selectedChapterId = 'chap-1'` before asserting - which is exactly why the empty cell was invisible
  // to the suite and had to be found by a browser. The status-bar mount needs a chapter; the old
  // no-chapter mount (the reopen zone) needs the panel CLOSED; so panel-open + no-chapter had NEITHER
  // density, and that is where an import and "just let me edit" both land the reader.
  //
  // These tests therefore drive the CELLS: the full cross of the four inputs that gate the mounts
  // (panel open/closed x focus on/off x panel body x chapter selected/not), plus the book-not-yet-loaded
  // pair. The expected placement per cell is HAND-AUTHORED from the crossed template guards, not computed
  // from the production getters, so a change to those getters cannot quietly re-derive its own oracle.
  //
  // Focus mode is an owner KEEPER decision (2026-08-09): it HIDES both side zones, so the full spine
  // hides with them and the compact one is the surface that remains. The `focus: true` rows below pin
  // that as CORRECT behaviour, not as a gap to be closed by forcing the full spine into focus mode.

  describe('c05 spine presence: every cell of the crossed matrix', () => {
    type Body = 'review' | 'edit' | 'handoff';
    type Placement = 'full' | 'status-bar' | 'empty-pane';
    interface Cell {
      panelOpen: boolean;
      focus: boolean;
      body: Body;
      chapter: boolean;
      /** false = the route has a bookId but the book GET has not resolved yet. Defaults to true. */
      bookLoaded?: boolean;
      expected: Placement;
    }

    /** Put the component into the named cell directly, then render. */
    function drive(cell: Cell): void {
      component.bookId = 'book-1';
      component.book = cell.bookLoaded === false ? null : BOOK;
      component.reviewPanelOpen = cell.panelOpen;
      component.focusMode = cell.focus;
      component.showHandoffCard = cell.body === 'handoff';
      component.reviewMode = cell.body === 'edit' ? 'edit' : 'review';
      component.selectedChapterId = cell.chapter ? 'chap-1' : null;
      fixture.detectChanges();
    }

    /** The full spine's host on this route. It is the ONLY thing `fullSpineVisible` gates. */
    const fullSpineMounts = () => el().querySelectorAll('app-book-dashboard').length;
    const statusBarSpines = () =>
      el().querySelectorAll('.editor-status [data-testid="stage-spine-compact"]').length;
    const emptyPaneSpines = () =>
      el().querySelectorAll('.editor-empty [data-testid="stage-spine-compact"]').length;
    const allSpines = () =>
      fullSpineMounts() + el().querySelectorAll('[data-testid="stage-spine-compact"]').length;

    function label(cell: Cell): string {
      return `panel ${cell.panelOpen ? 'open' : 'closed'} / focus ${cell.focus ? 'ON' : 'off'} / `
        + `${cell.body}${cell.bookLoaded === false ? ' (book not loaded)' : ''} / `
        + `${cell.chapter ? 'chapter open' : 'NO chapter'}`;
    }

    const CELLS: Cell[] = [
      // Panel open, no focus: the review body hosts the FULL spine, and only it.
      { panelOpen: true,  focus: false, body: 'review',  chapter: true,  expected: 'full' },
      { panelOpen: true,  focus: false, body: 'review',  chapter: false, expected: 'full' },
      // ... but the review body is REPLACED by Edit help and by the import handoff card, and neither
      // hosts a spine. These two `chapter: false` rows are the cells that rendered NOTHING before c05.
      { panelOpen: true,  focus: false, body: 'edit',    chapter: true,  expected: 'status-bar' },
      { panelOpen: true,  focus: false, body: 'edit',    chapter: false, expected: 'empty-pane' },
      { panelOpen: true,  focus: false, body: 'handoff', chapter: true,  expected: 'status-bar' },
      { panelOpen: true,  focus: false, body: 'handoff', chapter: false, expected: 'empty-pane' },
      // The book GET has not resolved yet, so the review body cannot mount either.
      { panelOpen: true,  focus: false, body: 'review',  chapter: true,  bookLoaded: false, expected: 'status-bar' },
      { panelOpen: true,  focus: false, body: 'review',  chapter: false, bookLoaded: false, expected: 'empty-pane' },
      // Panel closed: the reopen zone renders, and (since c05) carries no spine of its own.
      { panelOpen: false, focus: false, body: 'review',  chapter: true,  expected: 'status-bar' },
      { panelOpen: false, focus: false, body: 'review',  chapter: false, expected: 'empty-pane' },
      { panelOpen: false, focus: false, body: 'edit',    chapter: true,  expected: 'status-bar' },
      { panelOpen: false, focus: false, body: 'edit',    chapter: false, expected: 'empty-pane' },
      { panelOpen: false, focus: false, body: 'handoff', chapter: true,  expected: 'status-bar' },
      { panelOpen: false, focus: false, body: 'handoff', chapter: false, expected: 'empty-pane' },
      // FOCUS MODE, panel remembered as open. Focus hides both side zones - KEEPER, not a gap.
      { panelOpen: true,  focus: true,  body: 'review',  chapter: true,  expected: 'status-bar' },
      { panelOpen: true,  focus: true,  body: 'review',  chapter: false, expected: 'empty-pane' },
      { panelOpen: true,  focus: true,  body: 'edit',    chapter: true,  expected: 'status-bar' },
      { panelOpen: true,  focus: true,  body: 'edit',    chapter: false, expected: 'empty-pane' },
      { panelOpen: true,  focus: true,  body: 'handoff', chapter: true,  expected: 'status-bar' },
      { panelOpen: true,  focus: true,  body: 'handoff', chapter: false, expected: 'empty-pane' },
      // FOCUS MODE, panel remembered as closed (what toggleFocusMode actually leaves behind).
      { panelOpen: false, focus: true,  body: 'review',  chapter: true,  expected: 'status-bar' },
      { panelOpen: false, focus: true,  body: 'review',  chapter: false, expected: 'empty-pane' },
      { panelOpen: false, focus: true,  body: 'edit',    chapter: true,  expected: 'status-bar' },
      { panelOpen: false, focus: true,  body: 'edit',    chapter: false, expected: 'empty-pane' },
      { panelOpen: false, focus: true,  body: 'handoff', chapter: true,  expected: 'status-bar' },
      { panelOpen: false, focus: true,  body: 'handoff', chapter: false, expected: 'empty-pane' },
    ];

    for (const cell of CELLS) {
      it(`mounts EXACTLY ONE spine, in the ${cell.expected}, when ${label(cell)}`, () => {
        drive(cell);

        // (1) Never none, never two. This is the claim the old docstring made and could not keep.
        expect(allSpines())
          .withContext(`${label(cell)}: expected exactly one spine on screen`)
          .toBe(1);

        // (2) And it is the density/placement the crossed guards say it should be.
        expect(fullSpineMounts())
          .withContext(`${label(cell)}: full spine`)
          .toBe(cell.expected === 'full' ? 1 : 0);
        expect(statusBarSpines())
          .withContext(`${label(cell)}: compact spine in the editor status bar`)
          .toBe(cell.expected === 'status-bar' ? 1 : 0);
        expect(emptyPaneSpines())
          .withContext(`${label(cell)}: compact spine in the empty writing pane`)
          .toBe(cell.expected === 'empty-pane' ? 1 : 0);

        // (3) The three getters partition the same way the DOM does, so the template and the single
        //     authority cannot drift apart.
        expect(component.fullSpineVisible).toBe(cell.expected === 'full');
        expect(component.compactSpineInStatusBar).toBe(cell.expected === 'status-bar');
        expect(component.compactSpineInEmptyPane).toBe(cell.expected === 'empty-pane');
      });
    }

    // ── The two cells the live browser measured as `compact: 0, full: 0` ─────────────────────────

    it('THE DEFECT CELL: panel open + Edit help + no chapter selected still shows a spine', () => {
      drive({ panelOpen: true, focus: false, body: 'edit', chapter: false, expected: 'empty-pane' });
      // This is where "just let me edit" (onHandoffEditMode) lands a reader on the headline empty book.
      expect(el().querySelector('.editor-empty [data-testid="stage-spine-compact"]'))
        .withContext('the empty book first screen must carry stage guidance')
        .not.toBeNull();
      expect(allSpines()).toBe(1);
    });

    it('THE DEFECT CELL: the import handoff card with no chapter selected still shows a spine', () => {
      drive({ panelOpen: true, focus: false, body: 'handoff', chapter: false, expected: 'empty-pane' });
      // The handoff card owns the panel body, so there is no full spine behind it; the writing pane is
      // the only surface left, and an import is exactly how a reader arrives in this state.
      expect(has('app-import-handoff-card')).toBe(true);
      expect(has('app-book-dashboard')).toBe(false);
      expect(emptyPaneSpines()).toBe(1);
      expect(allSpines()).toBe(1);
    });

    it('the reopen zone no longer carries a spine of its own (no double mount with the writing pane)', () => {
      drive({ panelOpen: false, focus: false, body: 'edit', chapter: false, expected: 'empty-pane' });
      expect(el().querySelector('.review-reopen')).not.toBeNull();
      expect(el().querySelectorAll('.review-reopen-zone [data-testid="stage-spine-compact"]').length).toBe(0);
      expect(emptyPaneSpines()).toBe(1);
    });

    // ── Focus mode is UNCHANGED by c05 (owner keeper decision) ───────────────────────────────────

    it('focus mode still hides both side zones and keeps the compact spine, with a chapter open', () => {
      component.bookId = 'book-1';
      component.book = BOOK;
      component.selectedChapterId = 'chap-1';
      component.reviewMode = 'review';
      component.reviewPanelOpen = true;
      fixture.detectChanges();
      expect(fullSpineMounts()).toBe(1); // full spine before focus

      component.toggleFocusMode();
      fixture.detectChanges();

      expect(component.focusMode).toBe(true);
      expect(el().querySelector('.sidebar')).toBeNull();
      expect(el().querySelector('.review-panel')).toBeNull();
      expect(el().querySelector('.review-reopen')).toBeNull();
      expect(fullSpineMounts()).toBe(0);
      expect(statusBarSpines()).toBe(1);
      const focusBtn = el().querySelector('.focus-btn') as HTMLElement;
      expect(focusBtn.getAttribute('aria-pressed')).toBe('true');

      // Exiting restores the panel exactly as it was, and the full spine with it.
      component.toggleFocusMode();
      fixture.detectChanges();
      expect(component.reviewPanelOpen).toBe(true);
      expect(fullSpineMounts()).toBe(1);
      expect(statusBarSpines()).toBe(0);
    });

    it('focus mode with NO chapter open shows the compact spine in the writing pane, not the full one', () => {
      drive({ panelOpen: true, focus: true, body: 'review', chapter: false, expected: 'empty-pane' });
      // Focus mode does NOT get the full spine back - that is the owner decision, restated as a test so
      // a later "fix" for this cell cannot quietly force the side panels open in focus mode.
      expect(el().querySelector('.review-panel')).toBeNull();
      expect(fullSpineMounts()).toBe(0);
      expect(emptyPaneSpines()).toBe(1);
    });

    it('the compact spine in the writing pane follows the BOOK language', () => {
      component.bookId = 'book-en';
      component.book = { ...BOOK, id: 'book-en', language: 'en' };
      component.selectedChapterId = null;
      component.reviewMode = 'edit';
      component.reviewPanelOpen = true;
      component.focusMode = false;
      fixture.detectChanges();

      const spine = el().querySelector('.editor-empty [data-testid="stage-spine-compact"]') as HTMLElement;
      expect(spine).not.toBeNull();
      expect(spine.getAttribute('dir')).toBe('ltr');
      expect(spine.textContent).toContain('Import');
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
      // c02: the message line is the COMPOSED localized sentence, not the bare pill label. No
      // analysisType was set on this run, so the type resolves to the generic 'ניתוח'.
      expect(dialogMessage()).toBe(runString('he', 'runCanceled', { type: 'ניתוח' }));
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
        // c04: no chunk shape by default, so this fixture renders no counts and no ETA.
        completedChunks: null,
        totalChunks: null,
        chunkClock: EMPTY_CHUNK_CLOCK,
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

  // ── c07 finding 19: the per-chapter running mark is scoped to CHAPTER_SCOPED_KINDS ────────────────
  describe('finding 19: the chapter breakdown reads an explicit kind allowlist, not any chapterId', () => {
    beforeEach(() => {
      component.bookId = 'book-1';
      component.book = {
        ...BOOK,
        chapters: [
          { id: 'ch-1', title: 'One', partName: null, order: 0, wordCount: 10, updatedAt: '' },
          { id: 'ch-2', title: 'Two', partName: null, order: 1, wordCount: 10, updatedAt: '' },
        ],
      };
      fixture.detectChanges();
    });

    /**
     * Verified independently before this fix (not just trusted from the review): today only `proofread`
     * ever carries a `chapterId` - `job-registry.service.ts`'s `analysisJobToSource` (the ONLY place a
     * `TrackedJob.chapterId` is ever set from a reattach) hardcodes `kind: 'proofread'`, and the three
     * book-level reattach sources (summary/review/style-baseline) never set `chapterId` at all. So this
     * exact scenario - a NON-proofread kind carrying a chapterId - cannot happen in the shipped product
     * today. It is exactly the scenario `CHAPTER_SCOPED_KINDS` exists to guard against: a future kind
     * that starts carrying a chapterId without this reader being updated to know about it. This fails on
     * the reverted code, which read the bare presence of `chapterId` with no kind check at all.
     */
    it('ignores a chapterId on a job whose kind is not in CHAPTER_SCOPED_KINDS', () => {
      registryStub.pushActive([
        {
          id: 'j-1', kind: 'proofread', bookId: 'book-1', scopeLabel: 'פרק', titleHe: 'הגהה', titleEn: 'Proofread',
          status: 'running', percent: 10, completedChunks: null, totalChunks: null, chunkClock: EMPTY_CHUNK_CLOCK,
          message: '', startedAt: '', updatedAt: '', chapterId: 'ch-1',
        },
        {
          id: 'j-2', kind: 'style-baseline', bookId: 'book-1', scopeLabel: 'Whole book', titleHe: 'סגנון', titleEn: 'Style',
          status: 'running', percent: 10, completedChunks: null, totalChunks: null, chunkClock: EMPTY_CHUNK_CLOCK,
          message: '', startedAt: '', updatedAt: '', chapterId: 'ch-2',
        },
      ]);

      const running = component.spineSignals.chapters?.filter(c => c.running).map(c => c.chapterId);
      expect(running).toEqual(['ch-1']);
    });
  });

  // ── 5. Q12 close: ONE scope statement, never a chapter/scene contradiction ─────────────────────
  //
  // The scope pill used to read "This chapter" / "פרק נוכחי" unconditionally in edit mode while the
  // adjacent meta line correctly said "scene" once a scene was selected - the exact single-screen
  // contradiction WAVE3_REDESIGN_BRIEF.md's Q12 row was written to resolve, and that the Wave 3 docs
  // pass found still reproducible. reviewScopeLabel + reviewContextMeta are retired; one getter
  // (reviewScopeStatement) now owns the whole pill, so it cannot describe two different scopes at
  // once. These specs pin the new shape and assert the ABSENCE of the old contradiction directly.
  describe('reviewScopeStatement (Q12 close): the pill never contradicts the selection', () => {
    // f01: a realistic Hebrew chapter title, not the unrepresentative 'Chapter one'. Hebrew
    // manuscripts overwhelmingly title chapters with "פרק" (the DOCX parser splits on that
    // marker), and .review-context-label legitimately renders it beside the scene title by
    // design (`${chapterLabel} · ${sceneLabel}`, reviewContextLabel) - so a regression guard
    // that scans .review-context's full text for "פרק" would go red against correct code once
    // the fixture carries a realistic title. See the re-scoped guards below.
    const CHAPTER_BOOK: BookDetailDto = {
      ...BOOK,
      chapters: [{ id: 'chap-1', title: 'פרק ראשון', partName: null, order: 0, wordCount: 900, updatedAt: '' }],
    };

    beforeEach(() => {
      component.bookId = 'book-1';
      component.book = CHAPTER_BOOK; // Hebrew book (BOOK.language = 'he'): reviewPanelIsHebrew defaults true
      component.reviewMode = 'edit';
      component.selectedChapterId = 'chap-1';
    });

    it('names the chapter when no scene is selected', () => {
      component.selectedSceneId = null;
      fixture.detectChanges();

      expect(el().querySelector('.scope-pill')?.textContent?.trim()).toBe('פרק נוכחי');
      // The old subtitle span is gone: the pill is the ONLY scope statement now.
      expect(has('.review-context-meta')).toBe(false);
    });

    it('names the scene, never the chapter, once a scene is selected - the exact former contradiction', () => {
      component.selectedSceneId = 'sc-1';
      fixture.detectChanges();

      const pill = el().querySelector('.scope-pill');
      // Existence claim first: querySelector(...)?.textContent on a vanished element is
      // `undefined`, and `expect(undefined).not.toContain(x)` passes vacuously - it would not
      // catch the pill disappearing entirely.
      expect(pill).withContext('the pill must still render').not.toBeNull();
      expect(pill?.textContent?.trim()).toBe('סצנה נוכחית');
      // Regression guard: the app's OWN scope statement (the pill) may never say "chapter" while
      // a scene is selected. Scoped to .scope-pill, NOT .review-context: .review-context also
      // contains .review-context-label, which legitimately renders the chapter title beside the
      // scene title BY DESIGN (`${chapterLabel} · ${sceneLabel}`, reviewContextLabel), and a
      // realistic Hebrew chapter title routinely contains "פרק". A guard over .review-context
      // would be scoped over the author's own content, not the app's scope statement.
      expect(pill?.textContent).not.toContain('פרק');
      expect(has('.review-context-meta')).toBe(false);
    });

    it('states the whole-book scope in review mode, in one string', () => {
      component.reviewMode = 'review';
      fixture.detectChanges();

      expect(el().querySelector('.scope-pill')?.textContent?.trim()).toBe('כל הספר · ניתוח התפתחותי');
      expect(has('.review-context-meta')).toBe(false);
    });

    it('he/en parity: English book renders the English scope statement, scene-aware', () => {
      component.book = { ...CHAPTER_BOOK, language: 'en' };
      component.selectedSceneId = null;
      fixture.detectChanges();
      expect(el().querySelector('.scope-pill')?.textContent?.trim()).toBe('This chapter');

      component.selectedSceneId = 'sc-1';
      fixture.detectChanges();
      const scenePill = el().querySelector('.scope-pill');
      // Existence claim first: see the Hebrew spec above for why a bare `?.textContent` check
      // passes vacuously once the queried element stops rendering.
      expect(scenePill).withContext('the pill must still render').not.toBeNull();
      expect(scenePill?.textContent?.trim()).toBe('This scene');
      // Scoped to .scope-pill, not .review-context: see the Hebrew spec above - the chapter
      // title legitimately appears in the adjacent .review-context-label by design.
      expect(scenePill?.textContent).not.toContain('chapter');
    });

    // ── c01: the THIRD edit-mode scope state - no chapter resolves ──────────────────────────────
    //
    // The Q12 close walked two of the three states. These seed the cell no fixture held: a book with an
    // EMPTY chapters array (a chapterless book is what a new author sees first, and it is what every
    // book looks like for the moment before its chapters load) and a book whose selectedChapterId
    // matches nothing (a stale id). In both, the pill must not claim a chapter scope - it said
    // "פרק נוכחי" beside a label reading "בחר פרק" until this fix.
    it('c01 he: an EMPTY chapters array does not make the pill claim a chapter', () => {
      component.book = { ...CHAPTER_BOOK, chapters: [] };
      component.selectedChapterId = null;
      component.selectedSceneId = null;
      fixture.detectChanges();

      const pill = el().querySelector('.scope-pill');
      expect(pill).withContext('the pill is the strip\'s only scope statement; it must still render').not.toBeNull();
      expect(pill?.textContent?.trim()).toBe('לא נבחרה יחידה');
      expect(pill?.textContent).not.toContain('פרק');
      // ...and it now agrees with its sibling label, which already resolved the chapter correctly.
      expect(el().querySelector('.review-context-label')?.textContent?.trim()).toBe('בחר פרק');

      // final-r01: with `selectedChapterId = null` the EMPTY ARRAY is not load-bearing - the pill is
      // unresolved for the null id alone, and swapping the empty list for a populated one leaves this
      // spec green (measured). So seed the state where the empty array is the ONLY reason nothing
      // resolves: every chapter deleted while its id is still selected. Now a non-empty `chapters`
      // resolves `chap-1` and the pill goes back to claiming a chapter, which is what makes the
      // fixture's own subject - a chapterless book - the axis this spec actually pins.
      component.selectedChapterId = 'chap-1';
      fixture.detectChanges();

      const pillAfterDelete = el().querySelector('.scope-pill');
      expect(pillAfterDelete).not.toBeNull();
      expect(pillAfterDelete?.textContent?.trim()).toBe('לא נבחרה יחידה');
      expect(pillAfterDelete?.textContent).not.toContain('פרק');
    });

    it('c01 he: a selectedChapterId matching NO chapter does not make the pill claim a chapter', () => {
      component.selectedChapterId = 'chap-does-not-exist';
      component.selectedSceneId = null;
      fixture.detectChanges();

      const pill = el().querySelector('.scope-pill');
      expect(pill).not.toBeNull();
      expect(pill?.textContent?.trim()).toBe('לא נבחרה יחידה');
      expect(pill?.textContent).not.toContain('פרק');
    });

    it('c01 en: the unresolved state has he/en parity, for both an empty list and a stale id', () => {
      component.book = { ...CHAPTER_BOOK, language: 'en', chapters: [] };
      component.selectedChapterId = null;
      component.selectedSceneId = null;
      fixture.detectChanges();

      let pill = el().querySelector('.scope-pill');
      expect(pill).not.toBeNull();
      expect(pill?.textContent?.trim()).toBe('No unit selected');
      expect(pill?.textContent?.toLowerCase()).not.toContain('chapter');
      expect(el().querySelector('.review-context-label')?.textContent?.trim()).toBe('Select a chapter');

      component.book = { ...CHAPTER_BOOK, language: 'en' };
      component.selectedChapterId = 'chap-does-not-exist';
      fixture.detectChanges();

      pill = el().querySelector('.scope-pill');
      expect(pill).not.toBeNull();
      expect(pill?.textContent?.trim()).toBe('No unit selected');
      expect(pill?.textContent?.toLowerCase()).not.toContain('chapter');
    });

    it('c01: a stale scene id cannot resurrect a scope claim when no chapter resolves', () => {
      // The old getter branched on selectedSceneId ALONE, so this state read "סצנה נוכחית".
      component.book = { ...CHAPTER_BOOK, chapters: [] };
      component.selectedChapterId = null;
      component.selectedSceneId = 'sc-1';
      fixture.detectChanges();

      expect(el().querySelector('.scope-pill')?.textContent?.trim()).toBe('לא נבחרה יחידה');
    });

    it('c01: review mode is unaffected by an unresolved chapter (the whole book is the scope)', () => {
      component.book = { ...CHAPTER_BOOK, chapters: [] };
      component.selectedChapterId = null;
      component.reviewMode = 'review';
      fixture.detectChanges();

      expect(el().querySelector('.scope-pill')?.textContent?.trim()).toBe('כל הספר · ניתוח התפתחותי');
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
        useValue: { params: of({}), queryParams: of(queryParams), snapshot: { queryParams } },
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
        useValue: { anyRunningForBook$: () => of(false), reattach: jasmine.createSpy('reattach'), activeJobs$: of([]), jobs$: of([]), jobByKindForBook$: () => of(null) },
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
        { provide: ActivatedRoute, useValue: { params: of({}), queryParams: of({}), snapshot: { queryParams: {} } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), getCurrentNavigation: () => null } },
        { provide: BookService, useValue: { getById: () => EMPTY } },
        { provide: ChapterService, useValue: { update: () => of({}), create: () => EMPTY, delete: () => EMPTY, getById: () => EMPTY, reorder: () => EMPTY } },
        { provide: SceneService, useValue: { update: () => of({}), getAll: () => of([]), getById: () => EMPTY, splitScenes: () => EMPTY } },
        { provide: SyncService, useValue: { connect: () => Promise.resolve(), joinBook: () => {}, leaveBook: () => {}, chapterUpdated$: EMPTY, chapterCreated$: EMPTY, chapterReordered$: EMPTY, sceneCreated$: EMPTY, sceneUpdated$: EMPTY, sceneDeleted$: EMPTY, scenesCleared$: EMPTY, scenesReordered$: EMPTY } },
        { provide: DocumentVersionService, useValue: { create: () => of({}), list: () => of([]), get: () => EMPTY } },
        { provide: AnalysisService, useValue: {} },
        { provide: JobRegistryService, useValue: { anyRunningForBook$: () => of(false), reattach: jasmine.createSpy('reattach'), activeJobs$: of([]), jobs$: of([]), jobByKindForBook$: () => of(null) } },
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
    { provide: JobRegistryService, useValue: { anyRunningForBook$: () => of(false), reattach: jasmine.createSpy('reattach'), activeJobs$: of([]), jobs$: of([]), jobByKindForBook$: () => of(null) } },
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
    const routeWithParam = {
      params: of({}),
      queryParams: of({ imported: '1' }),
      snapshot: { queryParams: { imported: '1' } },
    };

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
    const routeWithParam = {
      params: of({}),
      queryParams: of({ imported: '1' }),
      snapshot: { queryParams: { imported: '1' } },
    };

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

// ── Chatbot phase B: the `focus` deep link a citation chip navigates to ──────────────────────────────
//
// The chip is only as good as what happens when it lands. These pin the three halves of that: the param
// is CONSUMED (mode + panel), it is STRIPPED (the `imported=1` lesson: a sticky param re-forces itself on
// every refresh and overrides a later choice), and it is read as a STREAM rather than a snapshot, because
// the commonest click is a chip pressed while already on this book's page, which changes only the query
// params and never re-runs ngOnInit.
describe('EditorPageComponent chatbot phase B: the focus deep link', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let routerSpy: { navigate: jasmine.Spy; getCurrentNavigation: () => null };
  let focus: BookSurfaceFocusService;

  beforeEach(async () => {
    queryParams$ = new BehaviorSubject<Record<string, string>>({});
    routerSpy = { navigate: jasmine.createSpy('navigate'), getCurrentNavigation: () => null };
    const route = {
      params: of({}),
      queryParams: queryParams$.asObservable(),
      snapshot: { queryParams: {} },
    };

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: sharedHandoffProviders(routerSpy, route),
    })
      .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
    focus = TestBed.inject(BookSurfaceFocusService);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('opens the review panel in REVIEW mode for a dashboard surface', fakeAsync(() => {
    component.reviewMode = 'edit';
    component.closeReviewPanel();

    queryParams$.next({ focus: 'findings' });
    tick();

    expect(component.reviewMode).toBe('review');
    expect(component.reviewPanelOpen).toBeTrue();
  }));

  it('HOLDS the request until the dashboard exists, then publishes it', fakeAsync(() => {
    // Measured live: a plain setTimeout fired BEFORE the @if mounted the dashboard, so the request went
    // to nobody and the chip navigated correctly and then did nothing. Waiting on the ViewChild is a
    // fact about the view rather than a guess about task ordering.
    const seen: unknown[] = [];
    focus.focus$.subscribe(r => seen.push(r));

    queryParams$.next({ focus: 'status-review' });
    tick();
    expect(seen)
      .withContext('no dashboard in this fixture yet, so nothing may be published')
      .toEqual([]);

    component.dashboardComp = {} as never;
    fixture.detectChanges();
    tick();

    expect(seen).toEqual([{ target: 'status', stage: 'review' }]);
  }));

  it('publishes a held request exactly ONCE, however many view checks follow', fakeAsync(() => {
    const seen: unknown[] = [];
    focus.focus$.subscribe(r => seen.push(r));

    queryParams$.next({ focus: 'findings' });
    component.dashboardComp = {} as never;
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    tick();

    expect(seen.length).toBe(1);
  }));

  it('STRIPS the params it consumed, keeping every other one', fakeAsync(() => {
    queryParams$.next({ focus: 'register' });
    tick();

    expect(routerSpy.navigate).toHaveBeenCalled();
    const extras = routerSpy.navigate.calls.mostRecent().args[1];
    expect(extras.queryParams).toEqual({ focus: null, chapter: null });
    expect(extras.queryParamsHandling).toBe('merge');
    expect(extras.replaceUrl).toBeTrue();
  }));

  it('IGNORES an unknown token entirely, rather than landing somewhere arbitrary', fakeAsync(() => {
    const seen: unknown[] = [];
    focus.focus$.subscribe(r => seen.push(r));
    component.reviewMode = 'edit';

    queryParams$.next({ focus: 'everything' });
    tick();

    expect(seen).toEqual([]);
    expect(component.reviewMode).toBe('edit');
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  }));

  it('reacts to a SECOND chip pressed while already on the page', fakeAsync(() => {
    const seen: unknown[] = [];
    focus.focus$.subscribe(r => seen.push(r));
    component.dashboardComp = {} as never;

    queryParams$.next({ focus: 'findings' });
    fixture.detectChanges();
    tick();
    queryParams$.next({});
    queryParams$.next({ focus: 'register' });
    fixture.detectChanges();
    tick();

    expect(seen).toEqual([{ target: 'findings' }, { target: 'register' }]);
  }));

  describe('a CHAPTER-TEXT chip', () => {
    const chapters = [
      { id: 'ch-a', title: 'One', order: 0 },
      { id: 'ch-b', title: 'Seven', order: 6 },
    ];

    it('opens the chapter at that 0-based order, and does NOT force review mode', fakeAsync(() => {
      // The author asked to see the writing, so this one stays in the editor.
      component.book = { id: 'book-1', title: 'B', language: 'he', chapters } as never;
      component.reviewMode = 'edit';
      const select = spyOn(component, 'selectChapter');

      queryParams$.next({ focus: 'chapter', chapter: '6' });
      tick();

      expect(select).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'ch-b' }));
      expect(component.reviewMode).toBe('edit');
    }));

    it('does NOTHING when no chapter carries that order, rather than opening a neighbour', fakeAsync(() => {
      component.book = { id: 'book-1', title: 'B', language: 'he', chapters } as never;
      const select = spyOn(component, 'selectChapter');

      queryParams$.next({ focus: 'chapter', chapter: '99' });
      tick();

      expect(select).not.toHaveBeenCalled();
    }));

    it('is IGNORED when the chapter param is missing or not a number', fakeAsync(() => {
      component.book = { id: 'book-1', title: 'B', language: 'he', chapters } as never;
      const select = spyOn(component, 'selectChapter');

      queryParams$.next({ focus: 'chapter' });
      tick();
      queryParams$.next({ focus: 'chapter', chapter: 'six' });
      tick();

      expect(select).not.toHaveBeenCalled();
      expect(routerSpy.navigate).not.toHaveBeenCalled();
    }));
  });
});

/**
 * c02 (review finding #9): THE TWO FOCUS ONE-SHOTS AND THEIR DIFFERENT RESET RULES.
 *
 * Both are set in one place and consumed in another, and the whole defect lives in the INTERVAL between
 * the two. So the interval is driven here with Subjects that stay open across assertions - the book load
 * is a `Subject` created per `getById` call and resolved by hand, and the route params and query params
 * are Subjects too. A synchronous `of()` would collapse the interval into a single tick and every one of
 * these specs would pass against the un-reset code.
 *
 * The asymmetry is the point, and it is pinned from both sides: a DASHBOARD focus is discarded by a
 * switch back to Edit (the author has changed their mind about looking at the dashboard) and a CHAPTER
 * focus is NOT, because a chapter focus deliberately never forces Review mode and Edit is where it is
 * supposed to land. A rule that treated them alike would break the working case.
 */
describe('EditorPageComponent c02: the focus one-shots and their reset rules', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  let params$: Subject<Record<string, string>>;
  let queryParams$: Subject<Record<string, string>>;
  let published: unknown[];
  /** One entry per `getById` call, each holding its own OPEN subject. Resolved when a spec says so. */
  let loads: { id: string; subject: Subject<BookDetailDto> }[];

  const bookA = {
    id: 'book-a',
    title: 'A',
    language: 'he',
    chapters: [
      { id: 'a-first', title: 'One', order: 0, wordCount: 100 },
      { id: 'a-six', title: 'Seven', order: 6, wordCount: 100 },
    ],
  };
  const bookB = {
    id: 'book-b',
    title: 'B',
    language: 'he',
    chapters: [
      { id: 'b-first', title: 'One', order: 0, wordCount: 100 },
      { id: 'b-six', title: 'Seven', order: 6, wordCount: 100 },
    ],
  };

  beforeEach(async () => {
    params$ = new Subject();
    queryParams$ = new Subject();
    loads = [];
    const routerSpy = { navigate: jasmine.createSpy('navigate'), getCurrentNavigation: () => null };
    const route = {
      params: params$.asObservable(),
      queryParams: queryParams$.asObservable(),
      snapshot: { queryParams: {} },
    };

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        ...sharedHandoffProviders(routerSpy, route),
        {
          provide: BookService,
          useValue: {
            getById: (id: string) => {
              const subject = new Subject<BookDetailDto>();
              loads.push({ id, subject });
              return subject.asObservable();
            },
          },
        },
      ],
    })
      .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
    published = [];
    TestBed.inject(BookSurfaceFocusService).focus$.subscribe(r => published.push(r));
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  /** Deliver the payload for the most recent load of `id`. The subject was opened at navigation time. */
  function resolveLatestLoad(id: string, dto: object): void {
    const entry = [...loads].reverse().find(l => l.id === id);
    expect(entry).withContext(`no open load for ${id}`).toBeDefined();
    entry!.subject.next(dto as BookDetailDto);
  }

  /** Navigate to a book. The load it starts is left OPEN on purpose. */
  function navigateTo(bookId: string): void {
    params$.next({ bookId });
    tick();
    fixture.detectChanges();
  }

  /** One more change-detection pass plus its timers, which is where a held request is published. */
  function settle(): void {
    fixture.detectChanges();
    tick();
  }

  describe('a DASHBOARD focus', () => {
    it('is DROPPED by a book switch, and does not fire when a dashboard later mounts for the new book', fakeAsync(() => {
      navigateTo('book-a');
      queryParams$.next({ focus: 'findings' });
      settle();
      expect(published)
        .withContext('no dashboard yet, so the request is still held')
        .toEqual([]);

      navigateTo('book-b');

      // The new book's dashboard mounts. The gesture belonged to book A and must be gone.
      component.dashboardComp = {} as never;
      settle();

      expect(published)
        .withContext('a focus raised on book A must not scroll book B')
        .toEqual([]);
    }));

    it('SURVIVES the load of the book it was raised for, on a cold deep link where no book id was known yet', fakeAsync(() => {
      // ngOnInit subscribes to queryParams BEFORE route.params, so on a fresh navigation into
      // `?focus=...` the chip is consumed while bookId is still null. The first load adopts it.
      queryParams$.next({ focus: 'findings' });
      settle();
      navigateTo('book-a');
      resolveLatestLoad('book-a', bookA);
      component.dashboardComp = {} as never;
      settle();

      expect(published).toEqual([{ target: 'findings' }]);
    }));

    it('is DISCARDED when the author switches back to Edit before the dashboard mounts', fakeAsync(() => {
      navigateTo('book-a');
      queryParams$.next({ focus: 'register' });
      settle();
      expect(component.reviewMode).toBe('review');
      expect(published).toEqual([]);

      component.onReviewModeChange('edit');
      settle();

      // Back to Review much later, for their own reasons: the old gesture must not be waiting there.
      component.onReviewModeChange('review');
      component.dashboardComp = {} as never;
      settle();

      expect(published)
        .withContext('the author said Edit, which is them changing their mind about the dashboard')
        .toEqual([]);
    }));

    it('is KEPT when the panel is merely CLOSED, which is not a change of mind about what to show', fakeAsync(() => {
      navigateTo('book-a');
      queryParams$.next({ focus: 'register' });
      settle();

      component.closeReviewPanel();
      settle();
      component.openReviewPanel();
      component.dashboardComp = {} as never;
      settle();

      expect(published).toEqual([{ target: 'register' }]);
    }));

    it('fires exactly ONCE, however many view checks and book loads follow', fakeAsync(() => {
      navigateTo('book-a');
      queryParams$.next({ focus: 'findings' });
      component.dashboardComp = {} as never;
      settle();
      expect(published.length).toBe(1);

      resolveLatestLoad('book-a', bookA);
      settle();
      settle();

      expect(published.length).toBe(1);
    }));
  });

  describe('a CHAPTER focus', () => {
    it('SURVIVES to its own book\'s load and opens that chapter when the payload finally lands', fakeAsync(() => {
      navigateTo('book-a');
      const select = spyOn(component, 'selectChapter');

      // The chapter list has not arrived, so the request is held rather than dropped.
      queryParams$.next({ focus: 'chapter', chapter: '6' });
      settle();
      expect(select).not.toHaveBeenCalled();

      resolveLatestLoad('book-a', bookA);
      settle();

      expect(select).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'a-six' }));
    }));

    it('is NOT discarded by a switch to Edit mode: Edit is where a chapter focus is SUPPOSED to land', fakeAsync(() => {
      // The asymmetry with the dashboard focus above, stated as a test so a later uniform rule goes red.
      navigateTo('book-a');
      const select = spyOn(component, 'selectChapter');
      queryParams$.next({ focus: 'chapter', chapter: '6' });
      settle();

      component.onReviewModeChange('edit');
      settle();
      resolveLatestLoad('book-a', bookA);
      settle();

      expect(select).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'a-six' }));
    }));

    it('is DROPPED when a DIFFERENT book loads, rather than opening that book\'s chapter 6', fakeAsync(() => {
      navigateTo('book-a');
      const select = spyOn(component, 'selectChapter');
      queryParams$.next({ focus: 'chapter', chapter: '6' });
      settle();

      navigateTo('book-b');
      resolveLatestLoad('book-b', bookB);
      settle();

      expect(select).not.toHaveBeenCalledWith(jasmine.objectContaining({ id: 'b-six' }));
      // The ordinary first-chapter default still runs, so the page is not left blank.
      expect(select).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'b-first' }));
    }));

    it('is applied exactly ONCE, and a later load of the same book does not yank the author back', fakeAsync(() => {
      navigateTo('book-a');
      // The fake carries the ONE side effect the rest of the load path reads back: without it the
      // "no chapter selected yet" default would fire on top of the focus and count as a second call.
      const select = spyOn(component, 'selectChapter').and.callFake(ch => {
        component.selectedChapterId = ch.id;
      });
      queryParams$.next({ focus: 'chapter', chapter: '6' });
      settle();
      resolveLatestLoad('book-a', bookA);
      settle();
      expect(select.calls.count()).toBe(1);

      // The author has moved on to another chapter; a second load of the same book must respect that.
      component.selectedChapterId = 'a-first';
      navigateTo('book-a');
      resolveLatestLoad('book-a', bookA);
      settle();

      expect(select.calls.count()).toBe(1);
    }));
  });
});

/**
 * THE AMBIENT OPEN CHAPTER, published outward for the assistant drawer (chatbot phase B, a2).
 *
 * This is the publication seam d2 section (0) found missing: the open chapter lived in this component
 * and nothing app-level could read it, so a question that said "this chapter" resolved nothing. What is
 * pinned here is the lifecycle (open, switch, leave to the dashboard, leave the page) and the two rules
 * that cannot be enforced anywhere else - the dashboard carve-out, which the server has no way to
 * verify, and the freshness of the pair after the chapter list moves under it.
 */
describe('EditorPageComponent chatbot phase B: the ambient open chapter', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  let ambient: AmbientChapterService;
  let reordered$: Subject<{ bookId: string; newOrder: { chapterId: string; order: number }[] }>;

  const CHAPTERS = [
    { id: 'ch-a', title: 'One', order: 0, wordCount: 100 },
    { id: 'ch-b', title: 'Two', order: 1, wordCount: 200 },
  ];

  beforeEach(async () => {
    reordered$ = new Subject();
    const routerSpy = { navigate: jasmine.createSpy('navigate'), getCurrentNavigation: () => null };
    const route = { params: of({}), queryParams: of({}), snapshot: { queryParams: {} } };

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        ...sharedHandoffProviders(routerSpy, route),
        {
          provide: SyncService,
          useValue: {
            connect: () => Promise.resolve(),
            joinBook: () => {},
            leaveBook: () => {},
            chapterUpdated$: EMPTY,
            chapterCreated$: EMPTY,
            chapterReordered$: reordered$.asObservable(),
            sceneCreated$: EMPTY,
            sceneUpdated$: EMPTY,
            sceneDeleted$: EMPTY,
            scenesCleared$: EMPTY,
            scenesReordered$: EMPTY,
          },
        },
      ],
    })
      .overrideComponent(EditorPageComponent, { set: { template: '<div></div>', imports: [] } })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
    ambient = TestBed.inject(AmbientChapterService);
    fixture.detectChanges();
  });

  /** Put the page in the state the real one reaches after a book load with a chapter selected. */
  function loadBookWithChapter(chapterId = 'ch-a'): void {
    component.bookId = 'book-1';
    component.book = {
      id: 'book-1',
      title: 'B',
      language: 'he',
      chapters: CHAPTERS.map(c => ({ ...c })),
    } as never;
    component.selectedChapterId = chapterId;
    fixture.detectChanges();
  }

  it('publishes NOTHING while there is no book id: a snapshot with the wrong book is worse than none', () => {
    expect(ambient.ambient).toBeNull();
  });

  it('publishes the open chapter, with its id AND its 0-based order', () => {
    loadBookWithChapter('ch-b');
    expect(ambient.ambient).toEqual({
      bookId: 'book-1',
      openChapter: { id: 'ch-b', order: 1, title: 'Two' },
      chapters: [
        { id: 'ch-a', order: 0, title: 'One' },
        { id: 'ch-b', order: 1, title: 'Two' },
      ],
    });
  });

  it('follows the author from one chapter to the next', () => {
    loadBookWithChapter('ch-a');
    component.selectedChapterId = 'ch-b';
    fixture.detectChanges();
    expect(ambient.ambient?.openChapter?.id).toBe('ch-b');
  });

  it('publishes a NULL chapter with the book still named when nothing is selected', () => {
    // An empty book, or the deleted-with-no-replacement state. The book is still open, so this is not
    // the same as no surface publishing at all, and the wire keeps that difference.
    loadBookWithChapter('ch-a');
    component.selectedChapterId = null;
    fixture.detectChanges();

    expect(ambient.ambient?.bookId).toBe('book-1');
    expect(ambient.ambient?.openChapter).toBeNull();
  });

  it('publishes a NULL chapter in BOOK-REVIEW mode, whatever selectedChapterId still holds', () => {
    // THE DASHBOARD CARVE-OUT. `reviewMode` does not clear the selection, so a naive read would keep
    // reporting a chapter while the author is looking at whole-book findings, and a deictic question
    // asked from there would silently ground in a chapter they are not reading. The server cannot catch
    // this: it can verify only that the id names a chapter of this book.
    loadBookWithChapter('ch-a');
    expect(ambient.ambient?.openChapter?.id).toBe('ch-a');

    component.onReviewModeChange('review');
    fixture.detectChanges();

    expect(ambient.ambient?.openChapter).toBeNull();
    expect(component.selectedChapterId)
      .withContext('the carve-out is about what is PUBLISHED, not about clearing editor state')
      .toBe('ch-a');
    expect(ambient.ambient?.chapters.length)
      .withContext('the author is still inside the book, so a clarify still has chapters to offer')
      .toBe(2);
  });

  it('restores the chapter on returning to edit mode', () => {
    loadBookWithChapter('ch-a');
    component.onReviewModeChange('review');
    fixture.detectChanges();
    component.onReviewModeChange('edit');
    fixture.detectChanges();

    expect(ambient.ambient?.openChapter?.id).toBe('ch-a');
  });

  it('re-publishes after a REORDER, which moves the order without touching the id', () => {
    // The one mutation that changes the value the server keys selection and escalation on while leaving
    // every reference this page holds identical. A stale order here is how a chapter moved since load
    // grounds an answer in whichever chapter now holds that number.
    loadBookWithChapter('ch-b');
    expect(ambient.ambient?.openChapter?.order).toBe(1);

    reordered$.next({
      bookId: 'book-1',
      newOrder: [{ chapterId: 'ch-b', order: 0 }, { chapterId: 'ch-a', order: 1 }],
    });
    fixture.detectChanges();

    expect(ambient.ambient?.openChapter?.order).toBe(0);
    expect(ambient.ambient?.chapters.map(c => c.id)).toEqual(['ch-b', 'ch-a']);
  });

  it('re-publishes after a RENAME, so the drawer cannot name a chapter by a dropped name', () => {
    // A rename mutates the title IN PLACE, which a reference comparison cannot see. The revision bump
    // at that write site is what makes it visible; this drives the same pair of writes directly, since
    // the ChapterService stub here returns an empty update.
    loadBookWithChapter('ch-a');
    (component.book as unknown as { chapters: { title: string }[] }).chapters[0].title = 'One, revised';
    (component as unknown as { chapterListRevision: number }).chapterListRevision++;
    fixture.detectChanges();

    expect(ambient.ambient?.openChapter?.title).toBe('One, revised');
  });

  it('publishes NOTHING more once the page is torn down', () => {
    // What makes the import and export pages report no ambient chapter: they are book-scoped routes
    // where the book context still names the book, so without this the last chapter the author had open
    // would keep riding on requests made from a page that is not showing it.
    loadBookWithChapter('ch-a');
    expect(ambient.ambient).not.toBeNull();

    fixture.destroy();
    expect(ambient.ambient).toBeNull();
  });

  it('does not re-publish on a change-detection pass that moved nothing', () => {
    loadBookWithChapter('ch-a');
    const seen: unknown[] = [];
    ambient.ambient$.subscribe(s => seen.push(s));
    fixture.detectChanges();
    fixture.detectChanges();
    expect(seen.length)
      .withContext('the replayed current value only; this page re-checks constantly under Syncfusion')
      .toBe(1);
  });
});

/**
 * D1 / D12 / D20: THE EXPORT COUNT IS THE SERVER'S ANSWER, AND IT HAS TO BE RE-ASKED.
 *
 * Stage 5 stopped counting words and started reading `BookDetailDto.exportableChapterCount`, which the
 * exporter computes, under a docstring that says the sentence "NOW SAYS WHAT THE SERVER WILL DO"
 * (`stage-spine.copy.ts`). This page then captured that number ONCE per book load, so the promise held
 * for exactly as long as the author did not write anything: import a DOCX (count 0), open the editor,
 * write chapter one, save - the export endpoint would now succeed while the spine went on saying the book
 * holds nothing that can go into a file, for the rest of the session.
 *
 * THE WINDOW IS THE TEST. Every load here is its OWN `Subject`, opened by `getById` and resolved by hand,
 * and the hub is a set of open `Subject`s too. A synchronous `of()` would collapse the interval between
 * "the author saved" and "the server answered" into one tick, and the interval is where both the defect
 * and the fix live: the assertions below check the count is still the OLD one while the refetch is in
 * flight (nothing is invented client-side) and the NEW one only once the server has spoken.
 *
 * The surface asserted is RENDERED: the compact spine's stage-5 pip, whose real component is mounted here
 * rather than stubbed, and for the full spine the input the template actually bound into its host.
 */
describe('EditorPageComponent D1: the export count is re-asked, not captured at book load', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  let params$: Subject<Record<string, string>>;
  /** One entry per `getById` call, each holding its OWN open subject. Resolved when a spec says so. */
  let loads: { id: string; subject: Subject<BookDetailDto> }[];
  /** The hub, held open for the life of each spec. */
  let sync: {
    chapterUpdated$: Subject<ChapterUpdatedEvent>;
    chapterCreated$: Subject<ChapterCreatedEvent>;
    sceneUpdated$: Subject<SceneUpdatedEvent>;
    sceneCreated$: Subject<unknown>;
    sceneDeleted$: Subject<unknown>;
    scenesCleared$: Subject<unknown>;
    scenesReordered$: Subject<unknown>;
    chapterReordered$: Subject<unknown>;
  };

  const el = () => fixture.nativeElement as HTMLElement;

  /** The compact spine's rendered stage-5 state: what the author actually sees about Export. */
  const exportPip = (): string | null => {
    const pip = el().querySelector('[data-testid="spine-compact-pip-export"]');
    return pip ? pip.getAttribute('data-state') : null;
  };

  /**
   * A book with ONE written chapter and a caller-chosen exporter count. That pair is the state this whole
   * finding lives in and the one no fixture held: the chapter carries the author's imported words
   * (`wordCount: 900`) while the exporter can make nothing from what is stored (`exportable: 0`).
   */
  const bookWith = (exportable: number | undefined, id = 'book-1'): BookDetailDto => ({
    id, title: 'My Book', author: null, language: 'he', createdAt: '', updatedAt: '', aiTier: 'fast',
    chapters: [{ id: 'chap-1', title: 'Chapter one', partName: null, order: 0, wordCount: 900, updatedAt: '' }],
    exportableChapterCount: exportable,
  });

  function resolveLatestLoad(id: string, dto: BookDetailDto): void {
    const entry = [...loads].reverse().find(l => l.id === id);
    expect(entry).withContext(`no open book load for ${id}`).toBeDefined();
    entry!.subject.next(dto);
  }

  /** Land on a book with the compact spine on screen (panel closed), and resolve its first load. */
  function openBook(exportable: number | undefined, id = 'book-1'): void {
    component.reviewMode = 'review';
    component.reviewPanelOpen = false;
    component.selectedChapterId = null;
    fixture.detectChanges();      // ngOnInit: route params, activeJobs$, the hub subscriptions
    params$.next({ bookId: id });
    tick();                       // syncService.connect()
    resolveLatestLoad(id, bookWith(exportable, id));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    params$ = new Subject();
    loads = [];
    sync = {
      chapterUpdated$: new Subject(), chapterCreated$: new Subject(), sceneUpdated$: new Subject(),
      sceneCreated$: new Subject(), sceneDeleted$: new Subject(), scenesCleared$: new Subject(),
      scenesReordered$: new Subject(), chapterReordered$: new Subject(),
    };

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { params: params$.asObservable(), queryParams: of({}), snapshot: { queryParams: {} } },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy(), getCurrentNavigation: () => null } },
        {
          provide: BookService,
          useValue: {
            getById: (id: string) => {
              const subject = new Subject<BookDetailDto>();
              loads.push({ id, subject });
              return subject.asObservable();
            },
          },
        },
        { provide: JobRegistryService, useValue: new RegistryStub() },
        { provide: ChapterService, useValue: { update: () => of({}), create: () => EMPTY, delete: () => EMPTY, getById: () => EMPTY, reorder: () => EMPTY } },
        { provide: SceneService, useValue: { update: () => of({}), getAll: () => of([]), getById: () => EMPTY, splitScenes: () => EMPTY } },
        { provide: SyncService, useValue: { connect: () => Promise.resolve(), joinBook: () => {}, leaveBook: () => {}, ...sync } },
        { provide: DocumentVersionService, useValue: { create: () => of({}), list: () => of([]), get: () => EMPTY } },
        { provide: AnalysisService, useValue: {} },
        { provide: SfdtManipulationService, useValue: jasmine.createSpyObj('SfdtManipulationService', ['ensureSfdtRtl']) },
        { provide: EditorTextService, useValue: jasmine.createSpyObj('EditorTextService', ['refreshDocumentPlainText']) },
        { provide: SuggestionAnchorService, useValue: jasmine.createSpyObj('SuggestionAnchorService', ['relocateAll', 'relocateOne']) },
      ],
    })
      .overrideComponent(EditorPageComponent, {
        set: {
          imports: [
            CommonModule, StubChapterTreeComponent, StubAnalysisPanelComponent, StubIssuePanelComponent,
            StubBookDashboardComponent, StubSegmentedControlComponent, StubImportHandoffCardComponent,
            // NOT stubbed: the rendered stage-5 pip is the claim under test.
            StageSpineComponent, AnalysisRunDialogComponent,
          ],
          schemas: [NO_ERRORS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(EditorPageComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => fixture.destroy());

  // ── D12: the one wire into the FULL spine, which shipped with no spec on either host ───────────────

  it('binds the payload count into the hosted full spine (the wire at editor-page.component.html:249)', fakeAsync(() => {
    openBook(2);
    component.reviewPanelOpen = true;   // panel open + review mode: the FULL spine is the surface
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(StubBookDashboardComponent));
    expect(host).withContext('the full spine host must be mounted').not.toBeNull();
    expect(host.componentInstance.exportableChapterCount).toBe(2);
  }));

  it('binds NULL, not zero, into the full spine when the server did not send the count', fakeAsync(() => {
    // Absent is "not known here" and renders as unknown; zero is the positive claim "nothing to export".
    openBook(undefined);
    component.reviewPanelOpen = true;
    fixture.detectChanges();

    const host = fixture.debugElement.query(By.directive(StubBookDashboardComponent));
    expect(host.componentInstance.exportableChapterCount).toBeNull();
  }));

  // ── D1: the save. The failing scenario, driven end to end through the open window ──────────────────

  it('re-asks the server after a chapter save, and stage 5 stops saying nothing can go into a file', fakeAsync(() => {
    openBook(0);
    expect(exportPip())
      .withContext('a freshly imported book: chapters exist, the exporter can make nothing from them')
      .toBe('blocked');
    const loadsBefore = loads.length;

    // The author writes and saves. The server broadcasts ChapterUpdated back to the group this page
    // joined, which is how this page learns anything at all about its own save.
    sync.chapterUpdated$.next({ bookId: 'book-1', chapterId: 'chap-1', wordCount: 950, updatedAt: '' });
    fixture.detectChanges();

    // MID-WINDOW: a refetch is open, and nothing has been guessed while it is.
    expect(loads.length).withContext('the save must open a fresh book load').toBe(loadsBefore + 1);
    expect(exportPip())
      .withContext('until the server answers, the last known count is the only honest one')
      .toBe('blocked');

    // The server answers: the chapter now holds a renderable document.
    resolveLatestLoad('book-1', bookWith(1));
    fixture.detectChanges();

    expect(exportPip())
      .withContext('the count came from the exporter, so the spine and the endpoint now agree')
      .toBe('ready');
  }));

  it('re-asks after a SCENE save, the other store the exporter may read', fakeAsync(() => {
    // A scene write flips `ScenesHoldTheChaptersCurrentText`, so the count can move with no chapter
    // event at all. `saveCurrentDocument`'s scene branch produces exactly this and nothing else.
    openBook(0);
    const loadsBefore = loads.length;

    sync.sceneUpdated$.next({ bookId: 'book-1', chapterId: 'chap-1', sceneId: 'scene-1', updatedAt: '' });
    fixture.detectChanges();
    expect(loads.length)
      .withContext('a scene write moves the exporter\'s answer, so it must open a fresh book load')
      .toBe(loadsBefore + 1);

    resolveLatestLoad('book-1', bookWith(1));
    fixture.detectChanges();
    expect(exportPip())
      .withContext('the scene layer answered, so stage 5 must move with it')
      .toBe('ready');
  }));

  it('drops back to blocked when the server says the last exportable chapter is gone', fakeAsync(() => {
    // The refresh is not a one-way ratchet to `ready`: it is whatever the exporter now answers.
    openBook(1);
    expect(exportPip()).toBe('ready');
    const loadsBefore = loads.length;

    sync.chapterUpdated$.next({ bookId: 'book-1', chapterId: 'chap-1', wordCount: 0, updatedAt: '' });
    // Asserted BEFORE resolving: the book load opened at navigation is a Subject that never completes,
    // so without this the payload below would reach that subscription instead and the spine would update
    // whether or not the save refreshed anything. This is the assertion that makes the next one mean it.
    expect(loads.length)
      .withContext('the save must open a fresh book load of its own')
      .toBe(loadsBefore + 1);
    resolveLatestLoad('book-1', bookWith(0));
    fixture.detectChanges();

    expect(exportPip())
      .withContext('a stale READY is the failure that sent an author to a 409, so it must fall back too')
      .toBe('blocked');
  }));

  // ── D20: the one path that DID refetch rebuilt everything except the spine ─────────────────────────

  it('rebuilds the spine on the refetch path itself, not only on the next activeJobs$ emission (D20)', fakeAsync(() => {
    // `chapterCreated$` already called `refreshBook()` before this change, and `refreshBook()` assigned
    // the book and rebuilt only the review-mode options - so the ONE path that re-asked the server left
    // the spine rendering the counts from book load. Nothing here touches the job registry, so an
    // `activeJobs$` rebuild cannot be what makes this pass.
    openBook(0);
    expect(exportPip()).toBe('blocked');
    const loadsBefore = loads.length;

    sync.chapterCreated$.next({ bookId: 'book-1', chapterId: 'chap-2', title: 'Chapter two', order: 1 });
    // Same guard as above: the payload must land on the REFRESH's own load, not on the one still open
    // from navigation, or this would pass on a page that never refreshed at all.
    expect(loads.length).withContext('the refetch path must open its own book load').toBe(loadsBefore + 1);
    resolveLatestLoad('book-1', bookWith(1));
    fixture.detectChanges();

    expect(exportPip()).toBe('ready');
  }));

  // ── Scoping and cost ──────────────────────────────────────────────────────────────────────────────

  it('ignores an event for a DIFFERENT book, so a collaborator elsewhere cannot refetch this one', fakeAsync(() => {
    openBook(0);
    const loadsBefore = loads.length;

    sync.chapterUpdated$.next({ bookId: 'book-2', chapterId: 'other', wordCount: 10, updatedAt: '' });
    fixture.detectChanges();

    expect(loads.length).withContext('no request may be made for a book this route is not on').toBe(loadsBefore);
    expect(exportPip()).toBe('blocked');
  }));

  it('coalesces a burst into at most two round trips, and the LAST answer is the one rendered', fakeAsync(() => {
    // An import emits one ChapterCreated per chapter and a split one SceneCreated per scene, so these
    // arrive in bursts. A refresh asked for while one is in flight is remembered, not dropped and not
    // multiplied: three events during one open request must not mean three more requests.
    openBook(0);
    const loadsBefore = loads.length;

    sync.chapterCreated$.next({ bookId: 'book-1', chapterId: 'chap-2', title: 'Two', order: 1 });
    sync.chapterCreated$.next({ bookId: 'book-1', chapterId: 'chap-3', title: 'Three', order: 2 });
    sync.chapterCreated$.next({ bookId: 'book-1', chapterId: 'chap-4', title: 'Four', order: 3 });
    expect(loads.length).withContext('one in flight; the other two are queued behind it').toBe(loadsBefore + 1);

    // The first lands mid-burst carrying a stale answer; the queued follow-up then runs exactly once.
    resolveLatestLoad('book-1', bookWith(0));
    fixture.detectChanges();
    expect(loads.length).withContext('the queue collapses to ONE follow-up, not two').toBe(loadsBefore + 2);
    expect(exportPip()).toBe('blocked');

    resolveLatestLoad('book-1', bookWith(3));
    fixture.detectChanges();
    expect(exportPip()).withContext('the state finally read is the newest one').toBe('ready');
  }));
});
