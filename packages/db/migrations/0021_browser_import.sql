CREATE TABLE `browser_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`source` text DEFAULT 'html' NOT NULL,
	`placement` text,
	`dead_policy` text,
	`has_folders` integer DEFAULT 0 NOT NULL,
	`classified` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`imported` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`current_title` text,
	`last_error` text,
	`continue_token` text NOT NULL,
	`lease_until` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `browser_import_jobs_status_idx` ON `browser_import_jobs` (`status`);
--> statement-breakpoint
CREATE TABLE `browser_import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`batch_index` integer NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`folder_path_json` text DEFAULT '[]' NOT NULL,
	`canonical_url` text,
	`source_type` text,
	`external_id` text,
	`owner` text,
	`link_status` text DEFAULT 'pending' NOT NULL,
	`http_status` integer,
	`suggested_folder_id` text,
	`suggested_folder_json` text,
	`ai_done` integer DEFAULT 0 NOT NULL,
	`decision` text DEFAULT 'pending' NOT NULL,
	`bookmark_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `browser_import_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `browser_import_items_job_seq_uq` ON `browser_import_items` (`job_id`,`seq`);
--> statement-breakpoint
CREATE INDEX `browser_import_items_job_batch_idx` ON `browser_import_items` (`job_id`,`batch_index`);
--> statement-breakpoint
CREATE INDEX `browser_import_items_job_status_idx` ON `browser_import_items` (`job_id`,`link_status`);
