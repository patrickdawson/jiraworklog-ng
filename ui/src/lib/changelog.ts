/**
 * Minimal parser for CHANGELOG.md (Keep a Changelog format). It only knows the
 * shapes this file uses: `## [version] - date`, `### Group` and `- item`
 * lines. Everything before the first release heading is skipped.
 */

export type ChangelogGroup = { title: string; items: string[] };

export type ChangelogRelease = {
  version: string;
  /** ISO date, or null for "Unreleased". */
  date: string | null;
  groups: ChangelogGroup[];
};

const RELEASE = /^##\s+\[([^\]]+)\](?:\s+-\s+(\S+))?/;
const GROUP = /^###\s+(.+)$/;
const ITEM = /^[-*]\s+(.+)$/;

export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let group: ChangelogGroup | null = null;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();

    const r = RELEASE.exec(line);
    if (r) {
      release = { version: r[1], date: r[2] ?? null, groups: [] };
      releases.push(release);
      group = null;
      continue;
    }
    if (!release) continue;

    const g = GROUP.exec(line);
    if (g) {
      group = { title: g[1], items: [] };
      release.groups.push(group);
      continue;
    }

    const i = ITEM.exec(line);
    if (i && group) group.items.push(i[1]);
  }

  return releases;
}

export type InlinePart = { kind: "text" | "bold" | "code"; text: string };

/** Splits an item into plain text, `**bold**` and `` `code` `` parts. */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) {
      parts.push({ kind: "text", text: text.slice(last, m.index) });
    }
    parts.push(
      m[1] !== undefined
        ? { kind: "bold", text: m[1] }
        : { kind: "code", text: m[2] },
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}
