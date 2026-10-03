import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// POST /api/timetable/swap-teacher { entryId, newTeacherId, versionId }
// Changes the teacher of a timetable entry, validating that the new teacher:
//   1. Has no conflict at the same (day, period) — not already teaching another lesson
//   2. Has no duty at the same (day, period)
//   3. Is not on a day-off
//   4. Is not in a forbidden/unavailable slot
// Returns ok=true if the swap is valid, or conflict details if not.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN", "SCHEDULER"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const entryId = body.entryId;
  const newTeacherId = body.newTeacherId;
  const versionId = body.versionId;
  const apply = body.apply !== false; // default: just validate, don't apply

  if (!entryId || !newTeacherId || !versionId) {
    return NextResponse.json({ error: "entryId, newTeacherId, versionId required" }, { status: 400 });
  }

  const entry = await db.timetableEntry.findUnique({
    where: { id: entryId },
    include: { lesson: { include: { subject: true, section: true } } },
  });
  if (!entry) return NextResponse.json({ error: "ENTRY_NOT_FOUND" }, { status: 404 });

  const newTeacher = await db.teacher.findUnique({ where: { id: newTeacherId } });
  if (!newTeacher) return NextResponse.json({ error: "TEACHER_NOT_FOUND" }, { status: 404 });

  // Check conflicts at (day, period) for the new teacher
  const day = entry.day;
  const period = entry.period;

  // 1. Teacher conflict — new teacher already teaching at this slot
  const teacherConflict = await db.timetableEntry.findFirst({
    where: {
      versionId,
      id: { not: entry.id },
      teacherId: newTeacherId,
      day,
      period,
      cellType: "TEACHING",
    },
  });

  // 2. Duty conflict — new teacher has a duty at this slot
  const dutyConflict = await db.duty.findFirst({
    where: { teacherId: newTeacherId, day, period },
  });

  // 3. Day off check
  const dayOff = await db.teacherDayOff.findFirst({
    where: { teacherId: newTeacherId, day },
  });

  // 4. Availability check (UNAVAILABLE/FORBIDDEN)
  const availability = await db.teacherAvailability.findFirst({
    where: { teacherId: newTeacherId, day, period },
  });
  const availState = availability?.state;
  const isUnavailable = availState === "UNAVAILABLE" || availState === "FORBIDDEN";

  // 5. Qualification check — is the new teacher qualified to teach this subject?
  const qualification = await db.teacherSubject.findFirst({
    where: { teacherId: newTeacherId, subjectId: entry.subjectId || "" },
  });

  const conflicts: any[] = [];
  if (teacherConflict) {
    conflicts.push({
      type: "TEACHER",
      severity: "CRITICAL",
      message: `Teacher "${newTeacher.name}" is already teaching at ${day} P${period}`,
      entryId: teacherConflict.id,
    });
  }
  if (dutyConflict) {
    conflicts.push({
      type: "DUTY",
      severity: "CRITICAL",
      message: `Teacher "${newTeacher.name}" has a duty (${dutyConflict.title}) at ${day} P${period}`,
    });
  }
  if (dayOff) {
    conflicts.push({
      type: "DAY_OFF",
      severity: "CRITICAL",
      message: `Teacher "${newTeacher.name}" has a day off on ${day}`,
    });
  }
  if (isUnavailable) {
    conflicts.push({
      type: "AVAILABILITY",
      severity: "CRITICAL",
      message: `Teacher "${newTeacher.name}" is marked ${availState} at ${day} P${period}`,
    });
  }
  if (!qualification && entry.lesson?.subjectId) {
    conflicts.push({
      type: "QUALIFICATION",
      severity: "WARNING",
      message: `Teacher "${newTeacher.name}" is not qualified to teach "${entry.lesson?.subject?.name || "this subject"}"`,
    });
  }

  // If there are CRITICAL conflicts, we cannot apply
  const hasCritical = conflicts.some(c => c.severity === "CRITICAL");

  if (hasCritical || !apply) {
    return NextResponse.json({
      ok: !hasCritical,
      canSwap: !hasCritical,
      conflicts,
      hasCritical,
      entry: {
        id: entry.id,
        day: entry.day,
        period: entry.period,
        currentTeacherId: entry.teacherId,
        newTeacherId,
        newTeacherName: newTeacher.name,
        subjectName: entry.lesson?.subject?.name,
        sectionName: entry.lesson?.section?.name,
      },
    });
  }

  // Apply the swap
  const oldTeacherId = entry.teacherId;
  const updated = await db.timetableEntry.update({
    where: { id: entryId },
    data: { teacherId: newTeacherId },
  });

  // Record change for undo/redo
  await db.timetableChange.create({
    data: {
      versionId,
      action: "SWAP_TEACHER",
      payload: JSON.stringify({ entryId, oldTeacherId, newTeacherId }),
    },
  });

  await audit({
    userId: s.id,
    schoolId: entry.schoolId,
    action: "SWAP_TEACHER",
    entity: "TimetableEntry",
    entityId: entryId,
    oldValue: { teacherId: oldTeacherId },
    newValue: { teacherId: newTeacherId },
  });

  return NextResponse.json({
    ok: true,
    canSwap: true,
    applied: true,
    conflicts: [],
    entry: updated,
  });
}
