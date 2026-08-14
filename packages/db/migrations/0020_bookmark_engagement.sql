CREATE TABLE `bookmark_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`bookmark_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmark_likes_bookmark_fp_uq` ON `bookmark_likes` (`bookmark_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `bookmark_likes_fingerprint_idx` ON `bookmark_likes` (`fingerprint`);--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `view_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `open_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `like_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `bookmarks_view_count_idx` ON `bookmarks` (`view_count`);--> statement-breakpoint
CREATE INDEX `bookmarks_open_count_idx` ON `bookmarks` (`open_count`);--> statement-breakpoint
CREATE INDEX `bookmarks_like_count_idx` ON `bookmarks` (`like_count`);
