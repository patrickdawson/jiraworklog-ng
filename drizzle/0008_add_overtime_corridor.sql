ALTER TABLE `settings` ADD `overtime_corridor_center_hours` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `overtime_corridor_range_hours` integer DEFAULT 40 NOT NULL;
