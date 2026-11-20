CREATE TABLE IF NOT EXISTS `absences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_day` text NOT NULL,
	`to_day` text NOT NULL,
	`kind` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
