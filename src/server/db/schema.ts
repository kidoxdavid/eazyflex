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
  status: text("status").notNull().default("queued"), // queued | sent | failed | skipped
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  userId: uuid("user_id"),
  category: text("category"),
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

// ---------- Phase 2: talent relationships, messaging, assignments, reviews ----------
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "declined", "withdrawn"]);
export const assignmentStatus = pgEnum("assignment_status", ["confirmed", "in_progress", "submitted", "changes_requested", "completed", "cancelled"]);

export const talentShortlist = pgTable("talent_shortlist", {
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.businessId, t.workerId] })]);

export const workerInvitations = pgTable("worker_invitations", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  message: text("message"),
  status: invitationStatus("status").notNull().default("pending"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
}, (t) => [uniqueIndex("invitations_opp_worker_uq").on(t.opportunityId, t.workerId)]);

export const conversations = pgTable("conversations", {
  id: id(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  workerLastReadAt: timestamp("worker_last_read_at", { withTimezone: true }),
  businessLastReadAt: timestamp("business_last_read_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("conversations_pair_uq").on(t.businessId, t.workerId)]);

export const messages = pgTable("messages", {
  id: id(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("messages_conv_idx").on(t.conversationId, t.createdAt)]);

export const messageReports = pgTable("message_reports", {
  id: id(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  reporterId: uuid("reporter_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"), // open | actioned | dismissed
  resolutionNote: text("resolution_note"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("message_reports_uq").on(t.messageId, t.reporterId)]);

export const assignments = pgTable("assignments", {
  id: id(),
  applicationId: uuid("application_id").notNull().unique().references(() => applications.id),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  workerId: uuid("worker_id").notNull().references(() => users.id),
  status: assignmentStatus("status").notNull().default("confirmed"),
  payType: payType("pay_type").notNull(),
  agreedCents: integer("agreed_cents").notNull(), // agreed hourly rate / fee / shift pay (snapshot, in cents)
  currency: text("currency").notNull().default("CAD"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  cancelReason: text("cancel_reason"),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("assignments_worker_idx").on(t.workerId), index("assignments_business_idx").on(t.businessId)]);

export const assignmentSubmissions = pgTable("assignment_submissions", {
  id: id(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  hoursWorked: numeric("hours_worked", { precision: 6, scale: 2 }), // for hourly work
  link: text("link"),
  reviewerNote: text("reviewer_note"),
  outcome: text("outcome"), // approved | changes_requested | null (pending)
  createdAt: createdAt(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const assignmentHistory = pgTable("assignment_history", {
  id: id(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  fromStatus: assignmentStatus("from_status"),
  toStatus: assignmentStatus("to_status").notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  note: text("note"),
  createdAt: createdAt(),
});

export const reviews = pgTable("reviews", {
  id: id(),
  assignmentId: uuid("assignment_id").notNull().references(() => assignments.id, { onDelete: "cascade" }),
  reviewerId: uuid("reviewer_id").notNull().references(() => users.id),
  revieweeId: uuid("reviewee_id").notNull().references(() => users.id),
  rating: smallint("rating").notNull(),
  quality: smallint("quality"), communication: smallint("communication"), reliability: smallint("reliability"), professionalism: smallint("professionalism"),
  comment: text("comment"),
  hidden: boolean("hidden").notNull().default(false), // set by moderation; hidden reviews never count or display
  hiddenReason: text("hidden_reason"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("reviews_assignment_reviewer_uq").on(t.assignmentId, t.reviewerId)]);

// ---------- Phase 2 leftovers ----------
export const opportunityQuestions = pgTable("opportunity_questions", {
  id: id(),
  opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  required: boolean("required").notNull().default(true),
  sortOrder: smallint("sort_order").notNull().default(0),
});
export const applicationAnswers = pgTable("application_answers", {
  applicationId: uuid("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => opportunityQuestions.id, { onDelete: "cascade" }),
  answer: text("answer").notNull(),
}, (t) => [primaryKey({ columns: [t.applicationId, t.questionId] })]);

export const notificationPrefs = pgTable("notification_prefs", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  emailApplications: boolean("email_applications").notNull().default(true),
  emailMessages: boolean("email_messages").notNull().default(true),
  emailAssignments: boolean("email_assignments").notNull().default(true),
  emailInvitations: boolean("email_invitations").notNull().default(true),
  emailReviews: boolean("email_reviews").notNull().default(true),
  updatedAt: updatedAt(),
});

export const reviewReports = pgTable("review_reports", {
  id: id(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  reporterId: uuid("reporter_id").notNull().references(() => users.id),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  resolutionNote: text("resolution_note"),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("review_reports_uq").on(t.reviewId, t.reporterId)]);

export const files = pgTable("files", {
  id: id(),
  uploaderId: uuid("uploader_id").notNull().references(() => users.id),
  storageKey: text("storage_key").notNull().unique(),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  scanStatus: text("scan_status").notNull().default("unscanned"), // unscanned | clean | infected (no scanner integrated yet)
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
  submissionId: uuid("submission_id").references(() => assignmentSubmissions.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [index("files_message_idx").on(t.messageId), index("files_submission_idx").on(t.submissionId)]);
