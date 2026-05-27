ALTER TABLE `settings` ADD `sprint_anchor_date` text DEFAULT '2026-01-07' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `sprint_length_days` integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `concrete_issue_target_percent` integer DEFAULT 60 NOT NULL;
