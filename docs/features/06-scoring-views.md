# Sprint 06 — Scoring & operational views

## Goal

Give sales reps a clear, data-driven prioritization of their prospect list.  
Two deliverables:
1. **Automatic score** — compute and store a 0-100 score for every company based on observable signals.
2. **Operational views** — surface that score where it matters: company detail breakdown, a prioritized prospect list, and a refreshed dashboard "hot targets".

Customer context: Léon & George reps prospect hotels, agencies, and offices in Paris micro-zones. The score must reflect "how hot is this lead right now" — a combination of standing (quality of the venue), signal (renovation, opening, etc.), engagement (interactions logged), and open tasks.

---

## Prerequisites

- Sprint 05 done ✅ — interactions and tasks in place (scoring inputs exist in DB)
- `companies.score` and `companies.score_breakdown` columns exist (nullable, currently hand-seeded)
- `lib/scoring/grade.ts` exists with `scoreGrade()` and `scoreBadgeClasses()`

---

## Scoring formula

### Inputs (all available today)

| Signal | Source | Max pts |
|--------|--------|---------|
| Standing (venue quality) | `companies.standing` (1-5) | 25 |
| Signal présent (rénov, ouverture…) | `companies.signal_type IS NOT NULL` | 20 |
| Signal récent (< 30 j) | `companies.signal_detected_at` | +10 bonus |
| Interactions loguées | `count(interactions WHERE company_id)` | 20 |
| Interaction récente (< 14 j) | last `occurred_at` | +10 bonus |
| Tâche active ouverte | `count(tasks WHERE company_id, status IN (pending,in_progress))` | 10 |
| Contact prioritaire défini | `companies.primary_contact_id IS NOT NULL` | 5 |

**Total max : 100 pts**

### Formula detail

```
standing_pts   = (standing / 5) * 25          // 0-25
signal_pts     = signal_type IS NOT NULL ? 20 : 0
signal_bonus   = signal_detected_at > now-30d ? 10 : 0
interaction_base = min(interactions_count, 4) * 5   // 0-20
interaction_bonus = last_interaction < 14d ? 10 : 0
task_pts       = has_open_task ? 10 : 0
contact_pts    = primary_contact_id IS NOT NULL ? 5 : 0

score = clamp(standing_pts + signal_pts + signal_bonus
            + interaction_base + interaction_bonus
            + task_pts + contact_pts, 0, 100)
```

### Score breakdown shape (`score_breakdown` JSONB)

```ts
type ScoreBreakdown = {
  standing:    { pts: number; max: 25; standing: number | null };
  signal:      { pts: number; max: 30; type: string | null; detectedAt: string | null };
  engagement:  { pts: number; max: 30; count: number; lastAt: string | null };
  tasks:       { pts: number; max: 10; open: number };
  contact:     { pts: number; max: 5;  hasPrimary: boolean };
  total:       number;
  computedAt:  string; // ISO
};
```

---

## Implementation plan

### 1. Pure scoring function (`lib/scoring/compute.ts`)

- `computeCompanyScore(inputs: ScoringInputs): ScoreBreakdown`
- Pure function, no DB calls — easy to unit test
- `ScoringInputs` = all the fields needed (standing, signalType, signalDetectedAt, interactionCount, lastInteractionAt, openTaskCount, hasPrimaryContact)

### 2. DB query to fetch scoring inputs (`db/queries/scoring.ts`)

- `getScoringInputsByOrg(orgId): ScoringInputs[]` — one row per company, JOINs interactions + tasks counts
- `getScoringInputsByCompany(orgId, companyId): ScoringInputs` — for single company update

### 3. Server action to recompute score (`lib/actions/scoring.ts`)

- `recomputeScoreAction(formData)` — triggered manually from company detail
- `recomputeAllScoresAction()` — admin utility (recomputes whole org)
- Both write `score` + `score_breakdown` back to `companies`

### 4. Auto-recompute triggers

Recompute the score for the relevant company when:
- An interaction is logged (`logInteractionAction`)
- A task is created/completed/deleted (`createTaskAction`, `updateTaskStatusAction`, `deleteTaskAction`)
- A company is edited (standing, signal fields changed) (`updateCompanyAction`)

Implementation: call `recomputeCompanyScore(orgId, companyId)` at the end of each action (fire-and-forget, non-blocking). Extract as a shared helper in `lib/scoring/recompute.ts`.

### 5. Score breakdown card in company detail

Replace the current placeholder in `CompanyScoreBreakdownCard` with:
- A progress bar or segmented bar showing total score
- A breakdown table: each component, points earned, max possible
- "Recalculer" button (calls `recomputeScoreAction`)
- `computedAt` timestamp

### 6. Prioritized prospect list (`/prospects` or enhanced `/companies`)

A new view (or tab on `/companies`) showing:
- Companies sorted by score desc, filterable by micro-zone, signal, status
- Score badge, signal badge, last interaction date, primary contact
- Quick actions: log interaction, new task (inline, no page nav)

### 7. Dashboard "Hot targets" — real data

Replace the current `topCompanies.sort by score` with a proper query that also considers signal recency. Currently shows top 4 — keep that but ensure the sort is `score DESC, signal_detected_at DESC NULLS LAST`.

---

## Files to create / modify

| File | Action |
|------|--------|
| `lib/scoring/compute.ts` | NEW — pure scoring function |
| `lib/scoring/recompute.ts` | NEW — DB helper to recompute + persist |
| `db/queries/scoring.ts` | NEW — scoring inputs query |
| `lib/actions/scoring.ts` | NEW — manual recompute actions |
| `lib/actions/interactions.ts` | MODIFY — trigger recompute after log |
| `lib/actions/tasks.ts` | MODIFY — trigger recompute after create/update/delete |
| `lib/actions/companies.ts` | MODIFY — trigger recompute after update |
| `app/(app)/companies/[id]/page.tsx` | MODIFY — real ScoreBreakdownCard |
| `app/(app)/companies/page.tsx` | MODIFY — sort by score, signal badge |
| `app/(app)/dashboard/page.tsx` | MODIFY — hot targets real sort |
| `lib/scoring/grade.ts` | MODIFY — adjust thresholds if needed after formula |

---

## Acceptance criteria

- [x] `computeCompanyScore()` is a pure function with unit tests covering edge cases (no standing, no signal, no interactions)
- [x] Score is recomputed automatically when an interaction is logged or task changes status
- [x] Company detail shows real score breakdown (points per component, not placeholder)
- [x] "Recalculer" button works and updates the display
- [x] `/companies` list sorts by score descending by default
- [x] Dashboard "Hot targets" reflects real score + signal recency sort
- [x] Signal badge visible in company list (type + age indicator)
- [x] No hardcoded strings — all labels through i18n
- [x] Multi-tenant safe — all scoring queries filter by `organization_id`
- [x] `npm run lint`, `npm run build`, `npm run test` all clean

---

## Implementation notes

### Architecture

- **Pure function**: `lib/scoring/compute.ts` exports `computeCompanyScore(inputs, now?)` — takes a plain `ScoringInputs` object, returns `ScoreBreakdown`. No DB calls, no side effects. 13 unit tests in `tests/scoring/compute.test.ts`.

- **Fire-and-forget recompute**: `lib/scoring/recompute.ts` exports `recomputeCompanyScore(orgId, companyId)`. All callers use `void recomputeCompanyScore(...)` to not block the server action response. The function writes `score` + `score_breakdown` back to `companies`.

- **Auto-triggers wired to**: `logInteractionAction`, `createTaskAction`, `updateTaskAction`, `updateTaskStatusAction` (uses `.returning()` to recover `companyId` post-update), `deleteTaskAction` (pre-fetch `companyId` before delete), `updateCompanyAction`, `setPrimaryContactAction`.

### Deviations from the brief

- **`recomputeAllScoresAction`**: not implemented — no UI surface for it yet. Can be added when a batch-recompute admin tool is needed (V1+).

- **`getScoringInputsByOrg`** (all companies at once): not implemented — only single-company variant shipped. Batch recompute can be added for the Inngest morning-digest job in sprint 08.

- **Sort in DB**: `orderBy` uses `sql\`${companies.signalDetectedAt} DESC NULLS LAST\`` because Drizzle's `desc()` helper doesn't support `NULLS LAST` natively. Both `listCompaniesByOrg` and `listCompaniesByOrgEnriched` use this.

- **Signal badge**: rendered inline with an IIFE in the companies list JSX — `isFresh = daysSince <= 30` drives amber vs. slate coloring. Age shown as `{n}d` below the pill.

- **Score breakdown card**: `ScoreBreakdownRows` is defined as a plain function in the company detail page file (not a separate component file) — it's display-only with no interactivity, so a top-level component file felt like over-engineering for 40 lines.

### Grade thresholds

`lib/scoring/grade.ts` thresholds kept as-is (A ≥ 80, B ≥ 70, C ≥ 60, D below). With the new formula (max 100), a company with standing 5 + active signal + 4+ interactions + open task + primary contact scores 100 (A). A fresh lead with no interactions but a recent signal scores ~30 (D) — which is correct; the grade pushes reps to engage.
