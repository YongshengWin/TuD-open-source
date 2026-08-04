CREATE TABLE "ai_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "summary_currency" text DEFAULT 'CNY' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_api_keys" ADD CONSTRAINT "ai_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_api_keys_token_hash_unique" ON "ai_api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ai_api_keys_user_created_idx" ON "ai_api_keys" USING btree ("user_id","created_at");