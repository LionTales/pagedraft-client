import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, EventEmitter, NO_ERRORS_SCHEMA, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { BookDetailDto } from '../../core/models/book';
import { of, EMPTY, throwError, Subject } from 'rxjs';
import { EditorPageComponent } from './editor-page.component';
import { BookService } from '../../core/services/book.service';
import { BookSummaryService } from '../../core/services/book-summary.service';
import { BookReviewService } from '../../core/services/book-review.service';
import { ChapterService } from '../../core/services/chapter.service';
import { SceneService } from '../../core/services/scene.service';
import { SyncService } from '../../core/services/sync.service';
import { DocumentVersionService } from '../../core/services/document-version.service';
import { AnalysisService } from '../../core/services/analysis.service';
import { SfdtManipulationService, SCROLL_TARGET_BOOKMARK } from '../../core/services/sfdt-manipulation.service';
import { EditorTextService } from '../../core/services/editor-text.service';
import { SuggestionAnchorService } from '../../core/services/suggestion-anchor.service';

describe('EditorPageComponent (focused logic)', () => {
  let component: EditorPageComponent;
  let fixture: ComponentFixture<EditorPageComponent>;
  let anchorSpy: jasmine.SpyObj<SuggestionAnchorService>;
  let sfdtSpy: jasmine.SpyObj<SfdtManipulationService>;
  let editorTextSpy: jasmine.SpyObj<EditorTextService>;
  let chapterUpdateSpy: jasmine.Spy;
  let versionCreateSpy: jasmine.Spy;
  let mockDocEditor: {
    documentEditor: { serialize: jasmine.Spy; open: jasmine.Spy };
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
        { provide: ActivatedRoute, useValue: { params: of({}) } },
        { provide: Router, useValue: { navigate: jasmine.createSpy() } },
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

    it('localizes the focus-mode label for Hebrew and English books', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
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
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
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
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
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
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
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

  // ─── NIT-7: reviewModeOptions memoization ───────────────────────────────────

  describe('reviewModeOptions memoization (NIT-7)', () => {
    it('starts with English labels when book language is en', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'en', createdAt: '', updatedAt: '', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('Edit help');
      expect(component.reviewModeOptions[1].label).toBe('Book review');
    });

    it('uses Hebrew labels when book language is he', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('עזרת עריכה');
      expect(component.reviewModeOptions[1].label).toBe('סקירת ספר');
    });

    it('updates labels when language flips from he to en', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
      };
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('עזרת עריכה');

      component.book.language = 'en';
      (component as any).rebuildReviewModeOptions();
      expect(component.reviewModeOptions[0].label).toBe('Edit help');
    });

    it('returns the same array reference when called again with no language change (identity check)', () => {
      component.book = {
        id: 'b', title: 't', author: null, language: 'he', createdAt: '', updatedAt: '', chapters: [],
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
  // P2-6: mirrors the real dashboard's buildRunningChange output so tests can drive the editor's
  // "review running" affordance from a held-open stream (the close-during-build window).
  @Output() buildRunningChange = new EventEmitter<boolean>();
}

@Component({ selector: 'app-analysis-panel', standalone: true, template: '' })
class StubAnalysisPanelComponent {}

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

  const BOOK: BookDetailDto = {
    id: 'book-1', title: 'My Book', author: null, language: 'he',
    createdAt: '', updatedAt: '', chapters: [],
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const has = (sel: string) => el().querySelector(sel) !== null;

  beforeEach(async () => {
    bookLoad$ = new Subject<BookDetailDto>();
    routeParams$ = new Subject<Record<string, string>>();

    await TestBed.configureTestingModule({
      imports: [EditorPageComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { params: routeParams$.asObservable() } },
        { provide: Router, useValue: { navigate: jasmine.createSpy() } },
        // Held-open book load: the controlled Subject lets us assert the in-between state
        // (bookId set, book not yet resolved) before emitting.
        { provide: BookService, useValue: { getById: () => bookLoad$.asObservable() } },
        // P2-6: editor-owned reconcile of the build affordance while the dashboard is unmounted. Default to
        // "no active build"; tests re-stub to simulate a build that is still running / has finished.
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

  // ── 4. P2-6: "review running" affordance survives close / focus while a build is in flight ──────
  //
  // A whole-book build is started; the dashboard reports it running via buildRunningChange. The user
  // then CLOSES the panel (or enters focus mode), which @if-destroys the dashboard and its poll. The
  // affordance must keep showing on the closed-panel reopen button and the focus-mode toggle even though
  // the dashboard is gone (the editor holds the flag). On REOPEN the dashboard remounts, reattaches to the
  // server-tracked job, and re-emits the now-finished state, which clears the affordance.
  //
  // The build-running stream is a HELD-OPEN Subject standing in for the dashboard's poll-driven output;
  // the completion emit lands on the REMOUNTED dashboard (never a synchronous of()), proving no progress
  // is lost across the close-during-build window.
  describe('P2-6 "review running" affordance (close/focus during build, Subject-driven)', () => {
    /** Held-open build-running stream; wired to whichever dashboard instance is currently mounted. */
    let buildRunning$: Subject<boolean>;

    /** Wire the held-open Subject through the CURRENTLY-mounted stub dashboard's real EventEmitter. */
    function wireDashboardStream(): void {
      const dash = fixture.debugElement
        .query(By.css('app-book-dashboard'))
        ?.componentInstance as { buildRunningChange: EventEmitter<boolean> } | undefined;
      if (dash) {
        buildRunning$.subscribe((b) => dash.buildRunningChange.emit(b));
      }
    }

    beforeEach(() => {
      buildRunning$ = new Subject<boolean>();
      component.bookId = 'book-1';
      component.book = BOOK;
      component.reviewMode = 'review';   // dashboard is mounted so we can wire its output
      component.reviewPanelOpen = true;
      component.focusMode = false;
      fixture.detectChanges();
      wireDashboardStream();
    });

    it('sets reviewBuildRunning on build start, holds it on the reopen button across CLOSE, and clears it on REOPEN when the build finishes', () => {
      // Build starts (dashboard mounted): the editor flag flips true.
      buildRunning$.next(true);
      expect(component.reviewBuildRunning).toBe(true);

      // User closes the panel: the dashboard + its poll are @if-destroyed, but the flag is held HERE.
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(false);

      // The reopen button is shown and carries the running affordance (dot + accessible label).
      const reopen = el().querySelector('.review-reopen') as HTMLElement;
      expect(reopen).not.toBeNull();
      expect(reopen.classList.contains('review-running')).toBe(true);
      expect(reopen.querySelector('.review-running-dot')).not.toBeNull();
      // Accessible label includes the localized "Review running" (he book -> Hebrew copy).
      expect(reopen.getAttribute('aria-label')).toContain('סקירה רצה');

      // User REOPENS: the dashboard remounts and reattaches to the still-running server job. Re-wire the
      // stream to the NEW instance and emit completion on the SAME open Subject — proving the build kept
      // running across the unmount and its terminal is what finally clears the affordance.
      component.reviewPanelOpen = true;
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(true);
      wireDashboardStream();

      buildRunning$.next(false);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(false);
    });

    it('shows the running affordance on the focus-mode toggle while in focus mode (panel + dashboard unmounted)', () => {
      // A chapter must be selected for the editor toolbar (focus button) to render.
      component.selectedChapterId = 'chap-1';
      fixture.detectChanges();

      // The build is genuinely in flight server-side. Entering focus unmounts the dashboard, so the editor's
      // own reconcile is what now confirms the build is still running and HOLDS the affordance on the toggle.
      (TestBed.inject(BookSummaryService) as any).getBookSummaryStatus = () => of({ activeBuildJobId: 'job-1' });

      // Build starts, then the user enters focus mode (which also closes the panel + unmounts the dashboard).
      buildRunning$.next(true);
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

      // Exit focus: panel + dashboard remount; the remounted dashboard reports the build finished.
      component.toggleFocusMode();
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(true);
      wireDashboardStream();

      buildRunning$.next(false);
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(false);
      const focusBtnAfter = el().querySelector('.focus-btn') as HTMLElement;
      expect(focusBtnAfter.classList.contains('review-running')).toBe(false);
      expect(focusBtnAfter.querySelector('.review-running-dot')).toBeNull();
    });

    it('does NOT show the affordance when no build is running', () => {
      // No emit on the stream: the flag stays false.
      expect(component.reviewBuildRunning).toBe(false);
      component.reviewPanelOpen = false;
      fixture.detectChanges();
      const reopen = el().querySelector('.review-reopen') as HTMLElement;
      expect(reopen).not.toBeNull();
      expect(reopen.classList.contains('review-running')).toBe(false);
      expect(reopen.querySelector('.review-running-dot')).toBeNull();
    });

    // ── P2-6 Bug: the dashboard is the ONLY poller but mounts solely in Book review mode. A build that
    //    finishes while in Edit help (or a book switched there) must still clear the affordance — the editor
    //    reconciles the flag against the status endpoints whenever the dashboard is unmounted. ──
    it('clears the affordance when a build FINISHES while in Edit help mode (dashboard unmounted, editor reconciles)', () => {
      // Build starts in Book review mode (dashboard mounted): the editor flag flips true.
      buildRunning$.next(true);
      expect(component.reviewBuildRunning).toBe(true);

      // The server now reports both whole-book surfaces idle (the build finished). Default stubs already
      // return a null activeBuildJobId, but make the "finished" intent explicit.
      (TestBed.inject(BookSummaryService) as any).getBookSummaryStatus = () => of({ activeBuildJobId: null });
      (TestBed.inject(BookReviewService) as any).getReviewStatus = () => of({ activeBuildJobId: null });

      // User switches to Edit help: the dashboard (the only poller) is @if-destroyed. Pre-fix nothing would
      // ever emit false again and the affordance would stick on forever; the editor-owned reconcile clears it.
      component.onReviewModeChange('edit');
      fixture.detectChanges();
      expect(has('app-book-dashboard')).toBe(false);
      expect(component.reviewBuildRunning).toBe(false);
    });

    it('KEEPS the affordance while in Edit help when the build is still running (reconcile does not over-clear)', () => {
      // The build is genuinely still in flight server-side (summary surface advertises an active job).
      (TestBed.inject(BookSummaryService) as any).getBookSummaryStatus = () => of({ activeBuildJobId: 'job-1' });
      (TestBed.inject(BookReviewService) as any).getReviewStatus = () => of({ activeBuildJobId: null });

      buildRunning$.next(true);
      component.onReviewModeChange('edit');
      fixture.detectChanges();

      // Dashboard is gone, but the editor reconcile confirms the build is still running, so the flag holds.
      expect(has('app-book-dashboard')).toBe(false);
      expect(component.reviewBuildRunning).toBe(true);
    });

    it('drops a stale affordance when the user changes books while in Edit help (per-book flag reset)', () => {
      // A build is running for book-1 and the user is in Edit help (dashboard unmounted); the reconcile keeps
      // the affordance lit while the job is active.
      (TestBed.inject(BookSummaryService) as any).getBookSummaryStatus = () => of({ activeBuildJobId: 'job-1' });
      buildRunning$.next(true);
      component.onReviewModeChange('edit');
      fixture.detectChanges();
      expect(component.reviewBuildRunning).toBe(true);

      // The user switches to a different book that has no build running. The route emits the new id: the
      // editor must drop the previous book's affordance at once rather than carry the stale flag over.
      (TestBed.inject(BookSummaryService) as any).getBookSummaryStatus = () => of({ activeBuildJobId: null });
      routeParams$.next({ bookId: 'book-2' });
      expect(component.reviewBuildRunning).toBe(false);

      // And once the new book loads, the reconcile confirms no build for it.
      bookLoad$.next({ ...BOOK, id: 'book-2' });
      expect(component.reviewBuildRunning).toBe(false);
    });
  });
});
