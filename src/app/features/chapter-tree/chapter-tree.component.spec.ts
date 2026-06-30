import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChapterTreeComponent } from './chapter-tree.component';
import { ChapterSummaryDto, SceneSummaryDto } from '../../core/models/book';

function makeChapter(overrides: Partial<ChapterSummaryDto> = {}): ChapterSummaryDto {
  return {
    id: 'ch-1',
    title: 'Chapter One',
    order: 0,
    wordCount: 100,
    partName: null,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function makeScene(overrides: Partial<SceneSummaryDto> = {}): SceneSummaryDto {
  return {
    id: 'sc-1',
    chapterId: 'ch-1',
    title: 'Scene One',
    order: 0,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

describe('ChapterTreeComponent', () => {
  let fixture: ComponentFixture<ChapterTreeComponent>;
  let component: ChapterTreeComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChapterTreeComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ChapterTreeComponent);
    component = fixture.componentInstance;
    component.chapters = [makeChapter()];
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ─── deleteScene Output ──────────────────────────────────────────────────

  describe('onDeleteScene', () => {
    it('emits deleteScene with the scene and chapterId', () => {
      const scene = makeScene();
      const emitted: { scene: SceneSummaryDto; chapterId: string }[] = [];
      component.deleteScene.subscribe(e => emitted.push(e));

      component.onDeleteScene(scene, 'ch-1');

      expect(emitted.length).toBe(1);
      expect(emitted[0].scene).toBe(scene);
      expect(emitted[0].chapterId).toBe('ch-1');
    });

    it('closes the scene context menu after emitting', () => {
      const scene = makeScene();
      component.sceneContextMenu = { visible: true, x: 10, y: 20, scene, chapterId: 'ch-1' };

      component.onDeleteScene(scene, 'ch-1');

      expect(component.sceneContextMenu.visible).toBe(false);
    });

    it('does nothing when scene is null', () => {
      const emitted: unknown[] = [];
      component.deleteScene.subscribe(e => emitted.push(e));

      component.onDeleteScene(null, 'ch-1');

      expect(emitted.length).toBe(0);
    });

    it('does nothing when chapterId is null', () => {
      const emitted: unknown[] = [];
      component.deleteScene.subscribe(e => emitted.push(e));

      component.onDeleteScene(makeScene(), null);

      expect(emitted.length).toBe(0);
    });
  });

  // ─── clearScenes Output ──────────────────────────────────────────────────

  describe('onClearScenes', () => {
    it('emits clearScenes with the chapter', () => {
      const ch = makeChapter();
      const emitted: ChapterSummaryDto[] = [];
      component.clearScenes.subscribe(e => emitted.push(e));

      component.onClearScenes(ch);

      expect(emitted.length).toBe(1);
      expect(emitted[0]).toBe(ch);
    });

    it('closes the chapter context menu after emitting', () => {
      const ch = makeChapter();
      component.contextMenu = { visible: true, x: 5, y: 5, chapter: ch };

      component.onClearScenes(ch);

      expect(component.contextMenu.visible).toBe(false);
    });
  });

  // ─── hasScenes guard ─────────────────────────────────────────────────────

  describe('hasScenes', () => {
    it('returns false when chapter has no scenes', () => {
      component.scenesMap = { 'ch-1': [] };
      fixture.detectChanges();
      expect(component.hasScenes('ch-1')).toBe(false);
    });

    it('returns true when chapter has scenes', () => {
      component.scenesMap = { 'ch-1': [makeScene()] };
      fixture.detectChanges();
      expect(component.hasScenes('ch-1')).toBe(true);
    });

    it('returns false for an unknown chapterId', () => {
      component.scenesMap = {};
      fixture.detectChanges();
      expect(component.hasScenes('unknown')).toBe(false);
    });
  });

  // ─── scenesKnownEmpty guard (disable only when KNOWN empty) ────────────────

  describe('scenesKnownEmpty', () => {
    it('returns false when the chapter key is ABSENT (scenes not yet loaded) -> button ENABLED', () => {
      component.scenesMap = {};
      fixture.detectChanges();
      expect(component.scenesKnownEmpty('ch-1')).toBe(false);
    });

    it('returns true when the chapter key is PRESENT but empty -> button DISABLED', () => {
      component.scenesMap = { 'ch-1': [] };
      fixture.detectChanges();
      expect(component.scenesKnownEmpty('ch-1')).toBe(true);
    });

    it('returns false when the chapter has scenes -> button ENABLED', () => {
      component.scenesMap = { 'ch-1': [makeScene()] };
      fixture.detectChanges();
      expect(component.scenesKnownEmpty('ch-1')).toBe(false);
    });
  });

  // ─── openSceneContextMenu ─────────────────────────────────────────────────

  describe('openSceneContextMenu', () => {
    it('shows scene context menu and closes chapter context menu', () => {
      const ch = makeChapter();
      component.contextMenu = { visible: true, x: 0, y: 0, chapter: ch };
      const scene = makeScene();
      const event = new MouseEvent('contextmenu', { clientX: 100, clientY: 200 });

      component.openSceneContextMenu(event, scene, 'ch-1');

      expect(component.sceneContextMenu.visible).toBe(true);
      expect(component.sceneContextMenu.scene).toBe(scene);
      expect(component.sceneContextMenu.chapterId).toBe('ch-1');
      expect(component.sceneContextMenu.x).toBe(100);
      expect(component.sceneContextMenu.y).toBe(200);
      expect(component.contextMenu.visible).toBe(false);
    });
  });

  // ─── context-menu "Remove all scenes" guards ─────────────────────────────

  describe('"Remove all scenes" is guarded by hasScenes', () => {
    it('hasScenes returns false when no scenes are loaded for the chapter', () => {
      component.scenesMap = {};
      fixture.detectChanges();
      // The button is disabled when !hasScenes(chapter.id).
      // Test the guard method directly since rendering requires expansion state.
      expect(component.hasScenes('ch-1')).toBe(false);
    });

    it('hasScenes returns true after scenes are loaded', () => {
      component.scenesMap = { 'ch-1': [makeScene()] };
      fixture.detectChanges();
      expect(component.hasScenes('ch-1')).toBe(true);
    });
  });

  // ─── book-scoped chrome localization (he default / en book) ──────────────

  describe('chrome localization follows the book language', () => {
    it('defaults to Hebrew labels + rtl when no bookLanguage is set', () => {
      component.bookLanguage = null;
      fixture.detectChanges();

      expect(component.lang).toBe('he');
      expect(component.dir).toBe('rtl');
      expect(component.label('addChapter')).toBe('הוספת פרק');
      expect(component.label('splitScenes')).toBe('פיצול לסצנות');
      expect(component.label('removeAllScenes')).toBe('הסרת כל הסצנות');
      expect(component.label('deleteScene')).toBe('מחיקת סצנה');
      expect(component.label('general')).toBe('כללי');
      expect(component.label('toggleScenes')).toBe('הצג/הסתר סצנות');
    });

    it('uses English labels + ltr when the book language is English', () => {
      component.bookLanguage = 'en';
      fixture.detectChanges();

      expect(component.lang).toBe('en');
      expect(component.dir).toBe('ltr');
      expect(component.label('addChapter')).toBe('Add chapter');
      expect(component.label('splitScenes')).toBe('Split scenes');
      expect(component.label('removeAllScenes')).toBe('Remove all scenes');
      expect(component.label('deleteScene')).toBe('Delete scene');
      expect(component.label('general')).toBe('General');
      expect(component.label('toggleScenes')).toBe('Toggle scenes');
    });

    it('treats an explicit Hebrew language code as Hebrew', () => {
      component.bookLanguage = 'he';
      fixture.detectChanges();

      expect(component.lang).toBe('he');
      expect(component.dir).toBe('rtl');
      expect(component.label('noChapters')).toBe('אין עדיין פרקים.');
    });

    it('renders a localized add-chapter button in the template', () => {
      component.bookLanguage = 'en';
      fixture.detectChanges();
      const btn = (fixture.nativeElement as HTMLElement).querySelector('.add-chapter');
      expect(btn?.textContent?.trim()).toBe('Add chapter');
    });
  });

  // ─── closeSceneContextMenu ────────────────────────────────────────────────

  describe('closeSceneContextMenu', () => {
    it('resets all scene context menu fields', () => {
      const scene = makeScene();
      component.sceneContextMenu = { visible: true, x: 50, y: 60, scene, chapterId: 'ch-1' };

      component.closeSceneContextMenu();

      expect(component.sceneContextMenu).toEqual({ visible: false, x: 0, y: 0, scene: null, chapterId: null });
    });
  });
});
