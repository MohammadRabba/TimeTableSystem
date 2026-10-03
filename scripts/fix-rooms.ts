// Fix #2 — bump lab/practical room capacities so they can fit any section.
// Labs were seeded at 25; sections range 22-29 students. Bump all labs to 35.
import { db } from "../src/lib/db";

async function main() {
  console.log("Bumping lab room capacities to 35...");
  const r = await db.room.updateMany({
    where: { type: { in: ["LABORATORY", "COMPUTER_LAB"] } },
    data: { capacity: 35 },
  });
  console.log(`✓ Updated ${r.count} lab rooms to capacity 35`);

  // Verify
  const rooms = await db.room.findMany();
  console.log("\nRoom capacities:");
  for (const r of rooms) {
    console.log(`  ${r.name.padEnd(20)} ${r.type.padEnd(15)} cap=${r.capacity}`);
  }

  // Clear stale timetable data (data changed)
  await db.timetableEntry.deleteMany({});
  await db.timetableVersion.deleteMany({});
  await db.schedulingRun.deleteMany({});
  await db.timetableChange.deleteMany({});
  console.log("\n✅ Cleared stale timetable data");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
