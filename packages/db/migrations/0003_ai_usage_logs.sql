CREATE TABLE `ai_usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`bookmark_id` text,
	`error_code` text,
	`latency_ms` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_usage_logs_created_at_idx` ON `ai_usage_logs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `ai_usage_logs_kind_idx` ON `ai_usage_logs` (`kind`);
--> statement-breakpoint
CREATE INDEX `ai_usage_logs_model_idx` ON `ai_usage_logs` (`model`);
