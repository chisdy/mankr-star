CREATE VIRTUAL TABLE `bookmarks_fts` USING fts5(
	`bookmark_id` UNINDEXED,
	`title`,
	`description`,
	`summary_ai`,
	`notes`,
	`content_excerpt`,
	`external_id`,
	`owner`,
	`site_name`,
	tokenize = 'trigram'
);
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
	) VALUES (
		new.`id`,
		coalesce(new.`title`, ''),
		coalesce(new.`description`, ''),
		coalesce(new.`summary_ai`, ''),
		coalesce(new.`notes`, ''),
		coalesce(new.`content_excerpt`, ''),
		coalesce(new.`external_id`, ''),
		coalesce(new.`owner`, ''),
		coalesce(new.`site_name`, '')
	);
END;
--> statement-breakpoint
CREATE TRIGGER `bookmarks_fts_after_delete` AFTER DELETE ON `bookmarks` BEGIN
	DELETE FROM `bookmarks_fts` WHERE `bookmark_id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `bookmarks_fts_after_update` AFTER UPDATE ON `bookmarks` BEGIN
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
	) VALUES (
		new.`id`,
		coalesce(new.`title`, ''),
		coalesce(new.`description`, ''),
		coalesce(new.`summary_ai`, ''),
		coalesce(new.`notes`, ''),
		coalesce(new.`content_excerpt`, ''),
		coalesce(new.`external_id`, ''),
		coalesce(new.`owner`, ''),
		coalesce(new.`site_name`, '')
	);
END;
--> statement-breakpoint
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
	`id`,
	coalesce(`title`, ''),
	coalesce(`description`, ''),
	coalesce(`summary_ai`, ''),
	coalesce(`notes`, ''),
	coalesce(`content_excerpt`, ''),
	coalesce(`external_id`, ''),
	coalesce(`owner`, ''),
	coalesce(`site_name`, '')
FROM `bookmarks`;
