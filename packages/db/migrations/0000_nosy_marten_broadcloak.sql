CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`bookmark_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_jobs_status_idx` ON `ai_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `ai_jobs_bookmark_id_idx` ON `ai_jobs` (`bookmark_id`);--> statement-breakpoint
CREATE TABLE `bookmark_tags` (
	`bookmark_id` text NOT NULL,
	`tag_id` text NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_tags_uq` ON `bookmark_tags` (`bookmark_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `bookmark_tags_tag_id_idx` ON `bookmark_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text DEFAULT 'github' NOT NULL,
	`canonical_url` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`language` text,
	`stars` integer DEFAULT 0 NOT NULL,
	`forks` integer DEFAULT 0 NOT NULL,
	`license` text,
	`homepage` text,
	`default_branch` text,
	`topics_json` text DEFAULT '[]' NOT NULL,
	`summary_ai` text,
	`use_cases_json` text,
	`ai_confidence` real,
	`folder_id` text,
	`notes` text,
	`ai_status` text DEFAULT 'pending' NOT NULL,
	`track_updates` integer DEFAULT true NOT NULL,
	`last_synced_at` text,
	`pushed_at` text,
	`github_updated_at` text,
	`latest_release_tag` text,
	`sync_cursor` text,
	`archived_at` text,
	`deleted_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_source_url_uq` ON `bookmarks` (`source_type`,`canonical_url`);--> statement-breakpoint
CREATE INDEX `bookmarks_created_at_idx` ON `bookmarks` (`created_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_folder_id_idx` ON `bookmarks` (`folder_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_ai_status_idx` ON `bookmarks` (`ai_status`);--> statement-breakpoint
CREATE INDEX `bookmarks_track_synced_idx` ON `bookmarks` (`track_updates`,`last_synced_at`);--> statement-breakpoint
CREATE INDEX `bookmarks_language_idx` ON `bookmarks` (`language`);--> statement-breakpoint
CREATE INDEX `bookmarks_external_id_idx` ON `bookmarks` (`external_id`);--> statement-breakpoint
CREATE TABLE `folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`description` text,
	`is_preset` integer DEFAULT false NOT NULL,
	`parent_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`path` text DEFAULT '/' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folders_parent_slug_uq` ON `folders` (`parent_id`,`slug`);--> statement-breakpoint
CREATE INDEX `folders_parent_id_idx` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_path_idx` ON `folders` (`path`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_token_hash_idx` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_uq` ON `tags` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_uq` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE `update_events` (
	`id` text PRIMARY KEY NOT NULL,
	`bookmark_id` text NOT NULL,
	`event_type` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`detected_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `update_events_dedupe_uq` ON `update_events` (`bookmark_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `update_events_detected_at_idx` ON `update_events` (`detected_at`);--> statement-breakpoint
CREATE INDEX `update_events_bookmark_id_idx` ON `update_events` (`bookmark_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`password_hash` text NOT NULL,
	`github_pat_encrypted` text,
	`deepseek_api_key_encrypted` text,
	`deepseek_key_last4` text,
	`deepseek_model` text DEFAULT 'deepseek-v4-flash',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);