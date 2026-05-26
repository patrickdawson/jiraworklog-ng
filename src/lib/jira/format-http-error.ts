/** Appends Jira REST `errorMessages` / `errors` from a response body when present. */
export function formatJiraHttpErrorBody(
  status: number,
  statusText: string,
  body: string,
): string {
  let base = `HTTP ${status} ${statusText}`;
  if (!body.trim()) return base;

  try {
    const data = JSON.parse(body) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
    };
    const lines: string[] = [];
    if (Array.isArray(data.errorMessages)) {
      lines.push(...data.errorMessages.filter(Boolean));
    }
    if (data.errors && typeof data.errors === "object") {
      for (const [field, message] of Object.entries(data.errors)) {
        if (message) lines.push(`${field}: ${message}`);
      }
    }
    if (lines.length > 0) {
      base += ` — ${lines.join("; ")}`;
    } else {
      base += ` — ${body.slice(0, 200)}`;
    }
  } catch {
    base += ` — ${body.slice(0, 200)}`;
  }
  return base;
}
