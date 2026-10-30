"use client";

import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";
import { jiraBrowseUrl } from "@/lib/jira/http";

const JiraUrlContext = createContext("");

/** Makes the configured Jira URL available to every `IssueKeyLink` below it. */
export function JiraUrlProvider({
  jiraUrl,
  children,
}: {
  jiraUrl: string;
  children: ReactNode;
}) {
  return (
    <JiraUrlContext.Provider value={jiraUrl.trim()}>
      {children}
    </JiraUrlContext.Provider>
  );
}

/**
 * An issue key that opens the issue in Jira. `target="_blank"` makes Electron
 * hand the URL to the default browser (see `setWindowOpenHandler`). Without a
 * configured Jira URL the key renders as plain text.
 */
export function IssueKeyLink({
  issueKey,
  className,
  style,
}: {
  issueKey: string;
  className?: string;
  style?: CSSProperties;
}) {
  const jiraUrl = useContext(JiraUrlContext);
  if (!jiraUrl) {
    return (
      <span className={className} style={style}>
        {issueKey}
      </span>
    );
  }
  return (
    <a
      href={jiraBrowseUrl(jiraUrl, issueKey)}
      target="_blank"
      rel="noreferrer"
      title={`${issueKey} in Jira öffnen`}
      // Rows that toggle or select on click must not react to the link.
      onClick={(e) => e.stopPropagation()}
      className={`underline-offset-2 hover:underline ${className ?? ""}`}
      style={style}
    >
      {issueKey}
    </a>
  );
}
