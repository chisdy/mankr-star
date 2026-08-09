CREATE TABLE `github_import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`phase` text DEFAULT 'discover' NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`imported` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`queue_json` text DEFAULT '[]' NOT NULL,
	`page` integer DEFAULT 1 NOT NULL,
	`per_page` integer DEFAULT 30 NOT NULL,
	`max_pages` integer DEFAULT 3 NOT NULL,
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
CREATE INDEX `github_import_jobs_status_idx` ON `github_import_jobs` (`status`);
