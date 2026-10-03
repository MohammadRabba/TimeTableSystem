import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buildSolverInput } from "@/lib/scheduling/input-builder";
import type { SolverInput } from "@/lib/scheduling/engine";

// POST /api/scheduling/diagnose { schoolId }
// Returns per-lesson candidate slot counts so the user can see WHY
// the solver reports INFEASIBLE. Lessons with 0 candidates are the root cause.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });

  const input = await buildSolverInput(schoolId);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  const inp = input as SolverInput;

  const days = (inp.school.workingDays || "").split(",").filter(Boolean);
  const periodsPerDay = inp.school.periodsPerDay;
  const schoolForbidden = new Set(
    (inp.school.forbiddenSlots || "").split(",").map(s => s.trim()).filter(Boolean)
  );

  // Build teacher allowed slots
  const teacherAllowed: Record<string, Set<string>> = {};
  const teacherOccupied: Record<string, Set<string>> = {};
  for (const t of inp.teachers) {
    teacherAllowed[t.id] = new Set();
    teacherOccupied[t.id] = new Set();
    const daysOff = new Set(inp.daysOff[t.id] || []);
    for (const d of days) {
      if (daysOff.has(d as any)) continue;
      for (let p = 1; p <= periodsPerDay; p++) {
        const sk = `${d}_${p}`;
        if (schoolForbidden.has(sk)) continue;
        const state = inp.availability[t.id]?.[sk];
        if (state === "UNAVAILABLE" || state === "FORBIDDEN") continue;
        teacherAllowed[t.id].add(sk);
      }
    }
  }
  for (const d of inp.duties) {
    teacherOccupied[d.teacherId]?.add(`${d.day}_${d.period}`);
  }

  // Build lookup maps
  const subjectById = new Map(inp.subjects.map(s => [s.id, s]));
  const sectionById = new Map(inp.sections.map(s => [s.id, s]));
  const teacherById = new Map(inp.teachers.map(t => [t.id, t]));
  const roomById = new Map(inp.rooms.map(r => [r.id, r]));

  const diagnoses: any[] = [];
  let totalCandidates = 0;
  let zeroCandidateLessons = 0;
  let insufficientCandidateLessons = 0;

  for (const lesson of inp.lessons) {
    const subject = subjectById.get(lesson.subjectId);
    const section = sectionById.get(lesson.sectionId);
    const teacher = teacherById.get(lesson.teacherId);

    if (!subject || !section || !teacher) {
      diagnoses.push({
        lessonId: lesson.id,
        teacherName: teacher?.name || "?",
        subjectName: subject?.name || "?",
        sectionName: section?.name || "?",
        weeklyOccurrences: lesson.weeklyOccurrences,
        candidateSlots: 0,
        issues: ["MISSING_REFERENCE"],
        reasons: [`Missing: ${!subject ? "subject" : ""} ${!section ? "section" : ""} ${!teacher ? "teacher" : ""}`.trim()],
        fixes: ["Delete this lesson and recreate it with valid references."],
      });
      zeroCandidateLessons++;
      continue;
    }

    // Compute compatible rooms (matches Python solver logic)
    let compatibleRooms: any[] = [];
    if (subject.requiredRoomType) {
      compatibleRooms = inp.rooms.filter(r =>
        r.type === subject.requiredRoomType && r.capacity >= section.studentCount
      );
      if (compatibleRooms.length === 0) {
        compatibleRooms = inp.rooms.filter(r => r.type === subject.requiredRoomType);
      }
    } else {
      compatibleRooms = inp.rooms.filter(r =>
        r.type === "CLASSROOM" && r.capacity >= section.studentCount
      );
      if (compatibleRooms.length === 0) {
        compatibleRooms = inp.rooms.filter(r => r.capacity >= section.studentCount);
      }
      if (compatibleRooms.length === 0) {
        compatibleRooms = inp.rooms;
      }
    }
    // If lesson has explicit roomId, pin to it
    if (lesson.roomId) {
      const explicit = roomById.get(lesson.roomId);
      if (explicit && (!subject.requiredRoomType || explicit.type === subject.requiredRoomType)
          && explicit.capacity >= section.studentCount) {
        compatibleRooms = [explicit];
      } else {
        compatibleRooms = [];
      }
    }

    // Compute candidate slots
    const issues: string[] = [];
    const reasons: string[] = [];
    const fixes: string[] = [];
    let candidateCount = 0;

    const subjectForbidden = new Set(subject.forbiddenPeriods || []);
    const lessonForbiddenKeys = new Set(
      (lesson.forbiddenSlots || "").split(",").map(x => x.trim()).filter(x => x.includes("_"))
    );
    const lessonForbiddenPeriods = new Set(
      (lesson.forbiddenSlots || "").split(",").map(x => x.trim())
        .filter(x => x && !x.includes("_")).map(Number)
    );

    for (const d of days) {
      for (let p = 1; p <= periodsPerDay; p++) {
        const sk = `${d}_${p}`;
        if (schoolForbidden.has(sk)) continue;
        if (!teacherAllowed[teacher.id].has(sk)) continue;
        if (teacherOccupied[teacher.id]?.has(sk)) continue;
        if (subjectForbidden.has(p)) continue;
        if (lessonForbiddenKeys.has(sk)) continue;
        if (lessonForbiddenPeriods.has(p)) continue;
        if (compatibleRooms.length === 0) continue;
        candidateCount++;
      }
    }

    // Diagnose issues with actionable fixes
    if (compatibleRooms.length === 0 && subject.requiredRoomType) {
      const roomsOfType = inp.rooms.filter(r => r.type === subject.requiredRoomType).length;
      issues.push("NO_COMPATIBLE_ROOM");
      reasons.push(
        `Subject "${subject.name}" requires room type "${subject.requiredRoomType}" but ` +
        (roomsOfType === 0
          ? `no room of this type exists.`
          : `all ${roomsOfType} room(s) of this type have capacity < ${section.studentCount} students.`)
      );
      fixes.push(
        roomsOfType === 0
          ? `Add at least one room of type "${subject.requiredRoomType}".`
          : `Increase capacity of "${subject.requiredRoomType}" rooms to ≥ ${section.studentCount}.`
      );
    }
    if (inp.rooms.length === 0) {
      issues.push("NO_ROOMS_AT_ALL");
      reasons.push("No rooms exist in the school.");
      fixes.push("Go to Rooms and add at least one classroom.");
    }
    if (teacherAllowed[teacher.id].size === 0) {
      issues.push("TEACHER_NO_AVAILABILITY");
      reasons.push(
        `Teacher "${teacher.name}" has 0 available slots — all periods blocked by days-off or UNAVAILABLE/FORBIDDEN.`
      );
      fixes.push(`Go to Teachers → availability → mark slots as AVAILABLE for "${teacher.name}".`);
    }
    const teacherDuties = inp.duties.filter(d => d.teacherId === teacher.id).length;
    if (teacherAllowed[teacher.id].size > 0 && teacherAllowed[teacher.id].size <= teacherDuties && candidateCount === 0) {
      issues.push("TEACHER_FULLY_BOOKED_BY_DUTIES");
      reasons.push(
        `Teacher "${teacher.name}" has ${teacherAllowed[teacher.id].size} available slots but ${teacherDuties} duties.`
      );
      fixes.push(`Reduce duties for "${teacher.name}" or increase availability.`);
    }
    if (candidateCount === 0 && issues.length === 0) {
      issues.push("UNKNOWN");
      reasons.push("No candidates found — check subject forbidden periods and lesson forbidden slots.");
      fixes.push("Check the subject's forbidden periods and the lesson's forbidden slots.");
    }
    if (candidateCount > 0 && candidateCount < lesson.weeklyOccurrences) {
      issues.push("INSUFFICIENT_SLOTS");
      reasons.push(`Needs ${lesson.weeklyOccurrences} slots but only ${candidateCount} candidates exist.`);
      fixes.push("Reduce weekly occurrences or increase teacher availability.");
      insufficientCandidateLessons++;
    }

    if (candidateCount === 0) zeroCandidateLessons++;
    totalCandidates += candidateCount;

    diagnoses.push({
      lessonId: lesson.id,
      teacherId: teacher.id,
      teacherName: teacher.name,
      subjectId: subject.id,
      subjectName: subject.name,
      sectionId: section.id,
      sectionName: section.name,
      weeklyOccurrences: lesson.weeklyOccurrences,
      candidateSlots: candidateCount,
      teacherAvailableSlots: teacherAllowed[teacher.id].size,
      teacherDuties,
      compatibleRooms: compatibleRooms.length,
      requiredRoomType: subject.requiredRoomType || null,
      sectionStudentCount: section.studentCount,
      issues,
      reasons,
      fixes,
    });
  }

  // Sort: zero-candidate first, then insufficient, then by candidate count
  diagnoses.sort((a, b) => {
    if (a.candidateSlots === 0 && b.candidateSlots > 0) return -1;
    if (b.candidateSlots === 0 && a.candidateSlots > 0) return 1;
    return a.candidateSlots - b.candidateSlots;
  });

  // === AGGREGATE FEASIBILITY ANALYSIS ===
  // Compute per-section capacity vs demand (accounting for school forbidden slots)
  const daysArr = days as string[];
  const totalSlotsPerSection = daysArr.reduce((sum, d) => {
    for (let p = 1; p <= periodsPerDay; p++) {
      if (!schoolForbidden.has(`${d}_${p}`)) sum++;
    }
    return sum;
  }, 0);

  const sectionDemandMap: Record<string, number> = {};
  for (const l of inp.lessons) {
    sectionDemandMap[l.sectionId] = (sectionDemandMap[l.sectionId] || 0) + l.weeklyOccurrences;
  }

  const sectionsOver: any[] = [];
  for (const [sid, demand] of Object.entries(sectionDemandMap)) {
    const sec = sectionById.get(sid);
    if (demand >= totalSlotsPerSection) {
      sectionsOver.push({
        sectionId: sid,
        sectionName: sec?.name || sid,
        demand,
        capacity: totalSlotsPerSection,
        slack: totalSlotsPerSection - demand,
        recommendation: demand > totalSlotsPerSection
          ? `Reduce weekly occurrences by at least ${demand - totalSlotsPerSection + 1}`
          : `Demand equals capacity (zero slack) — reduce 1+ weekly occurrence to give the solver room`,
      });
    }
  }

  // 7th-period aggregate analysis
  const daysWith7th = daysArr.filter(d => !schoolForbidden.has(`${d}_${periodsPerDay}`));
  const required7thSlots = inp.sections.length * daysWith7th.length;
  const sumRequired7th = inp.teachers.reduce((s, t) => s + t.requiredSeventh, 0);
  const sumMax7th = inp.teachers.reduce((s, t) => s + t.maxSeventh, 0);

  return NextResponse.json({
    ok: true,
    schoolId,
    summary: {
      totalLessons: inp.lessons.length,
      totalRequiredOccurrences: inp.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0),
      totalCandidateSlots: totalCandidates,
      zeroCandidateLessons,
      insufficientCandidateLessons,
      schoolForbiddenSlots: Array.from(schoolForbidden),
      workingDays: days,
      periodsPerDay,
      teachers: inp.teachers.length,
      sections: inp.sections.length,
      subjects: inp.subjects.length,
      rooms: inp.rooms.length,
      duties: inp.duties.length,
      // NEW: aggregate feasibility metrics
      totalSlotsPerSection,
      totalSectionCapacity: inp.sections.length * totalSlotsPerSection,
      daysWith7thPeriod: daysWith7th.length,
      required7thSlots,
      sumRequiredSeventh: sumRequired7th,
      sumMaxSeventh: sumMax7th,
      seventhCapacityGap: required7thSlots - sumMax7th,
    },
    // NEW: aggregate analysis with actionable recommendations
    aggregate: {
      perSectionCapacity: totalSlotsPerSection,
      totalDemand: inp.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0),
      totalCapacity: inp.sections.length * totalSlotsPerSection,
      slack: inp.sections.length * totalSlotsPerSection - inp.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0),
      sectionsOverCapacity: sectionsOver,
      seventhPeriod: {
        daysWith7th: daysWith7th.length,
        requiredSlots: required7thSlots,
        supplyRequired: sumRequired7th,
        supplyMax: sumMax7th,
        gap: required7thSlots - sumMax7th,
        feasible: sumMax7th >= required7thSlots,
      },
      recommendations: [
        ...(inp.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0) >= inp.sections.length * totalSlotsPerSection
          ? [`⚠ Total demand (${inp.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0)}) ≥ total capacity (${inp.sections.length * totalSlotsPerSection}). Reduce weekly occurrences by at least ${inp.lessons.reduce((s, l) => s + l.weeklyOccurrences, 0) - inp.sections.length * totalSlotsPerSection + 1} to create slack.`]
          : []),
        ...(sumMax7th < required7thSlots
          ? [`⚠ 7th-period deficit: need ${required7thSlots} slots but sum(maxSeventh)=${sumMax7th}. Increase maxSeventh for teachers or reduce requiredSeventh.`]
          : []),
        ...(sectionsOver.length > 0
          ? [`⚠ ${sectionsOver.length} section(s) at or over capacity. See sectionsOverCapacity list below.`]
          : []),
      ],
    },
    diagnoses: diagnoses.slice(0, 100),
    allDiagnosesCount: diagnoses.length,
  });
}
