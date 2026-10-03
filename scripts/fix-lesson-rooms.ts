// Fix #3 — unpin roomId for lab/practical/sport/activity lessons.
// The seed pinned ALL lab lessons to a single lab (LAB-CHEM), causing
// 90 weekly occurrences to compete for 35 slots in one room.
// Setting roomId=null lets the solver distribute across all compatible rooms.
import { db } from "../src/lib/db";

async function main() {
  // Find subjects that require a special room type
  const subjects = await db.subject.findMany({
    where: { requiredRoomType: { not: null } },
  });
  const subjectIds = subjects.map((s) => s.id);
  console.log(`Found ${subjectIds.length} subjects with requiredRoomType:`);
  for (const s of subjects) {
    console.log(`  ${s.name} → ${s.requiredRoomType}`);
  }

  // Null out roomId on all lessons for these subjects
  const r = await db.lesson.updateMany({
    where: { subjectId: { in: subjectIds } },
    data: { roomId: null },
  });
  console.log(`\n✓ Unpinned roomId for ${r.count} lab/practical/sport/activity lessons`);

  // Verify distribution
  const lessons = await db.lesson.findMany({ include: { subject: true, room: true } });
  const withRoom = lessons.filter((l) => l.roomId);
  const withoutRoom = lessons.filter((l) => !l.roomId);
  console.log(`\nAfter fix:`);
  console.log(`  Lessons with explicit roomId: ${withRoom.length}`);
  console.log(`  Lessons with roomId=null (solver picks): ${withoutRoom.length}`);

  // Clear stale timetable data
  await db.timetableEntry.deleteMany({});
  await db.timetableVersion.deleteMany({});
  await db.schedulingRun.deleteMany({});
  await db.timetableChange.deleteMany({});
  console.log(`\n✅ Cleared stale timetable data`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
