CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`regular_work_minutes` integer DEFAULT 420 NOT NULL,
	`daily_target_minutes` integer DEFAULT 420 NOT NULL,
	`breaks` text DEFAULT '[]' NOT NULL,
	`auto_pause_enabled` integer DEFAULT true NOT NULL,
	`booking_mode` text DEFAULT 'grouped' NOT NULL,
	`data_retention_days` integer DEFAULT 90 NOT NULL,
	`jira_url` text DEFAULT '' NOT NULL,
	`jira_project_keys` text DEFAULT '[]' NOT NULL,
	`jira_auth_mode` text DEFAULT 'token' NOT NULL,
	`jira_token` text,
	`jira_user` text,
	`jira_password` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`submitted_at` text,
	`jira_issue_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `time_entries_started_idx` ON `time_entries` (`started_at`);--> statement-breakpoint
CREATE INDEX `time_entries_submitted_idx` ON `time_entries` (`submitted_at`);