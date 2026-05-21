import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const BOOKING_MODES = ["grouped", "individual"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const JIRA_AUTH_MODES = ["token", "basic"] as const;
export type JiraAuthMode = (typeof JIRA_AUTH_MODES)[number];

/** A single tracked time span. `endedAt = null` ⇒ the timer is still running. */
export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    description: text("description").notNull().default(""),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    submittedAt: text("submitted_at"),
    jiraIssueKey: text("jira_issue_key"),
    /** When true, the entry is booked directly on the configured Allgemeines issue. */
    isAllgemeines: integer("is_allgemeines", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("time_entries_started_idx").on(table.startedAt),
    index("time_entries_submitted_idx").on(table.submittedAt),
  ],
);

/** Single-row application settings (always `id = 1`). */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  regularWorkMinutes: integer("regular_work_minutes").notNull().default(420),
  dailyTargetMinutes: integer("daily_target_minutes").notNull().default(420),
  /** JSON array of `{ start: "HH:MM", end: "HH:MM" }`. */
  breaks: text("breaks").notNull().default("[]"),
  autoPauseEnabled: integer("auto_pause_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  bookingMode: text("booking_mode")
    .$type<BookingMode>()
    .notNull()
    .default("grouped"),
  dataRetentionDays: integer("data_retention_days").notNull().default(90),
  jiraUrl: text("jira_url").notNull().default(""),
  /** JSON array of project keys, e.g. `["TXR","TXA","TX4B"]`. */
  jiraProjectKeys: text("jira_project_keys").notNull().default("[]"),
  jiraAuthMode: text("jira_auth_mode")
    .$type<JiraAuthMode>()
    .notNull()
    .default("token"),
  jiraToken: text("jira_token"),
  jiraUser: text("jira_user"),
  jiraPassword: text("jira_password"),
  /** Issue key that collects a sum worklog of every non-Allgemeines booking. */
  allgemeinesIssueKey: text("allgemeines_issue_key").notNull().default(""),
  addAllgemeinesSummary: integer("add_allgemeines_summary", { mode: "boolean" })
    .notNull()
    .default(true),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type SettingsRow = typeof settings.$inferSelect;
