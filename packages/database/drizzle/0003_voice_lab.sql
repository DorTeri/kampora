ALTER TYPE "public"."approval_subject" ADD VALUE 'VOICE_TEST';--> statement-breakpoint
CREATE TABLE "voice_lab_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"candidate_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"voice_id" text NOT NULL,
	"style" text NOT NULL,
	"script_hash" text NOT NULL,
	"spoken_text" text NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"error" text,
	"asset_id" uuid,
	"duration_sec" real,
	"characters" integer NOT NULL,
	"estimated_micro_usd" bigint NOT NULL,
	"charge_type" charge_type,
	"cached" boolean DEFAULT false NOT NULL,
	"ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"rated_by" uuid,
	"rated_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_lab_samples" ADD CONSTRAINT "voice_lab_samples_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_lab_samples" ADD CONSTRAINT "voice_lab_samples_asset_id_generated_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."generated_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_lab_samples" ADD CONSTRAINT "voice_lab_samples_rated_by_users_id_fk" FOREIGN KEY ("rated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_lab_samples" ADD CONSTRAINT "voice_lab_samples_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_lab_samples_org_idx" ON "voice_lab_samples" USING btree ("org_id","created_at");