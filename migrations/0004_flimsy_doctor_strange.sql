ALTER TABLE "subscriptions" ALTER COLUMN "icon_key" SET DEFAULT 'fallback';--> statement-breakpoint
UPDATE "subscriptions" SET "icon_key" = 'fallback', "accent" = 'blue' WHERE "icon_key" = 'sparkles';
