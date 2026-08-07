ALTER TABLE `ai_usage_logs` ADD `cache_read_tokens` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `ai_usage_logs` ADD `cache_write_tokens` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `kb_conversations` ADD `context_summary` text;
--> statement-breakpoint
ALTER TABLE `kb_conversations` ADD `summary_covers_through_id` text;
