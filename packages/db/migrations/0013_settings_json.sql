CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	CONSTRAINT `settings_value_json` CHECK(json_valid(`value`))
);
--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'ai',
	json_object(
		'deepseekApiKeyEncrypted', `deepseek_api_key_encrypted`,
		'deepseekKeyLast4', `deepseek_key_last4`,
		'deepseekModel', COALESCE(NULLIF(`deepseek_model`, ''), 'deepseek-v4-flash')
	),
	datetime('now')
FROM `users`
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'search',
	json_object(
		'anysearchApiKeyEncrypted', `anysearch_api_key_encrypted`,
		'anysearchKeyLast4', `anysearch_key_last4`
	),
	datetime('now')
FROM `users`
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'github',
	json_object('patEncrypted', `github_pat_encrypted`),
	datetime('now')
FROM `users`
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'tracking',
	json_object(
		'hotWithinDays', COALESCE(`hot_within_days`, 30),
		'staleAfterDays', COALESCE(`stale_after_days`, 180)
	),
	datetime('now')
FROM `users`
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'browsing',
	json_object(
		'publicBrowsingEnabled',
		json(CASE WHEN `public_browsing_enabled` = 1 THEN 'true' ELSE 'false' END)
	),
	datetime('now')
FROM `users`
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
INSERT OR REPLACE INTO `settings` (`key`, `value`, `updated_at`)
SELECT
	'bookmarks',
	json_object('paginationMode', 'auto', 'pageSize', 20),
	datetime('now')
FROM `users`
ORDER BY `created_at`
LIMIT 1;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `github_pat_encrypted`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `deepseek_api_key_encrypted`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `deepseek_key_last4`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `deepseek_model`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `anysearch_api_key_encrypted`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `anysearch_key_last4`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `hot_within_days`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `stale_after_days`;
--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `public_browsing_enabled`;
