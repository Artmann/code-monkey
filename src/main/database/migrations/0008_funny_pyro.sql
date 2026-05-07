DROP TABLE IF EXISTS `workspaces`;--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`last_active_thread_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `workspaces` (`id`, `name`, `sort_order`, `created_at`)
	VALUES ('00000000-0000-4000-8000-000000000001', 'Personal', 0, unixepoch());
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`directory_path` text NOT NULL,
	`provider` text,
	`external_thread_id` text,
	`status` text NOT NULL,
	`error_message` text,
	`tab_order` integer DEFAULT 0 NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_threads`(`id`, `workspace_id`, `name`, `directory_path`, `provider`, `external_thread_id`, `status`, `error_message`, `tab_order`, `closed_at`, `created_at`, `last_activity_at`)
	SELECT `id`, '00000000-0000-4000-8000-000000000001', `name`, `directory_path`, `provider`, `external_thread_id`, `status`, `error_message`, `tab_order`, `closed_at`, `created_at`, `last_activity_at` FROM `threads`;
--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
INSERT INTO `settings` (`key`, `value`, `updated_at`)
	VALUES ('activeWorkspaceId', '00000000-0000-4000-8000-000000000001', unixepoch())
	ON CONFLICT(`key`) DO NOTHING;
