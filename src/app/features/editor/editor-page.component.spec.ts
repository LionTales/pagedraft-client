import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, EMPTY } from 'rxjs';
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
});
