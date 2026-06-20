import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, EMPTY, throwError } from 'rxjs';
import { EditorPageComponent } from './editor-page.component';
import { BookService } from '../../core/services/book.service';
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

    it('restores selection and scene editor content when deleting the SELECTED scene fails', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.selectedSceneId = 'scene-1';
      component.selectedChapterId = 'chap-1';
      sceneDeleteSpy.and.returnValue(throwError(() => new Error('x')));

      component.onDeleteScene({ scene: SCENE, chapterId: 'chap-1' });

      // The scene still exists server-side, so selection + scene content are restored
      // (otherwise the UI would show chapter view with nothing selected).
      expect(component.selectedSceneId).toBe('scene-1');
      // loadSceneContent reloads the scene editor content via sceneService.getById
      expect(sceneGetByIdSpy).toHaveBeenCalledWith('book-1', 'chap-1', 'scene-1');
      // The scene list is also reconciled with the server
      expect(sceneGetAllSpy).toHaveBeenCalledWith('book-1', 'chap-1');
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
  });
});
