ALTER TABLE "scan_runs" ADD COLUMN "delivery_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "scan_runs_delivery_id_idx" ON "scan_runs" USING btree ("delivery_id");