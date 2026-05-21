/**
 * Internal Jira often uses a corporate CA that Node does not trust by default.
 * Set JIRA_TLS_STRICT=1 to enforce certificate checks.
 */
export async function register(): Promise<void> {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.JIRA_TLS_STRICT !== "1"
  ) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
}
