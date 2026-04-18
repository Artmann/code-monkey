PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`project_id` text,
	`codex_thread_id` text,
	`worktree_path` text,
	`branch_name` text,
	`base_branch` text,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "task_id", "project_id", "codex_thread_id", "worktree_path", "branch_name", "base_branch", "status", "error_message", "created_at", "last_activity_at") SELECT "id", "task_id", NULL, "codex_thread_id", "worktree_path", "branch_name", "base_branch", "status", "error_message", "created_at", "last_activity_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;