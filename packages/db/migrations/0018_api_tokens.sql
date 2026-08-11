CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`scopes` text DEFAULT '["read"]' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_used_at` text,
	`revoked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_uq` ON `api_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `api_tokens_prefix_idx` ON `api_tokens` (`token_prefix`);
