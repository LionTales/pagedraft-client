import { ANALYSIS_TYPE_LABELS } from '../models/analysis';

/**
 * c02: the ONE source of every user-facing string an ANALYSIS RUN can put on screen.
 *
 * ── Why this file exists ───────────────────────────────────────────────────────────────────────────
 * A Hebrew book used to show English run chrome in two places at once: the failure banner read
 * `Failed to load final result; reloading history.` (a hardcoded literal in the orchestration service)
 * and the run dialog's message line read `Running chunk 2/10` - the BACKEND's raw English
 * `TrackedJob.message` - rendered in RTL Hebrew chrome beside a correctly-localized `בריצה` pill.
 *
 * Both halves are fixed here, and the second one is the reason this module lives in `core/` rather than
 * inside a component: the strings are COMPOSED by `AnalysisRunOrchestrationService` (a root singleton)
 * and RENDERED by `AnalysisRunDialogComponent` and `AnalysisPanelComponent`, so no single component can
 * own them.
 *
 * ── Where backend-originated run text is localized (the c02 STEP 2 decision) ───────────────────────
 * The client composes it, from LANGUAGE-NEUTRAL STRUCTURED data the server already sends
 * (`AnalysisProgressDto.status` / `completedChunks` / `totalChunks` / `currentChunk`). The server's
 * prose `message` field is NOT rendered as chrome any more. The two rejected alternatives:
 *   - the SERVER emitting localized prose: puts UI copy in the API, makes it untranslatable
 *     client-side, and forces an API deploy to change a sentence;
 *   - the CLIENT pattern-matching the English prose: a parser over prose, which breaks on the first
 *     backend wording change and is unfixable from the client.
 * `c04` extends the same seam with the real chunk counts and an approximate time remaining.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────────────────────────
 * {@link RunStringKey} is a CLOSED union, so a typo'd key is a compile error rather than user-facing
 * chrome (the pattern `RunDialogLabelKey` established). Both maps are `Record<RunStringKey, string>`,
 * so a key added to one language fails the build until the other has it too.
 *
 * Hebrew is DRAFT and needs native-speaker review. No em-dash in any user-facing string (pinned by
 * `run-strings.spec.ts`).
 */

/** The two languages the run surfaces render in. */
export type RunChromeLang = 'he' | 'en';

/**
 * Normalize any language/locale tag to the run chrome's language.
 *
 * Hebrew is the default: only an explicitly English book gets English chrome. This is the SAME rule
 * `AnalysisRunDialogComponent.chromeLang` and `AnalysisPanelComponent.panelLang` already apply to
 * `bookLanguage`, extracted so the orchestration service (which sees the run's `ctx.language`, itself
 * the normalized book language) cannot disagree with the surfaces that render its output. A book in
 * some third language gets Hebrew chrome on all of them, rather than Hebrew on two and English on one.
 */
export function runChromeLang(language: string | null | undefined): RunChromeLang {
  return (language ?? '').trim().toLowerCase().startsWith('en') ? 'en' : 'he';
}

/** Every string an analysis run can show. Closed on purpose: a typo'd key does not compile. */
export type RunStringKey =
  // ── generic ──
  | 'analysis'
  | 'scopeChapter'
  | 'scopeScene'
  // ── run start (state (a) of the run dialog) ──
  | 'runStarting'
  | 'runStartingStreaming'
  | 'runChunked'
  | 'runChunkedStreaming'
  | 'jobStarted'
  // ── in-flight detail ──
  | 'progressCompleted'
  | 'progressAnalyzing'
  | 'progressPreparing'
  | 'progressRunning'
  // ── terminals ──
  | 'runSucceeded'
  | 'runFailed'
  | 'runCanceled'
  | 'analysisFailed'
  | 'loadFinalResultFailed'
  // The START-BUDGET expiry (run-dialog-starting-state-escape c01). Deliberately NOT a synonym of
  // `runFailed`: this key exists precisely because the two are DIFFERENT facts, and the plan's decision
  // (c) turns on the difference. `runFailed` means the server ran the analysis and it failed, which
  // leaves the user nothing to do. This one means the client never got a single answer back, so the
  // actionable next step ("close this and try again") is real and is written into the sentence. Keeping
  // one wording for both would have re-created the defect it fixes: an indeterminate wait that the user
  // cannot tell apart from a run that genuinely died.
  | 'runStartTimedOut'
  // ── re-analysis consent prompt ──
  | 'reanalysisConfirmOne'
  | 'reanalysisConfirmMany'
  // ── elapsed-run duration ──
  // Unlike `etaHours` (which has no singular because its bucket is unreachable below 2), EVERY one of
  // these singulars IS reachable: a run can finish at exactly 1 second or 1 minute, and the measured
  // defect (`זמן ריצה: 1 דקות ו-24 שניות`) was exactly the 1-minute-plus-seconds combination. The
  // bucket selection in `formatRunDurationLabel` is language-agnostic (mirroring `formatEtaLabel`), so
  // every key below is exercised in BOTH languages even though English's plain `1m` / `1s` never had a
  // grammar problem to begin with - its value is spelled out literally rather than composed from a
  // `{minutes}`/`{seconds}` placeholder specifically so the he/en placeholder-parity spec still holds
  // (a key with no placeholder in Hebrew must have none in English either).
  | 'durationSeconds'
  | 'durationSecond'
  | 'durationMinutes'
  | 'durationMinute'
  | 'durationMinutesSeconds'
  | 'durationMinuteSeconds'
  | 'durationMinutesSecond'
  | 'durationMinuteSecond'
  // ── approximate time REMAINING (c04) ──
  // Each of these carries the "estimate" framing inside the sentence itself, in both languages, so a
  // surface cannot render the number without the hedge. The buckets are deliberately coarse: false
  // precision on a throughput extrapolation reads as a promise, and a wrong promise is worse than a
  // vague one. See `formatEtaLabel` for the bucketing and `core/utils/chunk-eta.ts` for the estimator.
  // There is deliberately NO singular-hour key: `formatEtaLabel` only reaches its hours bucket at 90
  // minutes and rounds from there, so "about 1 hour" is unreachable and a key for it would be a string
  // a translator is asked to review and a reader expects to see. If the minutes ceiling is ever
  // lowered below 90, add it back with the bucket that renders it.
  | 'etaLessThanMinute'
  | 'etaMinute'
  | 'etaMinutes'
  | 'etaHours';

/**
 * Hebrew run strings. DRAFT he - needs native review.
 *
 * Every parameterized sentence uses the uniform `{type}: <state>` shape rather than inflecting the
 * analysis-type noun, because `{type}` is substituted from `ANALYSIS_TYPE_LABELS` and its gender and
 * definiteness vary ('הגהה' / 'עריכת שורה' / 'ניתוח'). A colon keeps every one of them grammatical.
 */
export const RUN_STRINGS_HE: Record<RunStringKey, string> = {
  analysis:              'ניתוח',
  scopeChapter:          'הפרק',
  scopeScene:            'הסצנה',

  runStarting:           'מריץ {type}...',
  runStartingStreaming:  'מריץ {type} (הזרמה)...',
  runChunked:            '{type}: כ-{parts} חלקים (כ-{words} מילים בכל חלק)',
  runChunkedStreaming:   '{type} בהזרמה: כ-{parts} חלקים (כ-{words} מילים בכל חלק)',
  jobStarted:            '{type}: המשימה החלה, עוקב אחר ההתקדמות...',

  progressCompleted:     '{type}: {completed} מתוך {total} הושלמו',
  progressAnalyzing:     '{type}: מנתח...',
  progressPreparing:     '{type}: מכין חלקים...',
  progressRunning:       '{type}: רץ...',

  runSucceeded:          '{type}: הסתיים.',
  runFailed:             '{type}: נכשל. ראו את פרטי השגיאה.',
  runCanceled:           '{type}: בוטל.',
  analysisFailed:        'הניתוח נכשל.',
  loadFinalResultFailed: 'לא ניתן לטעון את התוצאה הסופית. טוען מחדש את ההיסטוריה.',
  runStartTimedOut:      '{type}: ההרצה לא התחילה. השרת לא הגיב בזמן. סגרו את החלון ונסו שוב.',

  reanalysisConfirmOne:  'הרצת ניתוח חדש תסיים את הסשן הנוכחי עבור {scope}. הצעה אחת ממתינה תימחק. להמשיך?',
  reanalysisConfirmMany: 'הרצת ניתוח חדש תסיים את הסשן הנוכחי עבור {scope}. {count} הצעות ממתינות תימחקנה. להמשיך?',

  durationSeconds:       '{seconds} שניות',
  durationSecond:        'שנייה',
  durationMinutes:       '{minutes} דקות',
  durationMinute:        'דקה',
  durationMinutesSeconds: '{minutes} דקות ו-{seconds} שניות',
  durationMinuteSeconds: 'דקה ו-{seconds} שניות',
  durationMinutesSecond: '{minutes} דקות ושנייה',
  durationMinuteSecond:  'דקה ושנייה',

  etaLessThanMinute:     'זמן משוער שנותר: פחות מדקה',
  etaMinute:             'זמן משוער שנותר: כדקה',
  etaMinutes:            'זמן משוער שנותר: כ-{minutes} דקות',
  etaHours:              'זמן משוער שנותר: כ-{hours} שעות',
};

export const RUN_STRINGS_EN: Record<RunStringKey, string> = {
  analysis:              'Analysis',
  scopeChapter:          'chapter',
  scopeScene:            'scene',

  runStarting:           'Running {type}...',
  runStartingStreaming:  'Running {type} (streaming)...',
  runChunked:            '{type}: about {parts} parts (~{words} words each)',
  runChunkedStreaming:   '{type} streaming: about {parts} parts (~{words} words each)',
  jobStarted:            '{type}: job started, tracking progress...',

  progressCompleted:     '{type}: {completed} of {total} completed',
  progressAnalyzing:     '{type}: analyzing...',
  progressPreparing:     '{type}: preparing parts...',
  progressRunning:       '{type}: running...',

  runSucceeded:          '{type}: finished.',
  runFailed:             '{type}: failed. See the error details.',
  runCanceled:           '{type}: canceled.',
  analysisFailed:        'Analysis failed.',
  loadFinalResultFailed: 'Could not load the final result. Reloading history.',
  runStartTimedOut:      '{type}: the run did not start. The server did not respond in time. Close this and try again.',

  reanalysisConfirmOne:  'Running a new analysis will end your current session for this {scope}. 1 pending suggestion will be discarded. Continue?',
  reanalysisConfirmMany: 'Running a new analysis will end your current session for this {scope}. {count} pending suggestions will be discarded. Continue?',

  durationSeconds:       '{seconds}s',
  durationSecond:        '1s',
  durationMinutes:       '{minutes}m',
  durationMinute:        '1m',
  durationMinutesSeconds: '{minutes}m {seconds}s',
  durationMinuteSeconds: '1m {seconds}s',
  durationMinutesSecond: '{minutes}m 1s',
  durationMinuteSecond:  '1m 1s',

  etaLessThanMinute:     'Estimated time remaining: less than a minute',
  etaMinute:             'Estimated time remaining: about 1 minute',
  etaMinutes:            'Estimated time remaining: about {minutes} minutes',
  etaHours:              'Estimated time remaining: about {hours} hours',
};

/** Substitution parameters for a run string. Values are stringified as-is. */
export type RunStringParams = Readonly<Record<string, string | number>>;

/**
 * Substitute `{name}` placeholders. An unknown placeholder is left VERBATIM rather than blanked, so a
 * mismatch between a template and its caller shows up as `{parts}` on screen (and in a test) instead of
 * silently producing a sentence with a hole in it.
 */
function interpolate(template: string, params?: RunStringParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

/** Resolve one run string in the given chrome language. */
export function runString(lang: RunChromeLang, key: RunStringKey, params?: RunStringParams): string {
  const map = lang === 'he' ? RUN_STRINGS_HE : RUN_STRINGS_EN;
  return interpolate(map[key], params);
}

/**
 * The localized display name of an analysis type, from the SHARED {@link ANALYSIS_TYPE_LABELS} source
 * every other analysis-type surface already reads. Falls back to the generic "Analysis"/"ניתוח" for an
 * absent or unknown type, which is what the old `${type} analysis` / `'Custom analysis'` string
 * composition did in English only.
 */
export function analysisTypeLabelFor(lang: RunChromeLang, type: string | null | undefined): string {
  const key = (type ?? '').trim();
  return (key && ANALYSIS_TYPE_LABELS[lang][key]) || runString(lang, 'analysis');
}

/**
 * Localized elapsed-run duration. Split out of the orchestration service so the `s` / `m` unit
 * abbreviations, which used to render as Latin text inside Hebrew chrome ("זמן ריצה: 5s"), go through
 * the same map as every other run string. Coarse on purpose: seconds under a minute, whole minutes
 * above it.
 *
 * Every one-part-of-the-duration-is-exactly-1 case has its own singular key (`durationSecond` /
 * `durationMinute` / the `durationMinute*Second*` combinations): a single minute is `דקה`, never
 * `1 דקות`, and the same holds for a single second. This mirrors `etaMinute` in {@link formatEtaLabel} -
 * the bucket a plain `1` would otherwise fall through into a plural noun.
 */
export function formatRunDurationLabel(lang: RunChromeLang, elapsedMs: number): string {
  const seconds = Math.round(Math.max(0, elapsedMs) / 1000);
  if (seconds < 60) {
    return seconds === 1
      ? runString(lang, 'durationSecond')
      : runString(lang, 'durationSeconds', { seconds });
  }

  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;

  if (!rem) {
    return minutes === 1
      ? runString(lang, 'durationMinute')
      : runString(lang, 'durationMinutes', { minutes });
  }

  if (minutes === 1 && rem === 1) return runString(lang, 'durationMinuteSecond');
  if (minutes === 1) return runString(lang, 'durationMinuteSeconds', { seconds: rem });
  if (rem === 1) return runString(lang, 'durationMinutesSecond', { minutes });
  return runString(lang, 'durationMinutesSeconds', { minutes, seconds: rem });
}

/**
 * c04: render an estimated time REMAINING, coarsely and with the hedge baked into the sentence.
 *
 * Three buckets, and the coarseness is the point: the input is a throughput extrapolation, so "about 4
 * minutes" is the most any of it can honestly support and "3 minutes 47 seconds" would read as a
 * countdown the run has no obligation to meet. Coarse rendering also absorbs the small revisions the
 * estimator makes when a chunk lands, so the line does not visibly twitch.
 *
 *   < 60s        -> "less than a minute" (never "0 minutes", and never a raw 0)
 *   < 90 minutes -> whole minutes, rounded UP so the estimate under-promises rather than over-promises
 *   otherwise    -> whole hours, rounded to nearest
 *
 * The 90-minute ceiling on the minutes bucket is why the hours bucket has no SINGULAR form: it is first
 * reached at 90 minutes, which rounds to 2, so "about 1 hour" is unreachable and there is deliberately
 * no key for it. Lowering that ceiling means adding one back. The ceiling is set where it is so a
 * 61-to-89-minute wait is never reported as "about 1 hour", which would over-promise by up to half an
 * hour on the longest runs.
 *
 * Every bucket's string already says "estimated" / "about" in both languages, so there is no way to
 * render the number bare. Pass a value from {@link estimateRemainingMs}; a null estimate must render
 * NOTHING rather than being passed here as 0.
 */
export function formatEtaLabel(lang: RunChromeLang, remainingMs: number): string {
  const ms = Math.max(0, remainingMs);
  if (ms < 60_000) return runString(lang, 'etaLessThanMinute');

  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 90) {
    return minutes === 1
      ? runString(lang, 'etaMinute')
      : runString(lang, 'etaMinutes', { minutes });
  }

  // minutes >= 90 here, so `hours` is always >= 2 and the plural string always reads correctly.
  const hours = Math.round(minutes / 60);
  return runString(lang, 'etaHours', { hours });
}
