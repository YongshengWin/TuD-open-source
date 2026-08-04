CREATE TABLE "subscription_reminder_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"due_date" text NOT NULL,
	"recipient_email" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_reminder_deliveries_status_check" CHECK ("subscription_reminder_deliveries"."status" IN ('pending', 'sent'))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "reminder_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_reminder_deliveries" ADD CONSTRAINT "subscription_reminder_deliveries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_reminder_deliveries_subscription_due_unique" ON "subscription_reminder_deliveries" USING btree ("subscription_id","due_date");--> statement-breakpoint
CREATE INDEX "subscription_reminder_deliveries_status_idx" ON "subscription_reminder_deliveries" USING btree ("status","updated_at");