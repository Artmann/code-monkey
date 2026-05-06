DROP TABLE IF EXISTS `thread_events`;--> statement-breakpoint
DROP TABLE IF EXISTS `threads`;--> statement-breakpoint
DROP TABLE IF EXISTS `tasks`;--> statement-breakpoint
DROP TABLE IF EXISTS `projects`;--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`directory_path` text NOT NULL,
	`provider` text,
	`external_thread_id` text,
	`status` text NOT NULL,
	`error_message` text,
	`tab_order` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_events` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_events_thread_sequence_idx` ON `thread_events` (`thread_id`,`sequence`);
