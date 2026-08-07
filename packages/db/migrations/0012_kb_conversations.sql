CREATE TABLE `kb_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `kb_conversations_updated_at_idx` ON `kb_conversations` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `kb_messages` (
	`id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`state` text,
	`error_code` text,
	`sources` text,
	`warnings` text,
	`plan` text,
	`activity` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `kb_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_messages_uq` ON `kb_messages` (`conversation_id`,`id`);
--> statement-breakpoint
CREATE INDEX `kb_messages_conversation_seq_idx` ON `kb_messages` (`conversation_id`,`seq`);
