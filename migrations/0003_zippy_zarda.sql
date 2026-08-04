ALTER TABLE "subscriptions" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "sort_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "ranked_subscriptions" AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "user_id"
			ORDER BY "created_at", "id"
		) - 1 AS "position"
	FROM "subscriptions"
)
UPDATE "subscriptions"
SET "sort_position" = "ranked_subscriptions"."position"
FROM "ranked_subscriptions"
WHERE "subscriptions"."id" = "ranked_subscriptions"."id";--> statement-breakpoint
CREATE INDEX "idx_subscriptions_user_sort" ON "subscriptions" USING btree ("user_id","is_archived","sort_position");
