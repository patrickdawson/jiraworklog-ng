/**
 * Legacy on-prem Jira may use a corporate CA that Node does not trust by default.
 * Jira Cloud uses public CAs; set JIRA_TLS_STRICT=1 to enforce certificate checks.
 */
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.JIRA_TLS_STRICT !== "1"
  ) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}
