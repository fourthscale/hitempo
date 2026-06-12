# Feature roadmap — hitempo MVP

Features are implemented in order. Each one builds on the previous. The number in the filename is the sprint number, not necessarily the order of priority.

## Sprint timeline (6 weeks MVP)

| Sprint | Name | Brief | Status |
|--------|------|-------|--------|
| 01 | Foundations | `01-foundations.md` | ✅ done (cloud deploy pending: Supabase Cloud + Vercel + Sentry) |
| 02 | Auth & dashboard skeleton | `02-auth-dashboard.md` | ✅ done (browser smoke test pending) |
| 02.5 | UI shell (design tokens + sidebar + topbar + dashboard mockup parity) | `02.5-ui-shell.md` | ✅ done (browser visual check pending) |
| 03 | Multi-tenancy & RLS | `03-multi-tenancy.md` | ✅ done (browser pill check pending) |
| 03.5 | Org context & platform-admin impersonation | `03.5-org-context.md` | ✅ done (browser smoke test pending) |
| 04 | Companies, sites, contacts (CRUD) | `04-companies-sites-contacts.md` | ✅ done (browser smoke test pending) |
| 05 | Interactions & tasks | `05-interactions-tasks.md` | ✅ done |
| 06 | Scoring & operational views | `06-scoring-views.md` | ✅ done |
| 07 | AI message generation | `07-ai-message-generation.md` | ✅ done |
| 08 | ~~Email digest & background jobs~~ | — | ➡️ Inngest infra rolled into sprint 10 (reply polling), morning digest deferred to V1 |
| 09 | CSV import & polish + responsive design | `09-csv-import-polish.md` | ✅ done |
| 10 | Gmail integration (send + reply tracking) | `10-gmail-integration.md` | ✅ done |
| 10.5 | Gmail outbound attachments (PDF) | `10.5-gmail-attachments.md` | ⏳ code complete, migration pending |
| 10.8 | Generic contacts (`info@…` without faking a name) | `10.8-generic-contacts.md` | ✅ done (migration applied cloud + local) |
| 11 | Sequences — Phase A: task-mode engine | `11-sequences-phase-a.md` | ✅ done (local; cloud migration `20260529121500_sequences_soft_step_refs` push pending) |
| 13 | Sequence versioning & in-flight enrolment isolation | `13-sequence-versioning.md` | 📝 brief drafted (not urgent — fallback by step_order mitigates the worst symptoms today) |
| 14 | Agent auto-execution resilience (idempotence + retry + scavenger) | `14-agent-execution-resilience.md` | 📝 brief drafted (urgent once dogfood scales — transient DB pool failures silently drop tasks today) |
| 15 | Sequence email threading (reply in previous Gmail thread) | `15-sequences-email-threading.md` | 📝 brief drafted (high impact — reply rates drop 2-3x without it ; standard across all cold-outreach tools) |

Briefs are written one at a time, just before starting that sprint. Each brief incorporates lessons learned from previous sprints.

**MVP core was code-complete as of sprint 09** (companies, contacts, tasks, AI generation, CSV import). Deployed to Supabase Cloud + Vercel. **Sprint 10 (Gmail) pulled forward from V1** based on dogfood reality : without sending + reply tracking, the AI generation feature isn't actually used in the field. The remaining V1 list below stays driven by L&G feedback — not a contract.

Outstanding before closing MVP:
- Browser smoke test with L&G real CSV data (≥ 100 rows, all-in-one mode)
- Sentry integration (deferred — add when needed)
- **Switch Gmail OAuth app to Workspace `Internal` user type** so refresh tokens stop expiring every 7 days during L&G dogfood. External + OAuth Verification (CASA audit, 3-month wall-clock) is required before the second customer if they're outside L&G's workspace domain. Details in `10-gmail-integration.md` → "OAuth verification + token lifecycle".

## How to use these briefs

1. Read the brief end-to-end before starting.
2. Check the `## Prerequisites` section to ensure previous features are complete.
3. Reference `docs/architecture.md` and `docs/data-model.md` as needed.
4. Implement following the `## Implementation plan` section.
5. Validate against `## Acceptance criteria`.
6. Update the brief's `## Implementation notes` at the end with anything notable (gotchas, deviations, follow-ups).
7. Open a PR linking to the brief.

## Definition of Done (every feature)

- [ ] All acceptance criteria met
- [ ] Multi-tenant safety verified (queries filter by `organization_id`, RLS policies active where needed)
- [ ] i18n: no hardcoded strings in UI components
- [ ] Zod validation on all server action inputs
- [ ] TypeScript strict, no `any`
- [ ] Tests for business logic (scoring, AI prompt builders, etc.) — UI tests can be visual
- [ ] Manual QA on dev branch
- [ ] PR description links to the feature brief
- [ ] `Implementation notes` section filled at the bottom of the brief

## V1 features (planned, subject to dogfood feedback)

- **Morning email digest** (Inngest infra ships with sprint 10 ; the digest job itself stays V1)
- Sourcing IA automatique par micro-zone
- Enrichissement Dropcontact API
- Séquences multicanal branchées (moteur d'exécution Inngest)
- Bibliothèque 12 messages cœur (templates pré-construits)
- Google Calendar API
- Dashboard hebdo (reporting)
- Permissions par rôle (admin / commercial / viewer)

## V2 features (out of V1 scope)

- App mobile native iOS/Android
- Twilio SMS + Aircall téléphonie
- Builder visuel séquences React Flow
- Dashboards prédictifs
- Stripe billing en production
- Marketing site hitempo.io
- Internationalisation Europe (DE, IT, ES)
