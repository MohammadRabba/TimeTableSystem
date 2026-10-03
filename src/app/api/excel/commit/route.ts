import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";

// POST /api/excel/commit { schoolId, entity, rows }
// Persists the validated import rows in a transaction.
// Returns the count of created records.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const body = await req.json();
  const schoolId = body.schoolId || s.schoolId;
  const entity = body.entity;
  const rows: any[] = body.rows || [];

  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });
  if (!entity) return NextResponse.json({ error: "NO_ENTITY" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "NO_ROWS" }, { status: 400 });

  try {
    let created = 0;
    await db.$transaction(async (tx) => {
      if (entity === "teachers") {
        for (const row of rows) {
          await tx.teacher.create({
            data: {
              schoolId,
              name: row.name,
              employeeNumber: row.employeeNumber,
              specialization: row.specialization,
              email: row.email,
              phone: row.phone,
              requiredWorkload: row.requiredWorkload,
              maxDailyPeriods: row.maxDailyPeriods,
              requiredSeventh: row.requiredSeventh,
            },
          });
          created++;
        }
      } else if (entity === "subjects") {
        for (const row of rows) {
          await tx.subject.create({
            data: {
              schoolId,
              name: row.name,
              code: row.code,
              type: row.type,
              defaultWeekly: row.defaultWeekly,
              maxPerDay: row.maxPerDay,
              requiredRoomType: row.requiredRoomType,
              priority: row.priority,
            },
          });
          created++;
        }
      } else if (entity === "sections") {
        for (const row of rows) {
          await tx.section.create({
            data: {
              schoolId,
              name: row.name,
              code: row.code,
              gradeId: row.gradeId,
              studentCount: row.studentCount,
              roomId: row.roomId || null,
              active: true,
            },
          });
          created++;
        }
      } else if (entity === "rooms") {
        for (const row of rows) {
          await tx.room.create({
            data: {
              schoolId,
              name: row.name,
              code: row.code,
              type: row.type,
              capacity: row.capacity,
              equipment: row.equipment,
            },
          });
          created++;
        }
      } else if (entity === "lessons") {
        for (const row of rows) {
          await tx.lesson.create({
            data: {
              schoolId,
              teacherId: row.teacherId,
              subjectId: row.subjectId,
              sectionId: row.sectionId,
              roomId: row.roomId || null,
              weeklyOccurrences: row.weeklyOccurrences,
              lessonType: row.lessonType,
              priority: row.priority,
            },
          });
          created++;
        }
      } else {
        throw new Error(`Unknown entity: ${entity}`);
      }
    });

    await audit({
      userId: s.id, schoolId,
      action: "IMPORT_EXCEL_COMMIT",
      entity: entity,
      entityId: null,
      newValue: { created, total: rows.length },
    });

    return NextResponse.json({ ok: true, created, total: rows.length });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
