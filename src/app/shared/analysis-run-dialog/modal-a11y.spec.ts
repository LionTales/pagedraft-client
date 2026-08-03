/**
 * c03: unit spec for the modal a11y primitives.
 *
 * These are pure DOM functions, so they are driven against a hand-built fragment rather than through a
 * component fixture - the containment rule ("everything OUTSIDE the dialog, at every level up to body")
 * is a property of the walk itself and is much easier to falsify here than through a rendered dialog.
 */
import { fakeAsync, tick } from '@angular/core/testing';

import {
  INERT_ATTR,
  applyBackgroundInert,
  containFocusWithin,
  focusablesWithin,
} from './modal-a11y';

describe('applyBackgroundInert (c03)', () => {
  let root: HTMLElement;
  let outerSibling: HTMLElement;
  let innerSibling: HTMLElement;
  let dialog: HTMLElement;
  let release: (() => void) | null = null;

  beforeEach(() => {
    // body
    //  +- outerSibling        <- must become inert (a sibling of the dialog's ANCESTOR)
    //  +- root
    //       +- innerSibling   <- must become inert (a sibling of the dialog itself)
    //       +- dialog         <- must NOT become inert, nor must its children
    //            +- child
    outerSibling = document.createElement('div');
    outerSibling.id = 'outer-sibling';
    root = document.createElement('div');
    innerSibling = document.createElement('div');
    innerSibling.id = 'inner-sibling';
    dialog = document.createElement('div');
    dialog.id = 'dialog';
    const child = document.createElement('button');
    child.id = 'dialog-child';
    dialog.appendChild(child);
    root.appendChild(innerSibling);
    root.appendChild(dialog);
    document.body.appendChild(outerSibling);
    document.body.appendChild(root);
  });

  afterEach(() => {
    release?.();
    release = null;
    outerSibling.remove();
    root.remove();
  });

  it('marks every sibling at EVERY level up to body, and never the dialog or its children', () => {
    release = applyBackgroundInert(dialog);

    expect(innerSibling.hasAttribute(INERT_ATTR))
      .withContext('a sibling of the dialog itself')
      .toBeTrue();
    expect(outerSibling.hasAttribute(INERT_ATTR))
      .withContext('a sibling of the dialog ANCESTOR - the walk must not stop at the first level')
      .toBeTrue();
    expect(dialog.hasAttribute(INERT_ATTR)).toBeFalse();
    expect(dialog.querySelector('#dialog-child')!.hasAttribute(INERT_ATTR)).toBeFalse();
    // The dialog's own ancestor chain must stay live, or the dialog inherits inertness through it.
    expect(root.hasAttribute(INERT_ATTR)).toBeFalse();
    expect(document.body.hasAttribute(INERT_ATTR)).toBeFalse();
  });

  it('releases exactly what it marked, and is idempotent', () => {
    release = applyBackgroundInert(dialog);
    release();

    expect(innerSibling.hasAttribute(INERT_ATTR)).toBeFalse();
    expect(outerSibling.hasAttribute(INERT_ATTR)).toBeFalse();

    release(); // second call must not throw and must not un-inert anything else
    expect(document.body.hasAttribute(INERT_ATTR)).toBeFalse();
  });

  it('leaves an element that was ALREADY inert alone, and does not un-inert it on release', () => {
    innerSibling.setAttribute(INERT_ATTR, '');

    release = applyBackgroundInert(dialog);
    release();

    // Someone else owns that element's inertness; releasing ours must not clear theirs.
    expect(innerSibling.hasAttribute(INERT_ATTR)).toBeTrue();
    innerSibling.removeAttribute(INERT_ATTR);
  });
});

/**
 * c01. The primitive that holds the keyboard while the dialog is modal.
 *
 * Driven here rather than through the dialog fixture for the reason the whole defect exists: the
 * fixture has no Syncfusion editor in it, so a fixture-only suite went green over a modal that did not
 * hold focus in the real app. What CAN be pinned deterministically is the mechanism - "focus lands
 * outside, it comes back" - and both of its two paths, including the one a `focusin`-only listener
 * would miss.
 */
describe('containFocusWithin (c01)', () => {
  let host: HTMLElement;
  let target: HTMLElement;
  let inside: HTMLButtonElement;
  let outside: HTMLButtonElement;
  let release: (() => void) | null = null;

  beforeEach(() => {
    host = document.createElement('div');
    host.id = 'host';
    // The re-assertion target: tabindex="-1", exactly like the dialog's `.rd-overlay` container.
    target = document.createElement('div');
    target.id = 'overlay';
    target.tabIndex = -1;
    inside = document.createElement('button');
    inside.id = 'inside';
    inside.type = 'button';
    target.appendChild(inside);
    host.appendChild(target);

    outside = document.createElement('button');
    outside.id = 'outside';
    outside.type = 'button';

    document.body.appendChild(outside);
    document.body.appendChild(host);
  });

  afterEach(() => {
    release?.();
    release = null;
    host.remove();
    outside.remove();
  });

  it('pulls focus back to the target when it lands OUTSIDE the host', () => {
    release = containFocusWithin(host, () => target);

    outside.focus();

    expect(document.activeElement)
      .withContext('focus left the host and must be pulled back to the dialog target')
      .toBe(target);
  });

  it('leaves focus alone when it lands INSIDE the host', () => {
    release = containFocusWithin(host, () => target);

    inside.focus();

    expect(document.activeElement)
      .withContext('containment must not fight focus moving BETWEEN the dialog controls')
      .toBe(inside);
  });

  it('re-asserts from a focusout with NO focusin (the nested browsing context case)', fakeAsync(() => {
    // The measured Syncfusion steal focuses an element inside the editor iframe's OWN document, so the
    // parent document never sees a `focusin` - the only parent-side signal is a `focusout`. Reproduced
    // here by installing containment while focus is ALREADY outside, which is the same starting state
    // the deferred handler faces, and then delivering only the focusout half.
    outside.focus();
    release = containFocusWithin(host, () => target);

    expect(document.activeElement)
      .withContext('installing containment must not itself move focus')
      .toBe(outside);

    outside.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(document.activeElement)
      .withContext('focusout fires BEFORE the new focus is set, so the handler must defer')
      .toBe(outside);

    tick();

    expect(document.activeElement)
      .withContext('the deferred re-read of activeElement is the only signal this path has')
      .toBe(target);
  }));

  it('does NOT recurse: one steal produces exactly one re-assertion', fakeAsync(() => {
    release = containFocusWithin(host, () => target);
    const focusSpy = spyOn(target, 'focus').and.callThrough();

    outside.focus();
    tick();

    expect(focusSpy.calls.count())
      .withContext('moving focus fires focusin again; the destination guard must stop the cycle')
      .toBe(1);
  }));

  it('stops containing once released, and a pending deferred check is cancelled', fakeAsync(() => {
    release = containFocusWithin(host, () => target);
    outside.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    release();
    release = null;

    tick();
    outside.focus();

    expect(document.activeElement)
      .withContext('after release the page owns its own focus again')
      .toBe(outside);
  }));

  it('skips the re-assertion when the target is gone (Angular re-rendered it away)', fakeAsync(() => {
    release = containFocusWithin(host, () => target);
    target.remove();

    outside.focus();
    tick();

    expect(document.activeElement)
      .withContext('a detached target must not be focused')
      .toBe(outside);
  }));
});

describe('focusablesWithin (c03)', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    host.innerHTML = `
      <button id="b1" type="button">one</button>
      <button id="disabled" type="button" disabled>nope</button>
      <div id="container" tabindex="-1">not in the tab order</div>
      <a id="link" href="#x">link</a>
    `;
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  it('returns the tab-order elements in DOM order, skipping disabled and tabindex="-1"', () => {
    expect(focusablesWithin(host).map(el => el.id)).toEqual(['b1', 'link']);
  });

  it('skips anything already marked inert', () => {
    host.querySelector('#b1')!.setAttribute(INERT_ATTR, '');
    expect(focusablesWithin(host).map(el => el.id)).toEqual(['link']);
  });

  it('is empty for a subtree with nothing focusable', () => {
    const empty = document.createElement('div');
    empty.textContent = 'text only';
    document.body.appendChild(empty);
    expect(focusablesWithin(empty)).toEqual([]);
    empty.remove();
  });
});
