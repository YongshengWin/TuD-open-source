ALTER TABLE "subscription_categories" ADD COLUMN "sort_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "ranked_categories" AS (
	SELECT "id", row_number() OVER (PARTITION BY "user_id" ORDER BY "created_at", "id") - 1 AS "position"
	FROM "subscription_categories"
)
UPDATE "subscription_categories"
SET "sort_position" = "ranked_categories"."position"
FROM "ranked_categories"
WHERE "subscription_categories"."id" = "ranked_categories"."id";--> statement-breakpoint
CREATE INDEX "idx_subscription_categories_user_sort" ON "subscription_categories" USING btree ("user_id","sort_position");
