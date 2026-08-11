CREATE TABLE `bookmark_embeddings` (
	`bookmark_id` text PRIMARY KEY NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` text NOT NULL,
	`content_hash` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmark_embeddings_model_idx` ON `bookmark_embeddings` (`model`);
