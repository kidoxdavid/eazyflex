-- Integrity constraints
ALTER TABLE opportunities ADD CONSTRAINT opp_pay_range_chk CHECK (pay_min_cents > 0 AND pay_max_cents >= pay_min_cents);
ALTER TABLE opportunities ADD CONSTRAINT opp_workers_chk CHECK (workers_needed BETWEEN 1 AND 100);
ALTER TABLE worker_availability ADD CONSTRAINT wa_range_chk CHECK (weekday BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
ALTER TABLE opportunity_schedules ADD CONSTRAINT os_range_chk CHECK (weekday BETWEEN 0 AND 6 AND start_minute >= 0 AND end_minute <= 1440 AND end_minute > start_minute);
ALTER TABLE worker_unavailability ADD CONSTRAINT wu_range_chk CHECK (end_date >= start_date);
ALTER TABLE users ADD CONSTRAINT users_admin_role_chk CHECK ((kind = 'admin') = (admin_role IS NOT NULL));
-- Only one active matching rule set
CREATE UNIQUE INDEX matching_rules_one_active ON matching_rules (active) WHERE active;
-- Audit log is append-only: ordinary application roles cannot alter history.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
