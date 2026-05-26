/** User-facing hint when Node fetch cannot reach Jira (often corporate TLS). */
export function formatJiraFetchError(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    if (err.cause instanceof Error) {
      parts.push(err.cause.message);
    }
  } else {
    parts.push(String(err));
  }
  const detail = parts.join(" ").toLowerCase();
  const tlsHint =
    detail.includes("unable to verify") ||
    detail.includes("certificate") ||
    detail.includes("self signed") ||
    detail.includes("cert") ||
    detail.includes("fetch failed");

  if (tlsHint) {
    return (
      "Keine Verbindung zum Server (TLS/Zertifikat). " +
      "Bei Proxy oder Sonderzertifikaten ggf. JIRA_TLS_STRICT=1 prüfen und Dev-Server neu starten. " +
      `(${parts.join(" · ")})`
    );
  }
  return `Keine Verbindung zum Server. Bitte Jira-URL prüfen. (${parts.join(" · ")})`;
}
