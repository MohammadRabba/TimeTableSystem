// SchedulingProvider abstraction.
//
// The TypeScript solver remains available as a reference / fallback.
// The default production provider is ORToolsSolver, which delegates to the
// Python + FastAPI + OR-Tools CP-SAT microservice.
//
// URL resolution:
//   - If SCHEDULER_URL starts with http:// or https://, use it directly
//     (e.g. "http://127.0.0.1:3040" — direct to Python service)
//   - If SCHEDULER_URL is relative (e.g. "/api/scheduler"), prepend
//     the Next.js origin so Node's fetch gets an absolute URL.
//     The Next.js proxy at /api/scheduler/[path]/route.ts forwards
//     to the Python service.
//   - We also strip any trailing /solve, /validate, /swap, /repair so
//     callers can set SCHEDULER_URL=/api/scheduler/solve and it still
//     works (we'll append the correct endpoint ourselves).

import type { SolverInput, SolverResult } from "./engine";
import { solve as tsSolve } from "./engine";

export type SolverStatus =
  | "OPTIMAL"
  | "FEASIBLE"
  | "INFEASIBLE"
  | "UNKNOWN"
  | "MODEL_INVALID";

export interface OccurrenceEntry {
  occurrenceId: string; // "lessonId#n"
  lessonId: string;
  occurrenceNumber: number; // 1..N
  teacherId: string;
  subjectId: string;
  sectionId: string;
  roomId?: string | null;
  day: string;
  period: number;
  cellType: string;
  fixed: boolean;
  locked: boolean;
}

export interface ProviderStats {
  requiredOccurrences: number;
  scheduledOccurrences: number;
  unscheduledOccurrences: number;
  teacherConflicts: number;
  classConflicts: number;
  roomConflicts: number;
  availabilityViolations: number;
  dutyConflicts: number;
  fixedLessonViolations: number;
  capacityViolations: number;
  teacherGaps: number;
  seventhDeviation: number;
  subjectCluster: number;
  workloadDeviation: number;
  unwantedSlots: number;
}

export interface ProviderResponse {
  status: SolverStatus;
  feasible: boolean; // STRICT: true iff required == scheduled AND hardViolations == 0
  partial: boolean; // True only when allowPartial && some unscheduled
  entries: OccurrenceEntry[];
  dutyEntries: Array<{
    dutyId: string;
    teacherId: string;
    day: string;
    period: number;
    type: string;
    title: string;
    cellType: string;
  }>;
  stats: ProviderStats;
  softPenalty: number;
  qualityScore: number;
  objectiveValue?: number | null;
  modelGenerationMs: number;
  solverMs: number;
  wallMs: number;
  memoryMb?: number | null;
  failures: Array<{
    scope: string;
    entityId?: string;
    reason: string;
    suggestion: string;
  }>;
  conflicts: Array<{
    type: string;
    severity: string;
    day?: string;
    period?: number;
    message: string;
    entityIds: string[];
  }>;
  suggestions: string[];
  // Lessons with zero valid candidate slots — root cause of instant INFEASIBLE
  zeroCandidateLessons?: Array<{
    occurrence_id: string;
    lesson_id: string;
    occurrence_number: number;
    teacher_id: string;
    teacher_name: string;
    subject_id: string;
    subject_name: string;
    section_id: string;
    section_name: string;
    required_room_type?: string | null;
    section_student_count: number;
    teacher_available_slots: number;
    teacher_duty_count: number;
    is_fixed: boolean;
    fixed_day?: string | null;
    fixed_period?: number | null;
  }>;
  provider: "TYPESCRIPT" | "OR_TOOLS";
}

export interface SolveOptions {
  timeLimitSeconds?: number;
  numWorkers?: number;
  profile?: "FAST" | "BALANCED" | "DEEP";
  allowPartial?: boolean;
  allowUnderSchedule?: boolean;
}

export interface SchedulingProvider {
  name: string;
  solve(input: SolverInput, opts: SolveOptions): Promise<ProviderResponse>;
}

// ============== TypeScriptSolver (fallback/reference) ==============

export const TypeScriptSolver: SchedulingProvider = {
  name: "TypeScriptSolver",
  async solve(input: SolverInput, opts: SolveOptions = {}): Promise<ProviderResponse> {
    const t0 = Date.now();
    const result = tsSolve(input, {
      timeLimitSec: opts.timeLimitSeconds || 60,
    });

    // Convert TS result into the unified ProviderResponse schema.
    // The TS solver does not expand weekly occurrences, so this is best-effort
    // for backward compatibility. The new strict success criteria make this
    // solver's output rarely `feasible: true` for production data.
    const requiredOccurrences = input.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0);
    const scheduledOccurrences = result.entries.length;
    const hardViolations = result.conflicts.filter((c) => c.severity === "CRITICAL").length;

    return {
      status: result.feasible ? "FEASIBLE" : "UNKNOWN",
      feasible: result.feasible && scheduledOccurrences === requiredOccurrences && hardViolations === 0,
      partial: false, // TS solver does not produce partial solutions
      entries: result.entries.map((e) => ({
        occurrenceId: `${e.lessonId}#1`,
        lessonId: e.lessonId,
        occurrenceNumber: 1,
        teacherId: e.teacherId,
        subjectId: e.subjectId,
        sectionId: e.sectionId,
        roomId: e.roomId || null,
        day: e.day,
        period: e.period,
        cellType: e.cellType,
        fixed: e.fixed,
        locked: e.locked,
      })),
      dutyEntries: result.dutyEntries,
      stats: {
        requiredOccurrences,
        scheduledOccurrences,
        unscheduledOccurrences: Math.max(0, requiredOccurrences - scheduledOccurrences),
        teacherConflicts: result.conflicts.filter((c) => c.type === "TEACHER").length,
        classConflicts: result.conflicts.filter((c) => c.type === "CLASS").length,
        roomConflicts: result.conflicts.filter((c) => c.type === "ROOM").length,
        availabilityViolations: result.conflicts.filter((c) => c.type === "AVAILABILITY").length,
        dutyConflicts: result.conflicts.filter((c) => c.type === "DUTY").length,
        fixedLessonViolations: result.conflicts.filter((c) => c.type === "FIXED").length,
        capacityViolations: result.conflicts.filter((c) => c.type === "CAPACITY").length,
        teacherGaps: result.stats.teacherGaps,
        seventhDeviation: result.stats.seventhDeviation,
        subjectCluster: result.stats.subjectCluster,
        workloadDeviation: result.stats.workloadDeviation,
        unwantedSlots: result.stats.unwantedSlots,
      },
      softPenalty: 0,
      qualityScore: result.qualityScore,
      objectiveValue: null,
      modelGenerationMs: 0,
      solverMs: 0,
      wallMs: Date.now() - t0,
      memoryMb: null,
      failures: result.failures,
      conflicts: result.conflicts,
      suggestions: result.suggestions,
      provider: "TYPESCRIPT",
    };
  },
};

// ============== ORToolsSolver (production) ==============

const SCHEDULER_URL = process.env.SCHEDULER_URL || "http://127.0.0.1:3040";
const NEXTJS_ORIGIN = process.env.NEXTJS_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Resolve a scheduler endpoint to an absolute URL that Node's fetch accepts.
 *
 * Handles three SCHEDULER_URL shapes:
 *   1. "http://127.0.0.1:3040"  — direct absolute (default)
 *   2. "/api/scheduler"          — relative, prepend Next.js origin
 *   3. "/api/scheduler/solve"    — relative with endpoint suffix, strip & prepend
 */
function resolveSchedulerUrl(endpoint: "solve" | "validate" | "swap" | "repair"): string {
  let base = SCHEDULER_URL;
  // Strip trailing endpoint suffixes if the user accidentally included them
  for (const suffix of ["/solve", "/validate", "/swap", "/repair", "/"]) {
    if (base.endsWith(suffix) && base.length > suffix.length) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }
  // If still ends with /, strip it
  base = base.replace(/\/+$/, "");
  // Prepend origin if relative
  if (!/^https?:\/\//i.test(base)) {
    base = `${NEXTJS_ORIGIN.replace(/\/+$/, "")}${base.startsWith("/") ? base : "/" + base}`;
  }
  return `${base}/${endpoint}`;
}

export const ORToolsSolver: SchedulingProvider = {
  name: "ORToolsSolver",
  async solve(input: SolverInput, opts: SolveOptions = {}): Promise<ProviderResponse> {
    const t0 = Date.now();
    const profile = opts.profile || "BALANCED";
    const timeLimit = opts.timeLimitSeconds
      ?? (profile === "FAST" ? 10 : profile === "DEEP" ? 300 : 60);

    // Build the request body matching the Python SolverRequest schema
    const body = {
      school: input.school,
      teachers: input.teachers,
      sections: input.sections,
      subjects: input.subjects.map((s) => ({
        ...s,
        preferredPeriods: s.preferredPeriods,
        forbiddenPeriods: s.forbiddenPeriods,
      })),
      rooms: input.rooms,
      lessons: input.lessons,
      duties: input.duties,
      availability: input.availability,
      daysOff: input.daysOff,
      constraints: input.constraints,
      config: {
        timeLimitSeconds: timeLimit,
        numWorkers: opts.numWorkers ?? 8,
        profile,
        allowPartial: opts.allowPartial ?? false,
        allowUnderSchedule: opts.allowUnderSchedule ?? false,
      },
    };

    const controller = new AbortController();
    const timeoutMs = (timeLimit + 30) * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const targetUrl = resolveSchedulerUrl("solve");
    let r: Response;
    try {
      r = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      const cause = e?.cause ? ` (cause: ${e.cause.code || e.cause.message || e.cause})` : "";
      throw new Error(
        `OR-Tools solver call failed: ${e?.message || e}${cause}. ` +
        `Target URL: ${targetUrl}. ` +
        `SCHEDULER_URL=${process.env.SCHEDULER_URL || "(unset, default http://127.0.0.1:3040)"}. ` +
        `Make sure the Python service is running: cd mini-services/scheduler && ./start.sh`
      );
    }
    clearTimeout(timer);
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`OR-Tools solver call failed: ${r.status} ${err} (url=${targetUrl})`);
    }
    const data = await r.json();
    return {
      status: data.status,
      feasible: data.feasible,
      partial: data.partial,
      entries: data.entries,
      dutyEntries: data.dutyEntries,
      stats: data.stats,
      softPenalty: data.softPenalty,
      qualityScore: data.qualityScore,
      objectiveValue: data.objectiveValue ?? null,
      modelGenerationMs: data.modelGenerationMs,
      solverMs: data.solverMs,
      wallMs: data.wallMs ?? (Date.now() - t0),
      memoryMb: data.memoryMb ?? null,
      failures: data.failures,
      conflicts: data.conflicts,
      suggestions: data.suggestions,
      zeroCandidateLessons: data.zeroCandidateLessons ?? [],
      provider: "OR_TOOLS",
    };
  },
};

// ============== Default provider selection ==============

export function getDefaultProvider(): SchedulingProvider {
  // OR-Tools is the production default. Override via env SCHEDULER_PROVIDER=typescript
  // to use the TS reference solver (for testing/comparison).
  const wanted = (process.env.SCHEDULER_PROVIDER || "ortools").toLowerCase();
  return wanted === "typescript" ? TypeScriptSolver : ORToolsSolver;
}

// ============== Independent validator call ==============

export async function validateTimetable(input: SolverInput, entries: OccurrenceEntry[]): Promise<{
  valid: boolean;
  hardViolations: number;
  softPenalty: number;
  issues: any[];
  stats: ProviderStats;
}> {
  const body = {
    school: input.school,
    teachers: input.teachers,
    sections: input.sections,
    subjects: input.subjects.map((s) => ({
      ...s,
      preferredPeriods: s.preferredPeriods,
      forbiddenPeriods: s.forbiddenPeriods,
    })),
    rooms: input.rooms,
    lessons: input.lessons,
    duties: input.duties,
    availability: input.availability,
    daysOff: input.daysOff,
    entries,
    dutyEntries: [],
  };
  const r = await fetch(resolveSchedulerUrl("validate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Validator call failed: ${r.status} (url=${resolveSchedulerUrl("validate")})`);
  return r.json();
}

// ============== Swap suggestion call ==============

export async function suggestSwaps(input: SolverInput, entries: OccurrenceEntry[], target: {
  occurrenceId: string;
  day: string;
  period: number;
}): Promise<{ suggestions: Array<{ day: string; period: number; swapWithLessonId?: string; swapWithOccurrenceId?: string; reason: string; hardViolations: number; softPenalty: number }> }> {
  const body = {
    school: input.school,
    teachers: input.teachers,
    sections: input.sections,
    subjects: input.subjects.map((s) => ({
      ...s,
      preferredPeriods: s.preferredPeriods,
      forbiddenPeriods: s.forbiddenPeriods,
    })),
    rooms: input.rooms,
    lessons: input.lessons,
    duties: input.duties,
    availability: input.availability,
    daysOff: input.daysOff,
    entries,
    targetOccurrenceId: target.occurrenceId,
    targetDay: target.day,
    targetPeriod: target.period,
  };
  const r = await fetch(resolveSchedulerUrl("swap"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Swap call failed: ${r.status} (url=${resolveSchedulerUrl("swap")})`);
  return r.json();
}
