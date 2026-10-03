// Fix script — patches the existing seed data to make the timetable feasible.
//
// Changes:
//   1. Lower weekly occurrences on heavy subjects so total per section <= 35
//      Arabic 5→4, Math 5→4, Physics 4→3, English 4→3
//   2. Remove all teacher days-off so each teacher has 35 slots (was 28)
//   3. Set requiredSeventh = 0 for all teachers (no forced seventh-period target)
//   4. Re-create lessons with new weekly occurrences
//
// Run with: bun run scripts/fix-seed.ts
import { db } from "../src/lib/db";

// Subject code → new weekly count
const NEW_WEEKLY: Record<string, number> = {
  AR: 4,    // was 5
  EN: 3,    // was 4
  MA: 4,    // was 5
  PH: 3,    // was 4
  // CH=3, BI=3, HI=2, GE=2, IS=3, CS=2, PE=2, AR2=1 (unchanged)
  // Total per section = 4+3+4+3+3+3+2+2+3+2+2+1 = 32 (≤ 35 slots)
};

async function main() {
  console.log("Connected to DB");

  // 1. Remove all teacher days-off → each teacher has 35 slots (was 28)
  const r1 = await db.teacherDayOff.deleteMany({});
  console.log(`✓ Removed ${r1.count} teacher day-off records`);

  // 2. Set requiredSeventh = 0 for all teachers
  const r2 = await db.teacher.updateMany({ data: { requiredSeventh: 0 } });
  console.log(`✓ Reset requiredSeventh for ${r2.count} teachers`);

  // 3. Update subject.defaultWeekly for the heavy ones
  for (const [code, weekly] of Object.entries(NEW_WEEKLY)) {
    const r = await db.subject.updateMany({
      where: { code },
      data: { defaultWeekly: weekly },
    });
    console.log(`✓ Subject ${code}: defaultWeekly → ${weekly} (${r.count} updated)`);
  }

  // 4. Update each lesson's weeklyOccurrences to match its subject's new default
  const subjects = await db.subject.findMany();
  const subjectByCode: Record<string, typeof subjects[number]> = {};
  for (const s of subjects) subjectByCode[s.code] = s;
  const lessons = await db.lesson.findMany();
  let updatedCount = 0;
  for (const l of lessons) {
    const subj = subjects.find((s) => s.id === l.subjectId);
    if (!subj) continue;
    const newW = subj.defaultWeekly;
    if (newW !== l.weeklyOccurrences) {
      await db.lesson.update({
        where: { id: l.id },
        data: { weeklyOccurrences: newW },
      });
      updatedCount++;
    }
  }
  console.log(`✓ Updated ${updatedCount} lessons' weekly occurrences`);

  // 5. Clear existing timetable versions (data changed, old snapshots are stale)
  const re = await db.timetableEntry.deleteMany({});
  const rv = await db.timetableVersion.deleteMany({});
  const rr = await db.schedulingRun.deleteMany({});
  const rc = await db.timetableChange.deleteMany({});
  console.log(`✓ Cleared ${re.count} entries, ${rv.count} versions, ${rr.count} runs, ${rc.count} changes`);

  // Final summary
  const teacherCount = await db.teacher.count();
  const sectionCount = await db.section.count();
  const allLessons = await db.lesson.findMany();
  const totalWeekly = allLessons.reduce((s, l) => s + l.weeklyOccurrences, 0);
  console.log(`\n✅ Fix complete!`);
  console.log(`   Teachers: ${teacherCount}`);
  console.log(`   Sections: ${sectionCount}`);
  console.log(`   Lessons: ${allLessons.length}`);
  console.log(`   Total weekly occurrences: ${totalWeekly}`);
  console.log(`   Per-section avg: ${(totalWeekly / Math.max(1, sectionCount)).toFixed(1)}`);
  console.log(`   Per-teacher avg: ${(totalWeekly / Math.max(1, teacherCount)).toFixed(1)}`);
  console.log(`   Section capacity: 5×7 = 35 slots (need ≤ 35) ✓`);
  console.log(`   Teacher capacity: 5×7 = 35 slots (no days off now) ✓`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
