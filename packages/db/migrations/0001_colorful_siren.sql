ALTER TABLE `bookmarks` ADD `sync_status` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `last_sync_error` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `health_status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `github_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `repo_size` integer;--> statement-breakpoint
CREATE INDEX `bookmarks_health_status_idx` ON `bookmarks` (`health_status`);--> statement-breakpoint
CREATE INDEX `bookmarks_source_type_idx` ON `bookmarks` (`source_type`);--> statement-breakpoint
ALTER TABLE `users` ADD `hot_within_days` integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `stale_after_days` integer DEFAULT 180 NOT NULL;--> statement-breakpoint
-- 存量本地回填：有 last_synced_at 视为曾同步成功；按默认 30/180 天重算近况
UPDATE `bookmarks` SET `sync_status` = 'ok'
WHERE `source_type` = 'github' AND `last_synced_at` IS NOT NULL AND `sync_status` = 'never';--> statement-breakpoint
UPDATE `bookmarks` SET `health_status` = CASE
  WHEN `pushed_at` IS NULL THEN 'unknown'
  WHEN (julianday('now') - julianday(replace(replace(`pushed_at`, 'T', ' '), 'Z', ''))) <= 30 THEN 'hot'
  WHEN (julianday('now') - julianday(replace(replace(`pushed_at`, 'T', ' '), 'Z', ''))) < 180 THEN 'active'
  ELSE 'stale'
END
WHERE `source_type` = 'github' AND `deleted_at` IS NULL AND `health_status` = 'unknown';
