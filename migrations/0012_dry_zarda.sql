CREATE TABLE "subscription_member_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"member_id" text NOT NULL,
	"member_name" text NOT NULL,
	"scheduled_due_date" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency_code" text NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_member_payments_amount_check" CHECK ("subscription_member_payments"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "member_schedules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_member_payments" ADD CONSTRAINT "subscription_member_payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_member_payments_sub_collected_idx" ON "subscription_member_payments" USING btree ("subscription_id","collected_at");