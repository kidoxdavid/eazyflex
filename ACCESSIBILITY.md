# Accessibility
Target: WCAG 2.2 AA. **Status: automated checks pass; the product has NOT been audited by a person or with assistive technology, so conformance is not claimed.**

## What is verified automatically (and re-run in CI)
- `node tests/a11y/audit.mjs` — axe-core (rules tagged WCAG 2.0/2.1/2.2 A and AA) on **49 pages × 2 viewports (desktop 1280 px, mobile 390 px) = 98 page views**, using real signed-in sessions: public pages, worker portal (16), business portal (12), admin portal incl. MFA (9). Result of the last run: **0 violations**. Output: `docs/accessibility-audit.json`.
- `node tests/a11y/keyboard.mjs` — the skip link is the first Tab stop and moves focus to the content; sign-in completes with Tab/Enter only; every tab stop on `/worker`, `/worker/availability` and `/opportunities` has a visible focus outline (≥ 2 px).

## Issues the audit found and that were fixed
- Muted text colour (`--muted`) was 4.49:1 on the sage background (AA needs 4.5:1) → darkened to `#56605a` (≥ 5.2:1 on white, ivory and sage). Note this deliberately departs from the brief's `#78817B`, which fails contrast for body text.
- Scrollable regions (wide tables, the coverage chart, long checklists) were not keyboard-reachable → `tabindex=0`, `role="region"` and an accessible name.
- Chromium drops `:focus-visible` while tabbing between the segments of a time input → explicit `:focus-within` ring.
- `<main>` is focusable (`tabindex=-1`) so the skip link actually moves focus.

## Built in
Semantic landmarks, one `<h1>` per page, labelled form controls with `aria-live`/`role=alert` error messages, no colour-only meaning (status badges carry text; the coverage chart has a text table and labelled blocks), 44 px minimum touch targets on controls, `prefers-reduced-motion` support, responsive layouts with no horizontal page scroll at 390 px (checked in the browser journey).

## Not covered — needs a human
Screen-reader testing (NVDA/JAWS/VoiceOver), zoom/reflow at 400 %, forced-colours/high-contrast mode, cognitive-load and plain-language review, voice control, captions (no media exists yet), and assessment of the two things axe cannot judge: whether alt text/labels are *meaningful*, and whether focus order is *logical* on complex pages (coverage, availability). Treat the automated result as a floor.
