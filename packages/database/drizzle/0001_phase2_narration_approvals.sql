ALTER TYPE "public"."approval_subject" ADD VALUE 'CREATIVE_GENERATION';--> statement-breakpoint
ALTER TYPE "public"."approval_subject" ADD VALUE 'NARRATION';--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "video_project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "campaign_brief_id" uuid;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "script_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "narration" jsonb;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_campaign_brief_id_campaign_briefs_id_fk" FOREIGN KEY ("campaign_brief_id") REFERENCES "public"."campaign_briefs"("id") ON DELETE cascade ON UPDATE no action;