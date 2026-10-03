import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/timetable/compare?a=A&b=B
// Returns a structured diff between two timetable versions:
//   - entries only in A
//   - entries only in B
//   - entries in both but at different (day, period)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const aId = url.searchParams.get("a");
  const bId = url.searchParams.get("b");
  if (!aId || !bId) {
    return NextResponse.json({ error: "a and b query params required" }, { status: 400 });
  }
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const [aEntries, bEntries, aVersion, bVersion] = await Promise.all([
    db.timetableEntry.findMany({
      where: { versionId: aId },
      include: { lesson: { include: { subject: true, teacher: true, section: true, room: true } } },
    }),
    db.timetableEntry.findMany({
      where: { versionId: bId },
      include: { lesson: { include: { subject: true, teacher: true, section: true, room: true } },
      },
    }),
    db.timetableVersion.findUnique({ where: { id: aId } }),
    db.timetableVersion.findUnique({ where: { id: bId } }),
  ]);

  // Index by (lessonId, teacherId) — same lesson occurrence keyed by lesson
  const aMap = new Map(aEntries.map((e) => [e.lessonId || `duty:${e.dutyId}`, e]));
  const bMap = new Map(bEntries.map((e) => [e.lessonId || `duty:${e.dutyId}`, e]));

  const onlyA: any[] = [];
  const onlyB: any[] = [];
  const moved: any[] = [];

  for (const [key, aEntry] of aMap.entries()) {
    const bEntry = bMap.get(key);
    if (!bEntry) {
      onlyA.push({
        key,
        lessonId: aEntry.lessonId,
        subjectName: aEntry.lesson?.subject?.name,
        teacherName: aEntry.lesson?.teacher?.name,
        sectionName: aEntry.lesson?.section?.name,
        day: aEntry.day,
        period: aEntry.period,
      });
    } else if (aEntry.day !== bEntry.day || aEntry.period !== bEntry.period) {
      moved.push({
        key,
        lessonId: aEntry.lessonId,
        subjectName: aEntry.lesson?.subject?.name,
        teacherName: aEntry.lesson?.teacher?.name,
        sectionName: aEntry.lesson?.section?.name,
        from: { day: aEntry.day, period: aEntry.period },
        to: { day: bEntry.day, period: bEntry.period },
      });
    }
  }
  for (const [key, bEntry] of bMap.entries()) {
    if (!aMap.has(key)) {
      onlyB.push({
        key,
        lessonId: bEntry.lessonId,
        subjectName: bEntry.lesson?.subject?.name,
        teacherName: bEntry.lesson?.teacher?.name,
        sectionName: bEntry.lesson?.section?.name,
        day: bEntry.day,
        period: bEntry.period,
      });
    }
  }

  return NextResponse.json({
    a: aVersion ? { id: aVersion.id, version: aVersion.version, name: aVersion.name, reason: aVersion.reason } : null,
    b: bVersion ? { id: bVersion.id, version: bVersion.version, name: bVersion.name, reason: bVersion.reason } : null,
    diff: {
      onlyA,
      onlyB,
      moved,
    },
    summary: {
      totalA: aEntries.length,
      totalB: bEntries.length,
      added: onlyB.length,
      removed: onlyA.length,
      moved: moved.length,
      unchanged: aEntries.length - onlyA.length - moved.length,
    },
  });
}
