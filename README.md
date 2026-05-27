# hitempo — Development handoff package

This folder contains everything Claude Code needs to start building hitempo. Copy these files into the freshly initialized `hitempo` repo as-is.

## Files

```
hitempo-dev-handoff/
├── CLAUDE.md                              ← goes at repo root, Claude Code reads it automatically
├── README.md                              ← this file (optional, you can keep or delete)
└── docs/
    ├── architecture.md                    ← full architecture (multi-tenancy, auth, AI, jobs, conventions)
    ├── data-model.md                      ← complete Drizzle schema spec (all tables, RLS, indexes)
    └── features/
        ├── README.md                      ← roadmap with all 9 sprints
        └── 01-foundations.md              ← first sprint: Next.js + Supabase + Drizzle + Vercel
```

## How to use this with Claude Code

### 1. Init the new repo

```bash
mkdir hitempo && cd hitempo
git init
```

### 2. Copy the handoff files

Copy the contents of this folder into the repo root:

```
hitempo/
├── CLAUDE.md
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   └── features/
│       ├── README.md
│       └── 01-foundations.md
```

### 3. Open Claude Code

In the `hitempo` folder:

```bash
claude code
```

When Claude Code starts, it will automatically read `CLAUDE.md` and have full context on the project. You can then say:

> "Let's implement sprint 01 — foundations. Follow `docs/features/01-foundations.md`."

Claude Code will execute the sprint plan step by step. Validate at each step before moving on.

### 4. After completing each sprint

- Update the `## Implementation notes` section at the bottom of the brief with anything notable
- Mark the sprint as ✅ done in `docs/features/README.md`
- Ask me (Ludovic) to write the next sprint's brief
- I'll write `02-auth-dashboard.md` and you'll start the next iteration

### 5. Subsequent sprints

The roadmap covers 9 sprints (MVP in 6 weeks). I'll write each brief just before you start it, incorporating lessons from previous sprints.

## Conventions

- **All branding lowercase**: hitempo (never HiTempo)
- **All docs in English** for Claude Code; conversations with Ludovic in French
- **Code conventions**: see `CLAUDE.md`
- **Definition of Done**: see `docs/features/README.md`

## What's NOT in this handoff

The handoff intentionally excludes:

- `.env.local` (you'll create from `.env.example` after Sprint 01)
- Any actual code — Claude Code generates everything
- Mockups, deck, plan PDF (those are reference docs that live alongside the project; see `../HiTempo-Mockups.html`, `Plan-CRM-LG.pdf`, etc.)
- Brand identity assets (logo, fonts) — to add during a "polish" sprint

## Where to find broader context

- **Plan produit complet (20 pages)** : `../Plan-CRM-LG.pdf` (or `.md`)
- **Mockups visuels des 11 écrans** : `../HiTempo-Mockups.html` (also live at https://hitempo.s3.us-east-1.amazonaws.com/mockups/HiTempo-Mockups.html)
- **Deck stratégique** : `../HiTempo-Presentation.pptx`
- **Brief concurrence** : `../Brief-Concurrence-hitempo.pdf`

Claude Code doesn't need these directly — the handoff is self-sufficient — but they're useful if you want to discuss strategy or show stakeholders.
