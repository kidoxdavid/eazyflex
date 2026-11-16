CREATE TYPE "public"."slice_status" AS ENUM('proposed', 'confirmed', 'declined', 'released');--> statement-breakpoint
CREATE TABLE "coverage_slices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"status" "slice_status" DEFAULT 'proposed' NOT NULL,
	"outside_availability" boolean DEFAULT false NOT NULL,
	"agreed_outside" boolean DEFAULT false NOT NULL,
	"proposed_by" uuid,
	"responded_at" timestamp with time zone,
	"released_by" uuid,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handover_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_slice_id" uuid NOT NULL,
	"to_slice_id" uuid NOT NULL,
	"note" text NOT NULL,
	"author_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "email_alerts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "last_alerted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "coverage_slices" ADD CONSTRAINT "coverage_slices_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_slices" ADD CONSTRAINT "coverage_slices_worker_id_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_slices" ADD CONSTRAINT "coverage_slices_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_slices" ADD CONSTRAINT "coverage_slices_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_from_slice_id_coverage_slices_id_fk" FOREIGN KEY ("from_slice_id") REFERENCES "public"."coverage_slices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_to_slice_id_coverage_slices_id_fk" FOREIGN KEY ("to_slice_id") REFERENCES "public"."coverage_slices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handover_notes" ADD CONSTRAINT "handover_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "slices_opp_idx" ON "coverage_slices" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "slices_worker_idx" ON "coverage_slices" USING btree ("worker_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "handover_pair_uq" ON "handover_notes" USING btree ("from_slice_id","to_slice_id");--> statement-breakpoint
ALTER TABLE coverage_slices ADD CONSTRAINT slices_range_chk CHECK (weekday BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
--> statement-breakpoint
ALTER TABLE handover_notes ADD CONSTRAINT handover_distinct_chk CHECK (from_slice_id <> to_slice_id AND length(btrim(note)) >= 5);
