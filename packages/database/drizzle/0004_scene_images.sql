CREATE TYPE "public"."scene_image_decision" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TYPE "public"."approval_subject" ADD VALUE 'SCENE_IMAGE';--> statement-breakpoint
CREATE TABLE "scene_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"video_project_id" uuid NOT NULL,
	"scene_key" text NOT NULL,
	"version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"error" text,
	"asset_id" uuid,
	"estimated_micro_usd" bigint NOT NULL,
	"charge_type" charge_type,
	"cached" boolean DEFAULT false NOT NULL,
	"decision" "scene_image_decision" DEFAULT 'PENDING' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scene_images" ADD CONSTRAINT "scene_images_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_images" ADD CONSTRAINT "scene_images_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_images" ADD CONSTRAINT "scene_images_asset_id_generated_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."generated_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_images" ADD CONSTRAINT "scene_images_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_images" ADD CONSTRAINT "scene_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_images_project_idx" ON "scene_images" USING btree ("video_project_id","scene_key");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_images_version_uq" ON "scene_images" USING btree ("video_project_id","scene_key","version");