export type ParsedDescription = {
  /** Raw, unmodified description text. */
  raw: string;
  /** Free-text label before the issue key — ignored for Jira. */
  memo: string;
  /** Jira issue key (uppercased), or `undefined` if none was found. */
  issueKey: string | undefined;
  /** Worklog comment for Jira (text after the issue key). */
  comment: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Splits a description in the format `<Merksatz> <Projekt-Key> <Worklogtext>`.
 * Ported from the regex logic in jiraworklog/lib/toggl.ts.
 */
export function parseDescription(
  description: string,
  projectKeys: string[],
): ParsedDescription {
  const raw = description ?? "";
  const keys = projectKeys.map((k) => k.trim()).filter(Boolean);

  if (keys.length > 0) {
    const pattern = keys.map(escapeRegExp).join("|");
    const regex = new RegExp(`(.*)((?:${pattern})-\\d+)\\s*(.*)`, "i");
    const matches = raw.match(regex);
    if (matches) {
      return {
        raw,
        memo: matches[1].trim(),
        issueKey: matches[2].toUpperCase(),
        comment: matches[3].trim(),
      };
    }
  }

  return { raw, memo: raw.trim(), issueKey: undefined, comment: raw.trim() };
}
