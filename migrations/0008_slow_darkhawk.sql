CREATE TABLE "email_delivery_daily" (
	"delivery_day" text NOT NULL,
	"recipient_email" text NOT NULL,
	"delivery_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_daily_delivery_day_recipient_email_pk" PRIMARY KEY("delivery_day","recipient_email"),
	CONSTRAINT "email_delivery_daily_count_check" CHECK ("email_delivery_daily"."delivery_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "email_delivery_daily_day_idx" ON "email_delivery_daily" USING btree ("delivery_day");