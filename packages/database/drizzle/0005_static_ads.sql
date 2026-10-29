CREATE TABLE "static_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"video_project_id" uuid NOT NULL,
	"format" text NOT NULL,
	"version" integer NOT NULL,
	"ad" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"status" "job_status" DEFAULT 'QUEUED' NOT NULL,
	"error" text,
	"png_key" text,
	"jpeg_key" text,
	"png_bytes" integer,
	"jpeg_bytes" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "static_ads" ADD CONSTRAINT "static_ads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_ads" ADD CONSTRAINT "static_ads_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "static_ads" ADD CONSTRAINT "static_ads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "static_ads_project_idx" ON "static_ads" USING btree ("video_project_id","format");--> statement-breakpoint
CREATE UNIQUE INDEX "static_ads_version_uq" ON "static_ads" USING btree ("video_project_id","format","version");