DROP TRIGGER IF EXISTS `bookmarks_fts_after_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `bookmarks_fts_after_update`;
--> statement-breakpoint
CREATE TRIGGER `bookmarks_fts_after_insert` AFTER INSERT ON `bookmarks` BEGIN
	INSERT INTO `bookmarks_fts` (
		`bookmark_id`,
		`title`,
		`description`,
		`summary_ai`,
		`notes`,
		`content_excerpt`,
		`external_id`,
		`owner`,
		`site_name`
	)
	SELECT
		new.`id`,
		coalesce(new.`title`, ''),
		coalesce(new.`description`, ''),
		coalesce(new.`summary_ai`, ''),
		coalesce(new.`notes`, ''),
		coalesce(new.`content_excerpt`, ''),
		coalesce(new.`external_id`, ''),
		coalesce(new.`owner`, ''),
		coalesce(new.`site_name`, '')
	WHERE new.`deleted_at` IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `bookmarks_fts_after_update` AFTER UPDATE OF
	`title`,
	`description`,
	`summary_ai`,
	`notes`,
	`content_excerpt`,
	`external_id`,
	`owner`,
	`site_name`,
	`deleted_at`
ON `bookmarks` BEGIN
	DELETE FROM `bookmarks_fts` WHERE `bookmark_id` = old.`id`;
	INSERT INTO `bookmarks_fts` (
		`bookmark_id`,
		`title`,
		`description`,
		`summary_ai`,
		`notes`,
		`content_excerpt`,
		`external_id`,
		`owner`,
		`site_name`
	)
	SELECT
		new.`id`,
		coalesce(new.`title`, ''),
		coalesce(new.`description`, ''),
		coalesce(new.`summary_ai`, ''),
		coalesce(new.`notes`, ''),
		coalesce(new.`content_excerpt`, ''),
		coalesce(new.`external_id`, ''),
		coalesce(new.`owner`, ''),
		coalesce(new.`site_name`, '')
	WHERE new.`deleted_at` IS NULL;
END;
--> statement-breakpoint
DELETE FROM `bookmarks_fts`
WHERE `bookmark_id` IN (
	SELECT `id` FROM `bookmarks` WHERE `deleted_at` IS NOT NULL
);
