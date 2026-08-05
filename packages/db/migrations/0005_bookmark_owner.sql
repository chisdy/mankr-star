ALTER TABLE `bookmarks` ADD `owner` text;--> statement-breakpoint
UPDATE `bookmarks` SET `owner` = substr(`external_id`, 1, instr(`external_id`, '/') - 1)
WHERE `owner` IS NULL AND instr(`external_id`, '/') > 0;--> statement-breakpoint
CREATE INDEX `bookmarks_owner_idx` ON `bookmarks` (`owner`);
