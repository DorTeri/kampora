ALTER TABLE "generated_assets" DROP CONSTRAINT "generated_assets_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "generation_jobs" DROP CONSTRAINT "generation_jobs_idempotency_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "generated_assets_org_idempotency_uq" ON "generated_assets" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_org_idempotency_uq" ON "generation_jobs" USING btree ("org_id","idempotency_key");