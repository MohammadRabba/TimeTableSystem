# نظام الجدول المدرسي | School Timetable Management & Scheduling System

A production-grade school timetable management and automatic scheduling platform with a real constraint-optimization engine, Arabic-first RTL UI, full CRUD, version control, drag-and-drop editing, Excel export, reports, and audit logs.

## Demo Credentials

- **Super Admin:** `admin@school.tt` / `admin123`
- **School Admin:** `schooladmin@najah.tt` / `demo123`
- **Scheduler:** `scheduler@najah.tt` / `demo123`
- **Viewer:** `viewer@najah.tt` / `demo123`

## Demo Dataset (auto-seeded)

- School: مدرسة النجاح الثانوية (Al-Najah Secondary)
- 30 teachers (Arabic names)
- 15 classes across grades 10, 11, 12 (Scientific & Literary branches)
- 12 subjects (Arabic, English, Math, Physics, Chemistry, Biology, History, Geography, Islamic, CS, PE, Art)
- 18 rooms (10 classrooms, 3 labs, 2 computer labs, gym, art room, auditorium)
- 180 lessons × weekly occurrences = 540 weekly periods
- 60 duties (supervision/duty/reserve)
- Rotating day-off per teacher

## Architecture

```
Next.js 16 (App Router, TypeScript)
   ├── shadcn/ui + Tailwind CSS 4 (RTL Arabic-first)
   ├── TanStack Query (server state)
   ├── Zustand (client state, undo/redo, navigation)
   ├── dnd-kit (drag-and-drop timetable)
   └── ExcelJS (Excel export)

Next.js API Routes (server-side)
   ├── /api/auth/*          (JWT session login, logout, session)
   ├── /api/schools         (multi-tenant school CRUD)
   ├── /api/grades, /api/branches, /api/sections
   ├── /api/subjects, /api/teachers, /api/rooms
   ├── /api/lessons, /api/duties, /api/constraints
   ├── /api/teacher-subjects, /api/teacher-availability
   ├── /api/scheduling/validate, /api/scheduling/generate
   ├── /api/timetable/versions, /entries, /move, /swap, /lock, /undo, /redo
   ├── /api/reports/{workload, conflicts, free-periods, duties, rooms, seventh, quality}
   ├── /api/excel/export
   ├── /api/dashboard
   └── /api/audit

Prisma ORM → SQLite (file-based, easy dev)
   - 22 normalized models with FK + soft-delete + audit + version snapshots

Scheduling Engine (src/lib/scheduling/engine.ts)
   ├── Pre-Solver Validation   (detects impossible workloads, capacity, room-type, fixed conflicts)
   ├── Hard Constraints         (teacher/class/room conflicts, availability, day-off, weekly count, room compatibility, capacity, duty conflicts, fixed lessons)
   ├── Soft Constraints          (balanced subjects, workload balance, 7th-period equalization, min teacher gaps, no same-subject same day, preferred periods, spread lessons, max daily)
   ├── Backtracking Solver       (deterministic, best-fit placement with look-ahead)
   ├── Local Optimization        (penalty-minimizing swaps)
   ├── Quality Scoring           (0-100, weighted penalties)
   ├── Explainable Failures     (scope + reason + suggestion)
   ├── Conflict Detection        (critical/warning/optimization severity)
   └── Smart Swap Suggestions
```

## Scheduling Model

Each lesson is represented as N occurrences to place in the week's grid (days × periods). Each occurrence is a decision variable:

```
X(lesson, day, period, room) ∈ {0, 1}
```

Constraints ensure no two occurrences share the same (day, period, teacher), (day, period, class), or (day, period, room). Soft penalties are weighted and minimized.

## Features

- Arabic RTL primary + English LTR toggle (Zustand-persisted)
- Multi-tenant schools with role-based access (SuperAdmin/SchoolAdmin/Scheduler/Teacher/Viewer)
- Real authentication (JWT cookies, hashed passwords)
- Real database (Prisma + SQLite, 22 normalized models)
- Real CRUD for every entity
- Real constraint-optimization solver (deterministic backtracking + local optimization, NOT random)
- Real pre-solver validation with actionable failure explanations
- Real version control (each generation creates a snapshot, restore/compare/duplicate supported)
- Real undo/redo via TimetableChange event log
- Real drag-and-drop with hard-constraint validation (rejects conflicts)
- Real locking (per-entry, locks survive re-generation)
- Real Excel export (one workbook with multiple sheets — overview, per-teacher, per-class, per-room, workload, duties, free periods, conflicts — RTL formatted, header/footer with school name)
- Real reports (workload, free periods, duties, conflicts, room utilization, seventh balance, quality metrics)
- Real audit log (every mutation recorded with user, action, entity, old/new value, timestamp)
- Real dashboard stats (computed from database, not hardcoded)
- Keyboard shortcuts (Ctrl+Z/Y, F for search, Esc to cancel drag)
- Mobile-responsive (sidebar collapses, touch targets >= 44px)

## Workflow

1. Login → School auto-selected
2. Dashboard shows real stats
3. Configure: Academic Structure → Subjects → Teachers → Rooms → Lessons → Duties → Constraints
4. Generate Timetable → pre-validate → solve → save snapshot → view results
5. View Timetable (School / Teacher / Class / Room / Subject views) → drag-and-drop → lock → undo/redo
6. Conflict Center → see critical issues, jump to location
7. Reports → workload, free periods, duties, room utilization, seventh balance, quality
8. Excel Export → multi-sheet .xlsx with Arabic RTL formatting
9. Audit Log → every change tracked

## Project Structure

```
src/
├── app/
│   ├── api/                      # 35+ API routes
│   ├── layout.tsx               # RTL Arabic-first root layout
│   └── page.tsx                 # SPA shell (single route, internal pane routing)
├── components/
│   ├── app-shell.tsx            # Header + sidebar + i18n + auth + keyboard shortcuts
│   ├── providers.tsx            # TanStack Query provider
│   ├── ui/                      # shadcn/ui components
│   └── panes/                   # 16 feature panes
│       ├── dashboard-pane.tsx
│       ├── school-pane.tsx
│       ├── academic-pane.tsx
│       ├── subjects-pane.tsx
│       ├── teachers-pane.tsx (incl. availability dialog)
│       ├── rooms-pane.tsx
│       ├── lessons-pane.tsx
│       ├── duties-pane.tsx
│       ├── constraints-pane.tsx
│       ├── schedule-pane.tsx    (generation + validation + progress)
│       ├── timetable-pane.tsx   (5 views + dnd-kit drag-drop)
│       ├── conflicts-pane.tsx
│       ├── reports-pane.tsx     (6 report tabs)
│       ├── excel-pane.tsx       (9 export scopes)
│       ├── audit-pane.tsx
│       └── settings-pane.tsx
├── lib/
│   ├── i18n.ts                  # Arabic + English dictionary
│   ├── store.ts                 # Zustand stores (lang, app, undo/redo)
│   ├── auth.ts                  # JWT sessions + audit log helper
│   ├── db.ts                    # Prisma client
│   └── scheduling/
│       └── engine.ts            # The constraint engine
prisma/
└── schema.prisma                # 22 normalized models
scripts/
├── seed.ts                      # Realistic demo dataset (1 school, 30 teachers, 180 lessons, 60 duties)
└── check-db.ts                  # Debug query helper
```

## Tech Stack

- Next.js 16 (App Router)
- TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- Prisma ORM (SQLite)
- TanStack Query v5
- Zustand v5
- React Hook Form + Zod
- @dnd-kit/core
- Recharts
- ExcelJS
- JWT (jsonwebtoken)

## Local Development

```bash
bun install
bun run db:push         # create SQLite schema
bun run scripts/seed.ts # seed demo data
bun run dev             # http://localhost:3000
```

## License

MIT — for educational and production use.
