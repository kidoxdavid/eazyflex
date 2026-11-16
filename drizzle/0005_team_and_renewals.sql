CREATE TYPE "public"."occurrence_status" AS ENUM('scheduled', 'completed', 'missed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('pending', 'accepted', 'declined', 'withdrawn', 'expired');--> statement-breakpoint
CREATE TABLE "assignment_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"occurs_on" date NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"status" "occurrence_status" DEFAULT 'scheduled' NOT NULL,
	"hours" numeric(5, 2),
	"worker_note" text,
	"cancel_reason" text,
	"cancelled_by" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "business_member_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "renewal_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"new_end_date" date NOT NULL,
	"new_agreed_cents" integer,
	"note" text,
	"status" "renewal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "prefer_same_worker" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_occurrences" ADD CONSTRAINT "assignment_occurrences_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_occurrences" ADD CONSTRAINT "assignment_occurrences_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_occurrences" ADD CONSTRAINT "assignment_occurrences_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_offers" ADD CONSTRAINT "renewal_offers_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewal_offers" ADD CONSTRAINT "renewal_offers_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "occurrence_uq" ON "assignment_occurrences" USING btree ("assignment_id","occurs_on","start_minute");--> statement-breakpoint
CREATE INDEX "occurrence_assignment_idx" ON "assignment_occurrences" USING btree ("assignment_id","occurs_on");--> statement-breakpoint
CREATE INDEX "biz_invites_business_idx" ON "business_invitations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "renewal_one_pending_uq" ON "renewal_offers" USING btree ("assignment_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX business_one_owner_uq ON business_members (business_id) WHERE role = 'owner';
--> statement-breakpoint
CREATE UNIQUE INDEX business_one_membership_per_user_uq ON business_members (user_id);
--> statement-breakpoint
ALTER TABLE business_invitations ADD CONSTRAINT biz_invite_role_chk CHECK (role <> 'owner');
--> statement-breakpoint
CREATE UNIQUE INDEX biz_invite_open_uq ON business_invitations (business_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE assignment_occurrences ADD CONSTRAINT occ_range_chk CHECK (end_minute > start_minute AND start_minute >= 0 AND end_minute <= 1440);
--> statement-breakpoint
ALTER TABLE assignment_occurrences ADD CONSTRAINT occ_hours_chk CHECK (hours IS NULL OR (hours > 0 AND hours <= 24));
