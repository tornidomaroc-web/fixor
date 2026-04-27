ALTER TABLE "orgs" RENAME COLUMN "stripe_customer_id" TO "paddle_customer_id";--> statement-breakpoint
ALTER TABLE "orgs" RENAME COLUMN "stripe_subscription_id" TO "paddle_subscription_id";
