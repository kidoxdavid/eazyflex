# Marketplace workflows (as implemented)
**Posting:** choose engagement type → details. Rules: numeric pay required; max ≥ min; pay basis must fit engagement (e.g. fixed project ⇒ fixed fee); fixed fee needs ≥20-char deliverables; local/hybrid needs an area; recurring needs hours/week + schedule; shifts need schedule; deadline ≤ start date; mandatory skills ⊂ requested skills. Status: draft → published, or → `pending_review` if the category `requires_approval` or setting `moderation.all_postings` is true. A failed publish keeps the user's entries as a draft and shows the error.
**Application statuses:** submitted → under_review → shortlisted → interview_requested → offer_received → accepted (worker) · declined (business, or worker on an offer) · withdrawn (worker). Terminal states can't change. Every change writes history + audit; notifications are written to `notifications`. Accepting locks the opportunity row; when accepted count ≥ `workers_needed` the opportunity becomes `filled`, and further acceptances fail.
**Eligibility to apply:** verified email, published & open opportunity, active business, deadline not passed. Applying is *not* blocked by match score; the score is a stored informational snapshot.

**Matching** (`src/server/matching/score.ts`)
- *Mandatory* (configurable set, default all on): required skills; availability for the requested weekly windows (coverage > 0 and not unavailable for the whole date range); travel radius for local work; worker's explicit hard-minimum hourly rate. Failing any ⇒ ineligible, never traded off.
- *Weighted* (default weights 30/25/12/8/10/6/4/5 for skills/availability/location/arrangement/compensation/experience/duration/preferences), only over criteria that can be assessed. Unknown data is excluded and reported as such.
- *Confidence:* raw score is scaled 60–100% by the share of weight assessable, so sparse data can't yield 100/100. `coverage` is returned and shown.
- *Tiers:* strong (≥ strong threshold, no gaps, coverage ≥ 50%), good, partial, not_recommended (< recommend threshold or ineligible).
- *Explanations* are built only from recorded reasons. Inputs exclude age, gender, parental status and any protected characteristic.
- Rules are versioned (`matching_rules`); admin changes publish a new immutable version.
- Availability is evaluated per weekday in minutes. It does **not** yet check conflicts with other bookings (no assignments exist) or time-zone conversion beyond a stored zone.

**Not implemented:** assignments, work-sharing/coverage, services marketplace, recurring management, handovers, disputes.
