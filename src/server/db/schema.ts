import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, timestamp, integer, boolean, date, jsonb, numeric,
  smallint, uniqueIndex, index, primaryKey, customType,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

// ---------- Enums ----------
export const userKind = pgEnum("user_kind", ["worker", "business", "admin"]);
export const accountStatus = pgEnum("account_status", ["active", "suspended", "restricted", "deleted"]);
export const adminRole = pgEnum("admin_role", [
  "super_admin", "platform_admin", "verification_officer", "support_agent",
  "finance_admin", "content_moderator", "read_only_analyst",
]);
export const verificationStatus = pgEnum("verification_status", [
  "not_started", "pending", "submitted", "verified", "rejected", "expired", "requires_review",
]);
export const verificationType = pgEnum("verification_type", [
  "email", "phone", "identity", "qualification", "reference", "background_check", "business",
]);
export const workArrangement = pgEnum("work_arrangement", ["remote", "local", "hybrid"]);
export const engagementType = pgEnum("engagement_type", [
  "micro_task", "fixed_project", "flexible_shift", "recurring", "specialist_consultation", "local_service",
]);
export const payType = pgEnum("pay_type", ["hourly", "fixed", "shift", "recurring"]);
export const opportunityStatus = pgEnum("opportunity_status", [
  "draft", "pending_review", "published", "paused", "closed", "filled", "rejected",
]);
export const applicationStatus = pgEnum("application_status", [
  "draft", "submitted", "under_review", "shortlisted", "interview_requested",
  "offer_received", "accepted", "declined", "withdrawn", "expired",
]);
export const experienceLevel = pgEnum("experience_level", ["entry", "intermediate", "experienced", "expert"]);
export const businessKind = pgEnum("business_kind", ["registered_business", "household"]);
export const businessMemberRole = pgEnum("business_member_role", ["owner", "manager", "member"]);

// ---------- Identity ----------
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  kind: userKind("kind").notNull(),
  adminRole: adminRole("admin_role"),
  status: accountStatus("status").notNull().default("active"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  isDemo: boolean("is_demo").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`), index("users_kind_idx").on(t.kind, t.status)]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // email_verification | password_reset
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const userConsents = pgTable("user_consents", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(), // terms | privacy
  version: text("version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});

export const emailOutbox = pgTable("email_outbox", {
  id: id(),
  toEmail: text("to_email").notNull(),
  template: text("template").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  link: text("link"),
  status: text("status").notNull().default("queued"), // queued | sent | failed
  createdAt: createdAt(),
});

// ---------- Reference data (all admin-configurable) ----------
export const serviceAreas = pgTable("service_areas", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  country: text("country").notNull().default("CA"),
  lat: numeric("lat", { precision: 9, scale: 6 }).notNull(),
  lng: numeric("lng", { precision: 9, scale: 6 }).notNull(),
  active: boolean("active").notNull().default(true),
});

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  parentId: uuid("parent_id").references((): any => categories.id, { onDelete: "set null" }),
  requiresApproval: boolean("requires_approval").notNull().default(false), // regulated / sensitive categories
  allowedEngagementTypes: text("allowed_engagement_types").array(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const skills = pgTable("skills", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
});

// ---------- Workers ----------
export const workerProfiles = pgTable("worker_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  headline: text("headline"),
  summary: text("summary"),
  country: text("country").notNull().default("CA"),
  city: text("city"),
  postalPrefix: text("postal_prefix"), // first 3 chars only (FSA) – never a full address
  serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
  travelRadiusKm: integer("travel_radius_km").notNull().default(15),
  arrangements: text("arrangements").array().notNull().default(sql`'{}'`), // remote/local/hybrid
  engagementTypes: text("engagement_types").array().notNull().default(sql`'{}'`),
  categoryIds: uuid("category_ids").array().notNull().default(sql`'{}'`),
  languages: text("languages").array().notNull().default(sql`'{}'`),
  portfolioLinks: text("portfolio_links").array().notNull().default(sql`'{}'`),
  experienceLevel: experienceLevel("experience_level").notNull().default("intermediate"),
  timezone: text("timezone").notNull().default("America/Edmonton"),
  maxHoursPerWeek: integer("max_hours_per_week"),
  minAssignmentDays: integer("min_assignment_days"),
  maxAssignmentDays: integer("max_assignment_days"),
  availabilityPaused: boolean("availability_paused").notNull().default(false),
  currency: text("currency").notNull().default("CAD"),
  preferredHourlyCents: integer("preferred_hourly_cents"),
  minHourlyCents: integer("min_hourly_cents"),
  minHourlyIsHard: boolean("min_hourly_is_hard").notNull().default(false),
  preferredFixedCents: integer("preferred_fixed_cents"),
  willingToNegotiate: boolean("willing_to_negotiate").notNull().default(true),
  publicProfile: boolean("public_profile").notNull().default(true), // visible to verified businesses
  onboardingStep: smallint("onboarding_step").notNull().default(1),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workerSkills = pgTable("worker_skills", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  years: smallint("years"),
}, (t) => [primaryKey({ columns: [t.userId, t.skillId] })]);

export const workerExperience = pgTable("worker_experience", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  organisation: text("organisation").notNull(),
  startYear: smallint("start_year").notNull(),
  endYear: smallint("end_year"),
  description: text("description"),
});

export const workerEducation = pgTable("worker_education", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  institution: text("institution").notNull(),
  credential: text("credential").notNull(),
  year: smallint("year"),
});

export const workerCertifications = pgTable("worker_certifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  issuer: text("issuer"),
  year: smallint("year"),
  verificationStatus: verificationStatus("verification_status").notNull().default("not_started"),
});

export const workerAvailability = pgTable("worker_availability", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // 0 = Sunday … 6 = Saturday
  startMinute: smallint("start_minute").notNull(),
  endMinute: smallint("end_minute").notNull(),
}, (t) => [index("worker_avail_user_idx").on(t.userId)]);

export const workerUnavailability = pgTable("worker_unavailability", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  reason: text("reason"),
}, (t) => [index("worker_unavail_user_idx").on(t.userId)]);

// ---------- Verification ----------
export const verifications = pgTable("verifications", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  businessId: uuid("business_id"),
  type: verificationType("type").notNull(),
  status: verificationStatus("status").notNull().default("not_started"),
  provider: text("provider"), // e.g. "manual", future identity provider
  notes: text("notes"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("verifications_status_idx").on(t.type, t.status)]);

// ---------- Businesses ----------
export const businesses = pgTable("businesses", {
  id: id(),
  kind: businessKind("kind").notNull().default("registered_business"),
  name: text("name").notNull(),
  industry: text("industry"),
  businessType: text("business_type"),
  description: text("description"),
  website: text("website"),
  contactEmail: text("contact_email"),
  sizeBand: text("size_band"),
  city: text("city"),
  serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
  verificationStatus: verificationStatus("verification_status").notNull().default("not_started"),
  status: accountStatus("status").notNull().default("active"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const businessMembers = pgTable("business_members", {
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: businessMemberRole("role").notNull().default("owner"),
}, (t) => [primaryKey({ columns: [t.businessId, t.userId] })]);

// ---------- Opportunities ----------
export const opportunities = pgTable("opportunities", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  responsibilities: text("responsibilities"),
  engagementType: engagementType("engagement_type").notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  arrangement: workArrangement("arrangement").notNull(),
  serviceAreaId: uuid("service_area_id").references(() => serviceAreas.id),
  locationNote: text("location_note"), // approximate only
  payType: payType("pay_type").notNull(),
  payMinCents: integer("pay_min_cents").notNull(),
  payMaxCents: integer("pay_max_cents").notNull(),
  currency: text("currency").notNull().default("CAD"),
  estimatedHours: integer("estimated_hours"),
  hoursPerWeek: integer("hours_per_week"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  applicationDeadline: date("application_deadline"),
  workersNeeded: smallint("workers_needed").notNull().default(1),
  experienceLevel: experienceLevel("experience_level").notNull().default("entry"),
  recurring: boolean("recurring").notNull().default(false),
  recurrenceNote: text("recurrence_note"),
  deliverables: text("deliverables"),
  equipment: text("equipment"),
  selectionProcess: text("selection_process"),
  cancellationTerms: text("cancellation_terms"),
  qualificationsRequired: text("qualifications_required"),
  status: opportunityStatus("status").notNull().default("draft"),
  moderationNote: text("moderation_note"),
  featured: boolean("featured").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  search: tsvector("search").generatedAlwaysAs(
    sql`to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(responsibilities,''))`,
  ),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("opp_status_idx").on(t.status, t.publishedAt),
  index("opp_business_idx").on(t.businessId),
  index("opp_search_idx").using("gin", t.search),
]);

export const opportunitySkills = pgTable("opportunity_skills", {
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  skillId: uuid("skill_id").notNull().references(() => skills.id, { onDelete: "cascade" }),
  mandatory: boolean("mandatory").notNull().default(false),
}, (t) => [primaryKey({ columns: [t.opportunityId, t.skillId] })]);

export const opportunitySchedules = pgTable("opportunity_schedules", {
  id: id(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(),
  startMinute: smallint("start_minute").notNull(),
  endMinute: smallint("end_minute").notNull(),
});

export const savedOpportunities = pgTable("saved_opportunities", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.opportunityId] })]);

export const savedSearches = pgTable("saved_searches", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  params: jsonb("params").notNull(),
  alertsEnabled: boolean("alerts_enabled").notNull().default(false),
  createdAt: createdAt(),
});

// ---------- Applications ----------
export const applications = pgTable("applications", {
  id: id(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: applicationStatus("status").notNull().default("submitted"),
  proposal: text("proposal").notNull(),
  proposedRateCents: integer("proposed_rate_cents"),
  availabilityNote: text("availability_note"),
  matchScore: smallint("match_score"), // snapshot at submit time, informational only
  matchSnapshot: jsonb("match_snapshot"),
  businessNote: text("business_note"), // internal; never shown to worker
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("applications_opp_worker_uq").on(t.opportunityId, t.workerId), index("applications_worker_idx").on(t.workerId)]);

export const applicationStatusHistory = pgTable("application_status_history", {
  id: id(),
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  fromStatus: applicationStatus("from_status"),
  toStatus: applicationStatus("to_status").notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  note: text("note"),
  createdAt: createdAt(),
});

// ---------- Notifications ----------
export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notif_user_idx").on(t.userId, t.readAt)]);

// ---------- Admin / config ----------
export const matchingRules = pgTable("matching_rules", {
  id: id(),
  version: integer("version").notNull().unique(),
  weights: jsonb("weights").notNull(),
  thresholds: jsonb("thresholds").notNull(),
  active: boolean("active").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  note: text("note"),
  createdAt: createdAt(),
});

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: updatedAt(),
});

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  detail: jsonb("detail"),
  createdAt: createdAt(),
}, (t) => [index("audit_created_idx").on(t.createdAt)]);

export const adminNotes = pgTable("admin_notes", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  note: text("note").notNull(),
  createdAt: createdAt(),
});
