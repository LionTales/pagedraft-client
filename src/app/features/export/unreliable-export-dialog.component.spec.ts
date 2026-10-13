import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BookProofreadUnreliableChapter } from '../../core/models/book-proofread';
import { UnreliableChoice } from './unreliable-export';
import { UnreliableExportDialogComponent } from './unreliable-export-dialog.component';

const CHAPTERS: BookProofreadUnreliableChapter[] = [
  { chapterId: 'ch-0', title: 'One', order: 0 },
  { chapterId: 'ch-2', title: 'Three', order: 2 },
];

/** Mounts the dialog with `@if` exactly as the export page does, next to a trigger button that holds focus. */
@Component({
  standalone: true,
  imports: [UnreliableExportDialogComponent],
  template: `
    <button id="trigger" type="button">trigger</button>
    @if (open) {
      <app-unreliable-export-dialog [lang]="'en'" [chapters]="chapters" (choose)="onChoose($event)">
      </app-unreliable-export-dialog>
    }
  `,
})
class HostComponent {
  open = false;
  chapters = CHAPTERS;
  choices: UnreliableChoice[] = [];
  onChoose(choice: UnreliableChoice): void {
    this.choices.push(choice);
    this.open = false;
  }
}

describe('UnreliableExportDialogComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const q = (testId: string): HTMLButtonElement | null =>
    document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement | null;
  const trigger = () => fixture.nativeElement.querySelector('#trigger') as HTMLButtonElement;

  function openDialog(): void {
    trigger().focus();
    host.open = true;
    fixture.detectChanges();
  }

  function tab(shift: boolean): void {
    const card = q('unreliable-export-dialog')!;
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture.nativeElement.remove());

  it('moves focus to the primary action when mounted', () => {
    openDialog();
    expect(document.activeElement).toBe(q('unreliable-export-include'));
  });

  it('restores focus to the element that held it when Cancel unmounts the dialog', () => {
    openDialog();
    q('unreliable-export-cancel')!.click();
    fixture.detectChanges();
    expect(host.choices).toEqual(['cancel']);
    expect(q('unreliable-export-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('Tab on the last control wraps to the first', () => {
    openDialog();
    q('unreliable-export-cancel')!.focus();
    tab(false);
    expect(document.activeElement).toBe(q('unreliable-export-include'));
  });

  it('Shift+Tab on the first control wraps to the last', () => {
    openDialog();
    expect(document.activeElement).toBe(q('unreliable-export-include'));
    tab(true);
    expect(document.activeElement).toBe(q('unreliable-export-cancel'));
  });

  it('a backdrop click is Cancel', () => {
    openDialog();
    (document.querySelector('.ued-backdrop') as HTMLElement).click();
    fixture.detectChanges();
    expect(host.choices).toEqual(['cancel']);
    expect(q('unreliable-export-dialog')).toBeNull();
  });

  it('Escape is Cancel and Include / Skip emit their own answers', () => {
    openDialog();
    q('unreliable-export-dialog')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(host.choices).toEqual(['cancel']);

    openDialog();
    q('unreliable-export-skip')!.click();
    fixture.detectChanges();
    openDialog();
    q('unreliable-export-include')!.click();
    fixture.detectChanges();
    expect(host.choices).toEqual(['cancel', 'skip', 'include']);
  });
});
