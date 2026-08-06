ALTER TABLE `bookmarks` ADD `account_registered` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `account_username` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `account_password_encrypted` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `account_password_updated_at` text;
