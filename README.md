# 🏫 School Timetable Management & Scheduling System

An integrated system for automatically generating and managing school timetables using **Google OR-Tools CP-SAT**. Features full Arabic (RTL) and English (LTR) support, automated conflict detection and resolution, drag-and-drop editing, comprehensive reporting, Excel export, and timetable version management.

<p align="center"> <strong>Automatically generate school timetables, edit them with ease, and let the system handle conflict resolution.</strong> </p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/Python-3.10%2B-blue" alt="Python" />
  <img src="https://img.shields.io/badge/OR--Tools-CP--SAT-orange" alt="OR-Tools" />
</p>

---

## ✨ Key Features

* 🤖 **Automated Scheduling:** Schedule generation powered by Google OR-Tools CP-SAT solver.
* 🚫 **Conflict Prevention:** Hard constraint validation for teachers, classes, and rooms.
* 🔧 **Auto-Repair:** Automatic conflict resolution when manually tweaking schedule entries.
* 🖱️ **Drag-and-Drop:** Intuitive drag-and-drop timetable modification interface.
* 👀 **Change Preview:** Preview schedule impacts and conflict resolution steps before applying.
* 🔒 **Lesson Pinning:** Lock specific lessons to prevent them from moving during solver re-runs.
* ↩️ **Undo / Redo:** Full history tracking to easily revert changes.
* 🗂️ **Version Control:** Save, clone, compare, and restore multiple timetable snapshots.
* 📊 **Comprehensive Reports:** Detailed analytics on teacher workloads, room usage, free periods, and timetable quality.
* 📥 **Excel Export:** Multi-tab Excel reports supporting both Arabic (RTL) and English layouts.
* 📝 **Audit Trail:** Complete activity logging for all schedule modifications.
* 🌐 **Bilingual Support:** Full Arabic RTL and English LTR internationalization.
* 👥 **Role-Based Access:** Multi-tier permission model (Super Admin, School Admin, Scheduler, Teacher, Viewer).
* 📱 **Responsive UI:** Modern, mobile- and tablet-friendly design built with Tailwind CSS and shadcn/ui.

---

## 🚀 Quick Start

Follow these steps to quickly spin up the development environment.

### Prerequisites

Ensure you have the following installed on your machine:
* **Node.js:** 18+
* **Bun:** Latest package manager/runtime
* **Python:** 3.10+
* **pip:** Python package manager

### 1. Clone the Repository
```bash
git clone <YOUR_REPOSITORY_URL>
cd timetable-system
```
*Or extract your project ZIP file:*
```bash
unzip timetable-system.zip
cd timetable-system
```

### 2. Environment Configuration
```bash
cp .env.example .env
```
Default `.env` values:
```env
DATABASE_URL=file:./db/custom.db
SCHEDULER_URL=http://127.0.0.1:3040
SCHEDULER_PROVIDER=ortools
JWT_SECRET=change-this-to-a-long-random-string
```
> ⚠️ **Security Note:** Make sure to replace `JWT_SECRET` with a secure random string in production environments.

### 3. Install Dependencies
Install Node.js packages:
```bash
bun install
```
Install Python scheduler dependencies:
```bash
pip3 install -r mini-services/scheduler/requirements.txt
```

### 4. Setup Database
```bash
bunx prisma db push --accept-data-loss
bunx prisma generate
```

### 5. Seed Demo Data
```bash
bun run scripts/seed.ts
```
This generates a complete demo dataset containing:
* 30 Teachers
* 15 Class Sections
* 12 Subjects
* 23 Rooms
* 180 Lessons
* 540 Weekly Periods
* 60 Supervision Duties

### 6. Start the Python Scheduler Microservice
Open a new terminal window:
```bash
cd mini-services/scheduler
./start.sh
```
Verify the microservice health status:
```bash
curl http://127.0.0.1:3040/health
```
Expected output:
```json
{
  "ok": true,
  "service": "scheduler",
  "engine": "ortools-cp-sat"
}
```

### 7. Run the Web Application
In your original terminal window:
```bash
bun run dev
```
Open your browser and navigate to: [http://localhost:3000](http://localhost:3000)

---

## 🔐 Demo Credentials

| Role | Email | Password |
| :--- | :--- | :--- |
| 👑 **Super Admin** | `admin@school.tt` | `admin123` |
| 🏫 **School Admin** | `schooladmin@najah.tt` | `demo123` |
| 📅 **Scheduler** | `scheduler@najah.tt` | `demo123` |
| 👁️ **Viewer** | `viewer@najah.tt` | `demo123` |

> ⚠️ *These default credentials are for testing only. Update passwords prior to production deployment.*

---

## 📚 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [How Scheduling Works](#-how-scheduling-works)
  - [Constraint Enforcement](#hard-constraints)
  - [Optimization Objectives](#soft-constraints-optimization)
  - [Auto-Repair Engine](#-auto-repair)
- [School Management Modules](#-school-management)
- [Reports & Analytics](#-reports)
- [Excel Export](#-excel-export)
- [Version Management & Undo/Redo](#-version-management)
- [Tech Stack](#-tech-stack)
- [API Reference](#-api-reference)
- [Testing & Verification](#-testing)
- [Project Structure](#-project-structure)
- [Troubleshooting](#-troubleshooting)
- [License & Acknowledgments](#-license)

---

## 📖 Overview

This platform simplifies school schedule creation by converting complex logistical requirements into mathematical optimization models solved via Constraint Programming (CP-SAT).

### High-Level Workflow

```
       School Data Entry & Setup
                   │
                   ▼
       Data Validation & Checks
                   │
                   ▼
     OR-Tools CP-SAT Solving Engine
                   │
                   ▼
        Initial Schedule Output
                   │
                   ▼
     Independent Validator Verification
                   │
                   ▼
       Save Version / Snapshot
                   │
                   ▼
     Interactive Dashboard & Drag-and-Drop
```

---

## 🤖 How Scheduling Works

### Hard Constraints
The solver guarantees strict compliance with hard requirements:
1. **Teacher Overlaps:** A teacher cannot teach two classes during the same period.
2. **Section Overlaps:** A class section cannot attend two lessons simultaneously.
3. **Room Overlaps:** A room cannot host multiple lessons simultaneously.
4. **Teacher Availability:** Lessons are scheduled only during teacher working hours.
5. **Teacher Time Off:** Respects designated leave days/off periods.
6. **Duty Alignment:** Teachers on supervision duties cannot be scheduled for lessons.
7. **Pinned Lessons:** Locked allocations remain unchanged during solver runs.
8. **Room Suitability & Capacity:** Lessons are matched to compatible, properly sized rooms.
9. **Full Coverage:** Every required lesson period must be assigned.

### Soft Constraints (Optimization)
After satisfying hard rules, the solver optimizes for quality parameters:
* Minimizing teacher idle gap periods (free windows during the day).
* Balanced daily workload distribution across the week.
* Minimizing subject repetition on the same day for a single class.
* Honoring teacher period preferences.
* Balanced assignment of late (7th) periods.
* Minimizing cascade impacts during local auto-repairs.

---

## 🖱️ Interactive Editing & Auto-Repair

### Drag & Drop Modifications
Users can manually shift lessons on the grid view:

```
Mathematics
Sunday - Period 2
       │
       │ Drag & Drop
       ▼
Sunday - Period 3
```

- **If target slot is free:** ✅ Move is committed instantly.
- **If target slot is occupied:** ⚠️ A conflict occurs, triggering the **Auto-Repair Engine**.

### 🔧 Auto-Repair Workflow
When a conflict occurs, the local repair solver finds an optimal minimal-displacement solution:

*Example Scenario:*
- **User Request:** Move Math to `Sunday - Period 3`.
- **Conflict:** Science is currently occupying `Sunday - Period 3`.
- **Proposed Solution:** Move Math to `Sunday 3`, and relocate Science to `Sunday - Period 4`.

Prior to applying the change, a **Diff Modal** displays the exact chain of adjustments:

| Lesson | Original Slot | Proposed Slot | Reason |
| :--- | :--- | :--- | :--- |
| **Mathematics** | Sunday - Period 2 | Sunday - Period 3 | User Action |
| **Science** | Sunday - Period 3 | Sunday - Period 4 | Conflict Auto-Fix |

> **Note:** Auto-repair proposals are never applied automatically; explicit user approval is required.

---

## 🔒 Lesson Locking (Pinning)

Any key lesson slot can be locked. Locked lessons:
* Are frozen during full solver runs.
* Are excluded from auto-repair relocation logic.
* Remain locked until explicitly unpinned by an authorized user.

---

## 🏫 School Management

The platform provides administrative interfaces to manage structural entities:

* **Academic Structure:** Educational stages, grades, streams/branches, and class sections.
* **Subjects:** Course definitions, weekly period requirements, and room prerequisites.
* **Teachers:** Profiles, assigned subjects, shift availability, off-days, and load limits.
* **Rooms & Facilities:** Name, facility type, capacity, and subject compatibility.
* **Lessons:** Subject, teacher, class section, weekly frequency, and static slot locks.
* **Duties:** Duty types (recess, gate supervision), assigned staff, day, and time slots.

---

## 📊 Dashboard & Analytics

The real-time dashboard provides an overview of database metrics:

```
┌────────────────┬────────────────┐
│ 👨‍🏫 Teachers   │ 30             │
├────────────────┼────────────────┤
│ 🏫 Sections    │ 15             │
├────────────────┼────────────────┤
│ 📚 Subjects    │ 12             │
├────────────────┼────────────────┤
│ 🚪 Rooms       │ 23             │
├────────────────┼────────────────┤
│ 📅 Lessons     │ 180            │
├────────────────┼────────────────┤
│ 🔢 Weekly Slots│ 540            │
└────────────────┴────────────────┘
```

### 🚨 Conflict Center
Centralized dashboard reporting real-time conflicts and data inconsistencies, detailing:
* Conflict type (Hard / Soft violation).
* Affected lesson, teacher, class, and room.
* Grid coordinate of the violation.

### 📈 Reports
* **Teacher Workload & Free Periods:** Analysis of teaching hours and gaps.
* **Room Utilization:** Capacity usage and idle times per facility.
* **Duty Allocations:** Staff distribution during breaks and non-teaching times.
* **Seventh Period Tracking:** Monitoring late period allocations across sections.
* **Timetable Score Card:** Numerical rating of schedule quality based on soft rules.

---

## 📥 Excel Export

Schedules export to multi-sheet `.xlsx` files generated via `ExcelJS`:
* **Worksheets:** `Overview`, `Teachers`, `Classes`, `Rooms`, `Workload`, `Duties`, `Free Periods`, `Conflicts`.
* **RTL & Bilingual Support:** Automatically formats text direction and alignment according to the active locale.

---

## 🗂️ Version Management & History

Every timetable generation run creates a distinct version tree:

```
Version 1
    │
    ├── Version 2
    │        │
    │        └── Version 3
    │
    └── Version 4 ← (Active)
```

* **Snapshot Capabilities:** Create copies, compare differences across versions, and roll back to previous states.
* **Undo / Redo System:** Keyboard shortcuts (`Ctrl+Z` / `Ctrl+Y`) with action history tracking stored in state via Zustand.

---

## 👥 Roles & Permissions

| Role | Operational Scope |
| :--- | :--- |
| **Super Admin** | System configuration, multi-tenant management, global access. |
| **School Admin** | School entity settings, staff accounts, data configuration. |
| **Scheduler** | Full schedule generation, manual tweaking, repair, and export access. |
| **Teacher** | Read-only access to individual schedule, duty rosters, and classes. |
| **Viewer** | Read-only view of published school timetables. |

---

## 🔍 Independent Validator & Pre-flight Checks

### Pre-flight Diagnostic Engine
Before triggering the Python CP-SAT solver, a fast pre-check validates resource feasibility:
* *Example:* If a teacher requires 20 weekly slots but only has 10 available slots configured, an early warning is surfaced before running the solver.

### Independent Post-Validation
Once the solver produces a output schedule, an isolated validation layer evaluates the result:

```
Solver Output ──► Independent Validator ──► Validation Report (Valid / Violations Found)
```
This double-verification pattern prevents reliance on solver outputs alone.

---

## 🏗️ System Architecture

```
                    ┌──────────────────────┐
                    │     Web Browser      │
                    │ RTL / LTR Modern UI  │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │       Next.js        │
                    │   Frontend & APIs    │
                    └──────────┬───────────┘
                               │
                  ┌────────────┴────────────┐
                  │                         │
                  ▼                         ▼
        ┌────────────────┐        ┌──────────────────┐
        │     Prisma     │        │  Python Micro-   │
        │ SQLite / PostG │        │     service      │
        └────────────────┘        │ FastAPI + CP-SAT │
                                  └──────────────────┘
```

---

## 🛠️ Tech Stack

| Domain | Technology / Library |
| :--- | :--- |
| **Web Framework** | Next.js 16 (App Router), React |
| **Language** | TypeScript 5, Python 3.10+ |
| **Styling & UI** | Tailwind CSS 4, shadcn/ui |
| **State & Drag-and-Drop** | Zustand, dnd-kit, TanStack Query |
| **Database & ORM** | SQLite (Dev) / PostgreSQL (Prod), Prisma 6 |
| **Scheduling Engine** | Python, FastAPI, Google OR-Tools CP-SAT |
| **Export & Charts** | ExcelJS, Recharts |
| **Authentication** | JWT, HttpOnly Cookies |

---

## 🔌 API Reference

### Auth & Data Endpoints
* `POST /api/auth/login` | `POST /api/auth/logout` | `GET /api/auth/session`
* `GET/POST /api/teachers`, `/api/subjects`, `/api/rooms`, `/api/lessons`, `/api/duties`

### Timetable Operations
* `POST /api/scheduling/generate` - Trigger full schedule generation.
* `POST /api/scheduling/validate` - Run independent schedule verification.
* `POST /api/timetable/move` - Shift a lesson to a target period.
* `POST /api/timetable/repair` - Request auto-repair options for a conflict.
* `POST /api/timetable/lock` - Toggle lock/pin status on a lesson slot.

### Python Scheduler Microservice (`http://127.0.0.1:3040`)
* `GET /health` - Microservice health status check.
* `POST /solve` - Full CP-SAT solver execution.
* `POST /repair` - Local sub-graph repair solver execution.
* `POST /validate` - Model constraint verification.

---

## 🧪 Testing & Verification

Run the test suite to verify the solver engine and system integrity:

```bash
# Unit Tests
cd mini-services/scheduler
python3 app/tests/test_solver.py

# Solver Profiling & Verification
python3 scripts/phase2_verify_periods.py
python3 scripts/phase3_profile.py
python3 scripts/phase9_seventh.py
python3 scripts/phase10_repair_tests.py

# Full End-to-End Acceptance Suite
python3 scripts/acceptance_suite.py
```

### Verification Benchmark (Demo Data)
```text
Teachers:           30
Sections:           15
Subjects:           12
Rooms:              23
Lessons:            180
Weekly Occurrences: 540

Scheduled Status:   540 / 540 (100%)
Hard Violations:    0
```

---

## 📁 Project Structure

```text
timetable-system/
├── prisma/
│   └── schema.prisma         # Database models & schema
├── docs/                     # Documentation assets & screenshots
├── mini-services/
│   └── scheduler/            # Python CP-SAT Solver microservice
│       ├── start.sh
│       ├── requirements.txt
│       └── app/
│           ├── main.py       # FastAPI application
│           └── solver/       # CP-SAT logic, repair, & validation
├── src/
│   ├── app/                  # Next.js App Router pages & APIs
│   ├── components/           # UI components, modals, and views
│   └── lib/                  # Auth, DB client, state stores, and scheduling logic
├── scripts/                  # Seed scripts, benchmarks, & test suites
└── tests/                    # Integration and unit tests
```

---

## 🛠️ Troubleshooting

#### 1. Scheduler Service Unavailable
Verify the service health:
```bash
curl http://127.0.0.1:3040/health
```
If unresponsive, restart the scheduler microservice:
```bash
cd mini-services/scheduler
./start.sh
# Inspect output log:
tail -n 50 /tmp/scheduler.log
```

#### 2. Auto-Repair Returns `NO_REPAIR_FOUND`
If local repair fails to return a solution:
* Check if target slots belong to valid operating days/periods.
* Ensure target teacher and room are available and unconstrained.
* Check if overlapping lessons are locked (pinned).
* Consider increasing `repairRadius` in configuration parameters if needed.

---

## 🗺️ Roadmap

- [ ] PostgreSQL production support.
- [ ] Excel/CSV data import wizard.
- [ ] PDF timetable printable rendering.
- [ ] Mobile app integration for staff notifications.
- [ ] Webhook integration for timetable publishing notifications.

---

## 📄 License & Acknowledgments

This project is licensed under the **MIT License**.

Special thanks to the developers and communities behind:
* [Google OR-Tools](https://developers.google.com/optimization)
* [Next.js](https://nextjs.org/)
* [Prisma](https://www.prisma.io/)
* [FastAPI](https://fastapi.tiangolo.com/)
* [Tailwind CSS](https://tailwindcss.com/)
