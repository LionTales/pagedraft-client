/**
 * Wave 3 / w6 (Q13-A) - splitting a served guide into its authored sections.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────────
 * The first-run orientation panel is a VIEW over the shipped guides, not tutorial copy written into a
 * component. Q13 ruled option C ("hardcode tutorial copy now") out at the session, because prose written
 * into a component has to be kept in sync with the assistant's answers forever and is how a third
 * contradictory stage model gets born. So the panel renders a real section of a real guide, and this is
 * the only new logic that needs: cut the served markdown body at its own headings.
 *
 * ── Why by POSITION and not by heading text ───────────────────────────────────────────────────────
 * A guide's headings are the ASSISTANT'S RETRIEVAL INDEX (`Services/Chat/GuideSelector` scores question
 * tokens against H1/H2 and reads no body prose), so they get edited for retrieval reasons, and they are
 * different strings in the two languages. Selecting a section by matching its title would therefore
 * couple a copy edit on the server to a silent content change in the client - in the language the editor
 * was not looking at. Position is the property the two files genuinely share: the en and he halves of a
 * guide are parallel translations authored section for section.
 *
 * That is a real coupling too, just a weaker and a visible one: if a section is inserted at the top of
 * `00-workflow-overview.md`, the panel shows the new one. It cannot show something UNTRUE (everything it
 * can show is authored guide prose about the workflow), and the caller states which index it wants and
 * what it does when that index is absent. Nothing here invents a fallback sentence.
 *
 * ── What counts as a section ──────────────────────────────────────────────────────────────────────
 * An H2 (`## `) starts one, matching `GuideFrontmatter`'s own heading rule on the server (H1 and H2 only,
 * and only at the start of a line). Everything above the first H2 is the INTRO - the H1 title plus the
 * paragraph or two under it. Deeper headings (`### `) are body, exactly as the reader renders them.
 *
 * The frontmatter is NOT handled here: `GET /api/guides/{id}` already strips it, and the corpus test
 * `EveryShippedGuide_HasAnId_ALanguage_AndABodyWithoutItsFrontmatter` pins that. A body that still
 * carried a fence would simply put it in the intro, where it would be visible rather than silent.
 */

/** One authored section of a guide: its H2 title, and the markdown under it with the title removed. */
export interface GuideSection {
  /** The H2 text, with the `## ` marker stripped and surrounding whitespace trimmed. */
  heading: string;
  /** The markdown under that heading, up to the next H2. Trimmed; never includes the heading line. */
  body: string;
}

/** True for a line that starts an H2 section. */
function isH2(line: string): boolean {
  return /^##\s+\S/.test(line);
}

/**
 * Everything above the first H2: the guide's H1 and its opening prose, with the H1 line removed (the
 * surface renders its own title, and the reader page shows the document's H1 already).
 *
 * Returns `''` for a body that has nothing above its first H2, which is a fact about the document and
 * not an error.
 */
export function guideIntro(body: string | null | undefined): string {
  if (!body) return '';
  const lines = body.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (isH2(line)) break;
    if (/^#\s+\S/.test(line)) continue;   // the H1 title
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * Every H2 section of the body, in authored order. An empty array means the document has no H2 at all,
 * which callers must handle rather than index into.
 */
export function guideSections(body: string | null | undefined): GuideSection[] {
  if (!body) return [];
  const sections: GuideSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of body.split('\n')) {
    if (isH2(line)) {
      if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
      current = { heading: line.replace(/^##\s+/, '').trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }

  if (current) sections.push({ heading: current.heading, body: current.lines.join('\n').trim() });
  return sections;
}

/**
 * The section a surface asked for by position, or `null` when the document does not have one there.
 *
 * NULL IS THE POINT. A caller that wants "the first section of the workflow overview" must be able to
 * find out that the served corpus does not have it, and say so, rather than fall back to prose of its
 * own - which is the throwaway path Q13-C ruled out.
 */
export function guideSectionAt(body: string | null | undefined, index: number): GuideSection | null {
  if (index < 0) return null;
  const sections = guideSections(body);
  return sections.length > index ? sections[index] : null;
}
