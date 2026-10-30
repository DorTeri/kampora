CREATE TABLE "creative_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_ref" text NOT NULL,
	"decision" text NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"video_project_id" uuid,
	"campaign_brief_id" uuid,
	"subject_type" text NOT NULL,
	"subject_ref" text NOT NULL,
	"rubric_version" text NOT NULL,
	"expertise_version" text NOT NULL,
	"verdict" text NOT NULL,
	"rounds" integer NOT NULL,
	"history" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_briefs" ADD COLUMN "professional_brief" jsonb;--> statement-breakpoint
ALTER TABLE "creative_feedback" ADD CONSTRAINT "creative_feedback_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_feedback" ADD CONSTRAINT "creative_feedback_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_feedback" ADD CONSTRAINT "creative_feedback_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_reviews" ADD CONSTRAINT "creative_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_reviews" ADD CONSTRAINT "creative_reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_reviews" ADD CONSTRAINT "creative_reviews_video_project_id_video_projects_id_fk" FOREIGN KEY ("video_project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_reviews" ADD CONSTRAINT "creative_reviews_campaign_brief_id_campaign_briefs_id_fk" FOREIGN KEY ("campaign_brief_id") REFERENCES "public"."campaign_briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creative_feedback_business_idx" ON "creative_feedback" USING btree ("org_id","business_id","created_at");--> statement-breakpoint
CREATE INDEX "creative_reviews_business_idx" ON "creative_reviews" USING btree ("org_id","business_id","created_at");--> statement-breakpoint
CREATE INDEX "creative_reviews_subject_idx" ON "creative_reviews" USING btree ("subject_type","subject_ref");