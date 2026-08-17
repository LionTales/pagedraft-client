/**
 * THE PRE-LOGIN VOTER IDENTITY (Show C2, c2-client).
 *
 * d1 made `InstallationId` load-bearing rather than decorative: the one-vote rule is keyed on
 * `(area, targetType, targetId, UserId ?? InstallationId)`, and with no `[Authorize]` anywhere in this
 * app the `UserId` half is null on every deployment today. So this string IS the key. A request carrying
 * neither is `400 voterIdentityRequired` - an unkeyable vote cannot be deduped and defeats the rule.
 *
 * ── The pattern this follows, and why it is not a server setting ──────────────────────────────────
 * `collapse-store.ts` and `orientation-store.ts` beside it: a plain `localStorage` module, a `pd:` key,
 * every read and write wrapped, and no Angular dependency so it can be asserted directly. It is a fact
 * about ONE browser on ONE machine and it carries no book content, which is exactly the class of thing
 * those two already keep out of the API.
 *
 * ── FAILS OPEN, AND WHAT "OPEN" MEANS HERE ────────────────────────────────────────────────────────
 * The two stores beside this one fail open toward "use the default". This one cannot: the default would
 * be "no identity", and the server refuses that request outright, so a private-mode browser or a full
 * quota would silently make the whole widget unusable rather than merely forgetful. So a storage failure
 * falls back to a MODULE-LOCAL id that lives for the life of the page. Voting keeps working; what is
 * lost is only the ability to recognize the same reader after a reload, which downgrades the one-vote
 * rule to one vote per page load rather than breaking it. That is the right direction: the signal is
 * collected, and at worst the owner sees a duplicate row.
 *
 * ── It is an OPAQUE random id and nothing else ────────────────────────────────────────────────────
 * No fingerprint, no derived value, nothing about the machine or the author. It exists to dedupe one
 * reader's own votes and it is never rendered anywhere: `FeedbackDto` deliberately does not carry it
 * back, because keying material is not something a reading tool needs.
 */

/** localStorage key for this browser's voter id. */
export const INSTALLATION_ID_KEY = 'pd:feedback-installation-id';

/**
 * The in-memory fallback, minted once per page load when storage is unavailable.
 *
 * Also the CACHE for the ordinary path, so the widget does not touch `localStorage` on every vote.
 */
let cached: string | null = null;

/**
 * This browser's voter id, minting and persisting one on first use.
 *
 * ALWAYS RETURNS A NON-EMPTY STRING. Every failure mode ends in a usable id, because the alternative is
 * a request the server refuses (see the fails-open note above).
 */
export function readInstallationId(): string {
  if (cached) return cached;

  try {
    const stored = localStorage.getItem(INSTALLATION_ID_KEY);
    // A blank or whitespace value is treated as absent rather than sent: the server trims, and a trimmed
    // empty id is no id at all, which is the `400` this function exists to prevent.
    if (stored && stored.trim()) {
      cached = stored.trim();
      return cached;
    }
  } catch {
    // Fall through to minting. A read failure and a first run are the same situation from here.
  }

  const minted = newInstallationId();
  try {
    localStorage.setItem(INSTALLATION_ID_KEY, minted);
  } catch {
    // Fails open to a page-lifetime id: see the module doc. The vote still goes up keyed on something.
  }
  cached = minted;
  return minted;
}

/**
 * Forget the cached id, so the next read goes back to storage.
 *
 * EXISTS FOR SPECS, and is honest about it. Nothing in the product clears a voter identity: a reader who
 * cleared their own would silently split their one vote into two.
 */
export function resetInstallationIdCache(): void {
  cached = null;
}

/**
 * Mint a fresh id.
 *
 * `crypto.randomUUID` where it exists (every browser this app supports, and `localhost` counts as a
 * secure context so it is available under Karma too), with a v4-shaped fallback built from
 * `crypto.getRandomValues` and, failing even that, `Math.random`. The fallback's quality does not have to
 * be cryptographic: this is a dedup key, not a secret, and its only requirement is that two readers do
 * not collide.
 */
function newInstallationId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Version 4, variant 10xx, so the value is a well-formed UUID rather than 32 arbitrary hex digits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
