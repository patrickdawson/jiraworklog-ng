import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const BOOKING_MODES = ["grouped", "individual"] as const;
export type BookingMode = (typeof BOOKING_MODES)[number];

export const JIRA_AUTH_MODES = ["token", "basic"] as const;
export type JiraAuthMode = (typeof JIRA_AUTH_MODES)[number];

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Categories an "Allgemeines" entry can be assigned to for the monthly report. */
export const ALLGEMEINES_CATEGORIES = [
  "Projektorganisation",
  "Implementierung",
  "QA",
  "Release",
] as const;
export type AllgemeinesCategory = (typeof ALLGEMEINES_CATEGORIES)[number];

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
    /**
     * When true, the entry is NOT booked to Jira; it is only stored and reported
     * in the monthly category report. Concrete (non-Allgemeines) entries are still
     * booked to Jira as usual.
     */
    isAllgemeines: integer("is_allgemeines", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Report category for Allgemeines entries; null for concrete entries. */
    category: text("category").$type<AllgemeinesCategory>(),
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
  jiraProjectKeys: text("jira_project_keys")
    .notNull()
    .default(
      JSON.stringify([
        "DS",
        "TXAT",
        "TXPIV",
        "TXR",
        "TXRS",
        "TX4B",
        "TX3B",
        "TXAM",
        "PQX",
      ]),
    ),
  jiraAuthMode: text("jira_auth_mode")
    .$type<JiraAuthMode>()
    .notNull()
    .default("basic"),
  jiraToken: text("jira_token"),
  jiraUser: text("jira_user"),
  jiraPassword: text("jira_password"),
  /** Starting overtime balance in minutes (signed) brought in from before the tool was used. */
  overtimeBaselineMinutes: integer("overtime_baseline_minutes")
    .notNull()
    .default(0),
  /** UI theme: follow OS (`system`) or force `light` / `dark`. */
  themeMode: text("theme_mode")
    .$type<ThemeMode>()
    .notNull()
    .default("system"),
  /** Reference start date (YYYY-MM-DD) from which all sprints are counted. */
  sprintAnchorDate: text("sprint_anchor_date")
    .notNull()
    .default("2026-01-07"),
  /** Length of a sprint in days. */
  sprintLengthDays: integer("sprint_length_days").notNull().default(14),
  /** Target percentage of time spent on concrete (non-Allgemeines) issues. */
  concreteIssueTargetPercent: integer("concrete_issue_target_percent")
    .notNull()
    .default(60),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
export type SettingsRow = typeof settings.$inferSelect;
