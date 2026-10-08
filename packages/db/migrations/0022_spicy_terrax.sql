CREATE TABLE `discovery_edition_items` (
	`edition_id` text NOT NULL,
	`item_id` text NOT NULL,
	`rank` integer NOT NULL,
	`frozen_json` text NOT NULL,
	FOREIGN KEY (`edition_id`) REFERENCES `discovery_editions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `discovery_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_edition_items_json" CHECK(json_valid("discovery_edition_items"."frozen_json") AND length("discovery_edition_items"."frozen_json") <= 32768),
	CONSTRAINT "discovery_edition_items_rank" CHECK("discovery_edition_items"."rank" BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_edition_items_identity_uq` ON `discovery_edition_items` (`edition_id`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_edition_items_rank_uq` ON `discovery_edition_items` (`edition_id`,`rank`);--> statement-breakpoint
CREATE TABLE `discovery_editions` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_day` text NOT NULL,
	`channel_id` text NOT NULL,
	`revision` integer NOT NULL,
	`state` text DEFAULT 'draft' NOT NULL,
	`rule_version` text NOT NULL,
	`sources_json` text NOT NULL,
	`source_job_ids_json` text NOT NULL,
	`publish_job_id` text NOT NULL,
	`lease_token` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`publish_job_id`) REFERENCES `discovery_sync_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_editions_json" CHECK(json_valid("discovery_editions"."sources_json") AND json_valid("discovery_editions"."source_job_ids_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_editions_day_channel_revision_uq` ON `discovery_editions` (`edition_day`,`channel_id`,`revision`);--> statement-breakpoint
CREATE INDEX `discovery_editions_latest_idx` ON `discovery_editions` (`channel_id`,`state`,`edition_day`,`revision`);--> statement-breakpoint
CREATE TABLE `discovery_items` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_url` text,
	`github_repo_id` integer,
	`merged_into_id` text,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`bookmark_source_type` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`published_at` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`merged_into_id`) REFERENCES `discovery_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_items_aliases_json" CHECK(json_valid("discovery_items"."aliases_json") AND length("discovery_items"."aliases_json") <= 16384),
	CONSTRAINT "discovery_items_url_or_merge" CHECK("discovery_items"."canonical_url" IS NOT NULL OR "discovery_items"."merged_into_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_items_url_uq` ON `discovery_items` (`canonical_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_items_github_uq` ON `discovery_items` (`github_repo_id`);--> statement-breakpoint
CREATE INDEX `discovery_items_merge_idx` ON `discovery_items` (`merged_into_id`);--> statement-breakpoint
CREATE TABLE `discovery_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`item_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`external_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`candidate_json` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `discovery_sync_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `discovery_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_observations_json" CHECK(json_valid("discovery_observations"."candidate_json") AND length("discovery_observations"."candidate_json") <= 16384)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_observation_job_source_external_uq` ON `discovery_observations` (`job_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `discovery_observations_item_time_idx` ON `discovery_observations` (`item_id`,`observed_at`);--> statement-breakpoint
CREATE TABLE `discovery_sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`edition_day` text NOT NULL,
	`partition_key` text NOT NULL,
	`kind` text NOT NULL,
	`rule_version` text NOT NULL,
	`execution_schema_version` integer NOT NULL,
	`config_snapshot_json` text NOT NULL,
	`pool_state_json` text DEFAULT '[]' NOT NULL,
	`cursor_json` text DEFAULT '{}' NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` text,
	`lease_token` text,
	`lease_until` text,
	`error_code` text,
	`started_at` text NOT NULL,
	`deadline_at` text NOT NULL,
	`finished_at` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "discovery_jobs_json" CHECK(json_valid("discovery_sync_jobs"."config_snapshot_json") AND json_valid("discovery_sync_jobs"."pool_state_json") AND json_valid("discovery_sync_jobs"."cursor_json") AND length("discovery_sync_jobs"."config_snapshot_json") <= 65536 AND length("discovery_sync_jobs"."pool_state_json") <= 65536 AND length("discovery_sync_jobs"."cursor_json") <= 262144)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discovery_jobs_day_partition_uq` ON `discovery_sync_jobs` (`edition_day`,`partition_key`);--> statement-breakpoint
CREATE INDEX `discovery_jobs_state_retry_idx` ON `discovery_sync_jobs` (`state`,`next_retry_at`);--> statement-breakpoint
CREATE INDEX `discovery_jobs_kind_day_idx` ON `discovery_sync_jobs` (`kind`,`edition_day`);