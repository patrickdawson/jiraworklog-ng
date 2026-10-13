ALTER TABLE `settings` ADD `away_check_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `group_colors` (
	`group_key` text PRIMARY KEY NOT NULL,
	`color` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
