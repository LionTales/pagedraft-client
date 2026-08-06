/**
 * The author-editable character register (character-register-editing plan, c1 contract).
 *
 * Mirrors `Pagedraft.Api/Models/Dtos/CharacterRegisterDtos.cs` exactly. JSON casing is the API's
 * System.Text.Json web default (camelCase), so these property names are the wire names.
 *
 * The three `*Confirmed` booleans are the FEATURE, not decoration: they separate a value a human
 * blessed from a value the extractor guessed, which is the whole reason this surface exists (it tells
 * the author where their attention is worth spending). Never infer them client-side.
 */

/** One character in the register, with its per-field provenance. */
export interface CharacterRegisterEntryDto {
  name: string;
  /** Extractor vocabulary is `male` / `female` / `unknown`, but any string can be persisted. */
  gender: string | null;
  /** Extracted-only. No provenance flag and no edit path (d1 §1). */
  role: string | null;
  /** Extracted-only. No provenance flag and no edit path (d1 §1). */
  description: string | null;
  aliases: string[];
  /** False once the author marked this entry as not-a-character. */
  isCharacter: boolean;
  /** True when the WHOLE entry was hand-added by the author rather than extracted. */
  isAuthorAdded: boolean;
  genderConfirmed: boolean;
  aliasesConfirmed: boolean;
  isCharacterConfirmed: boolean;
}

/**
 * How much of the book the register actually reflects (automatic-coverage plan, be-c03).
 *
 * Coverage is automatic and invisible: a chapter contributes to the register the first time an
 * analysis that reads the register runs against it (server-side: Proofread, LiteraryAnalysis, QA,
 * Synopsis, per `PromptFactory.RendersCharacterRegister`). Other analysis types (LineEdit,
 * LinguisticAnalysis, Summarization, StoryAnalysis) never scan, so a book whose author only runs
 * those sees this count never move. That is an accepted product tradeoff, not a bug, and it is
 * exactly why these numbers are reported rather than implied.
 *
 * EVERY number here is the SERVER's, computed from the persisted scan ledger. None of it may be
 * re-derived from `characters` on the client: the character list says who was found, not which
 * chapters were read, and the two answer different questions.
 *
 * THE FOUR BUCKETS ARE EXCLUSIVE AND EXHAUSTIVE:
 * `covered + pending + stale + unscannable === total`, always.
 */
export interface CharacterRegisterCoverageDto {
  /** Chapters in the book. */
  totalChapters: number;
  /**
   * Contributed, from up to a fixed word cap of the chapter's CURRENT text, not necessarily the
   * whole chapter for a long one (the extraction pre-pass truncates; see the server DTO doc).
   */
  coveredChapters: number;
  /** Never contributed; will on its next analysis. */
  pendingChapters: number;
  /** Contributed, then the chapter was edited, so it re-contributes on its next analysis. */
  staleChapters: number;
  /** Has no text an analysis could read (empty, or only a Syncfusion trial watermark). */
  unscannableChapters: number;
  /**
   * True when the book HAS chapters and nothing is outstanding (`pending === 0 && stale === 0`).
   * Two server-side edges the surface has to render honestly: a book with NO chapters is not
   * complete, and a book whose chapters are ALL unscannable IS complete with zero covered.
   */
  isComplete: boolean;
  /** ISO UTC stamp of the most recent scan; null before anything has been scanned. */
  lastScannedAt: string | null;
}

/**
 * The server's FULL register. Every write returns one of these, and it is the ONLY thing the surface
 * may render after a save: a rejected PATCH batch writes nothing at all, so any client-side guess
 * about what landed is either redundant or wrong.
 *
 * `hasRegister: false` with an empty `characters` means the register has NEVER BEEN BUILT (a 200, not
 * a 404). That is a different statement from "the register exists and is empty" (every character
 * suppressed), and the surface must say so: the register is extracted on the first analysis run that
 * needs it.
 */
export interface CharacterRegisterDto {
  bookId: string;
  hasRegister: boolean;
  /** ISO UTC stamp of the last content change (extraction or author edit); null when never stamped. */
  updatedAt: string | null;
  /** Includes SUPPRESSED entries (`isCharacter: false`), so they stay visible and restorable. */
  characters: CharacterRegisterEntryDto[];
  /**
   * Never null on the wire, INCLUDING the never-built state (it reads "0 of N" there): how much of
   * the book the register reflects is a question with an honest answer before any register exists.
   */
  coverage: CharacterRegisterCoverageDto;
}

/**
 * The ops the PATCH endpoint accepts. Anything else is a 400 and writes nothing.
 *
 * They differ on what a name matching NOTHING means, which is the server's decision and must not be
 * second-guessed here: `upsert` creates the entry (`isAuthorAdded: true`), `suppress` creates a
 * suppressed marker that pre-empts a future extraction, and `restore` is REJECTED with a 400 (it means
 * "un-suppress an entry that exists", so there is nothing honest to create). This surface never issues
 * that shape - Restore is offered only on rows the server returned as suppressed - so a 400 from a
 * restore means the register moved underneath the view, not that the author did something wrong.
 */
export type CharacterRegisterEditOp = 'upsert' | 'suppress' | 'restore';

/**
 * One author edit.
 *
 * `name` targets a character through the server's merge matching key (trim + case-insensitive, with
 * ALIAS FALLBACK), so a character can be addressed by an alias. The client does not re-derive that.
 *
 * `gender` / `aliases` ABSENT means "leave untouched"; PRESENT means "set AND confirm". `gender: ''`
 * clears the value while still confirming it ("the guess is wrong and there is none"), and
 * `aliases: []` is a confirmed empty list. Because absent and present mean different things, these
 * fields must be OMITTED rather than sent as null when the edit does not touch them.
 */
export interface CharacterRegisterEditDto {
  name: string;
  op?: CharacterRegisterEditOp;
  gender?: string;
  aliases?: string[];
}

/** PATCH body: a batch applied in order. A rejected batch writes NOTHING (all-or-nothing). */
export interface UpdateCharacterRegisterRequest {
  edits: CharacterRegisterEditDto[];
}
