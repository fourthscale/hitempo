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
| 08 | ~~Email digest & background jobs~~ | — | ➡️ moved to V1 (Inngest infra ships with séquences multicanal) |
| 09 | CSV import & polish + responsive design | `09-csv-import-polish.md` | ✅ done |

Briefs are written one at a time, just before starting that sprint. Each brief incorporates lessons learned from previous sprints.

**MVP is code-complete as of sprint 09.** Deployed to Supabase Cloud + Vercel. The next steps are driven by L&G dogfood feedback. Some V1 features may get pulled in based on what sales actually needs after the first weeks of real use. The list below is the *planned* V1 set, not a contract.

Outstanding before closing MVP:
- Browser smoke test with L&G real CSV data (≥ 100 rows, all-in-one mode)
- Sentry integration (deferred — add when needed)

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

- **Inngest infrastructure + email digest** (was sprint 08, deferred — bundled with séquences below)
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
