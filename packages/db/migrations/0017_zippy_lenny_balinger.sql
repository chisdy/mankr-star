ALTER TABLE `bookmarks` ADD `pricing` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `bookmarks_pricing_idx` ON `bookmarks` (`pricing`);--> statement-breakpoint
CREATE INDEX `bookmarks_featured_idx` ON `bookmarks` (`featured`);
