ALTER TABLE `threads` ADD `external_thread_id` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `provider` text;--> statement-breakpoint
UPDATE `threads` SET `external_thread_id` = `codex_thread_id`, `provider` = 'codex' WHERE `codex_thread_id` IS NOT NULL;