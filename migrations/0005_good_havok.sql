CREATE TABLE "icon_assets" (
	"sha256" text PRIMARY KEY NOT NULL,
	"content_base64" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icon_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"upstream_key" text NOT NULL,
	"display_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"search_text" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" integer DEFAULT 1000 NOT NULL,
	"mime_type" text,
	"license" text,
	"source_page" text,
	"source_revision" text,
	"asset_url" text,
	"website_domain" text,
	"accent" text,
	"asset_sha256" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "icon_catalog_state" (
	"provider" text PRIMARY KEY NOT NULL,
	"seed_version" text NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "icon_id" text;--> statement-breakpoint
ALTER TABLE "icon_catalog" ADD CONSTRAINT "icon_catalog_asset_sha256_icon_assets_sha256_fk" FOREIGN KEY ("asset_sha256") REFERENCES "public"."icon_assets"("sha256") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "icon_catalog_provider_upstream_key_unique" ON "icon_catalog" USING btree ("provider","upstream_key");--> statement-breakpoint
CREATE INDEX "icon_catalog_normalized_name_idx" ON "icon_catalog" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "icon_catalog_provider_active_idx" ON "icon_catalog" USING btree ("provider","is_active","priority");--> statement-breakpoint
CREATE INDEX "icon_catalog_website_domain_idx" ON "icon_catalog" USING btree ("website_domain");--> statement-breakpoint
CREATE INDEX "icon_catalog_asset_sha256_idx" ON "icon_catalog" USING btree ("asset_sha256");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_icon_id_icon_catalog_id_fk" FOREIGN KEY ("icon_id") REFERENCES "public"."icon_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_subscriptions_icon" ON "subscriptions" USING btree ("icon_id");--> statement-breakpoint
WITH "legacy_local_icons" AS (
	SELECT
		"icon_key",
		min("name") AS "display_name",
		min("accent") AS "accent"
	FROM "subscriptions"
	WHERE "icon_key" IN (
		'spotify', 'youtube', 'googleone', 'icloud', 'netflix', 'duolingo', 'disneyplus', 'cloudflare',
		'amazonprime', 'twitter', 'adobecreativecloud', 'notion', 'chatgpt', 'github', 'figma', 'apple'
	)
	GROUP BY "icon_key"
)
INSERT INTO "icon_catalog" (
	"id", "provider", "upstream_key", "display_name", "normalized_name", "search_text", "priority",
	"mime_type", "license", "source_revision", "asset_url", "accent", "metadata"
)
SELECT
	'local:' || "icon_key",
	'local',
	"icon_key",
	"display_name",
	lower("display_name"),
	lower("display_name" || ' ' || "icon_key"),
	5,
	'image/svg+xml',
	'NOASSERTION',
	'legacy-migration',
	'/brands/' || "icon_key" || '.svg',
	"accent",
	'{"legacy":true}'::jsonb
FROM "legacy_local_icons"
ON CONFLICT ("provider", "upstream_key") DO NOTHING;--> statement-breakpoint
WITH "legacy_simple_icons" AS (
	SELECT
		substring("icon_key" FROM 8) AS "upstream_key",
		min("name") AS "display_name",
		min("accent") AS "accent"
	FROM "subscriptions"
	WHERE "icon_key" ~ '^simple-[a-z0-9_]{1,80}$'
	GROUP BY "icon_key"
)
INSERT INTO "icon_catalog" (
	"id", "provider", "upstream_key", "display_name", "normalized_name", "search_text", "priority",
	"mime_type", "license", "source_page", "source_revision", "asset_url", "accent", "metadata"
)
SELECT
	'simple-icons:' || "upstream_key",
	'simple-icons',
	"upstream_key",
	"display_name",
	lower("display_name"),
	lower("display_name" || ' ' || "upstream_key"),
	50,
	'image/svg+xml',
	'CC0-1.0',
	'https://www.npmjs.com/package/simple-icons/v/16.27.0',
	'16.27.0',
	'/brands/simple/16.27.0/' || "upstream_key" || '.svg',
	"accent",
	'{"legacy":true}'::jsonb
FROM "legacy_simple_icons"
ON CONFLICT ("provider", "upstream_key") DO NOTHING;--> statement-breakpoint
UPDATE "subscriptions"
SET "icon_id" = 'local:' || "icon_key"
WHERE "icon_key" IN (
	'spotify', 'youtube', 'googleone', 'icloud', 'netflix', 'duolingo', 'disneyplus', 'cloudflare',
	'amazonprime', 'twitter', 'adobecreativecloud', 'notion', 'chatgpt', 'github', 'figma', 'apple'
);--> statement-breakpoint
UPDATE "subscriptions"
SET "icon_id" = 'simple-icons:' || substring("icon_key" FROM 8)
WHERE "icon_key" ~ '^simple-[a-z0-9_]{1,80}$';
