CREATE TABLE "deletion_ledger" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'self_service' NOT NULL
);
