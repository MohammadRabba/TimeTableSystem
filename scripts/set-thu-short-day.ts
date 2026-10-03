// Set forbiddenSlots="THU_7" for the demo school so Thursday has only 6 periods.
import { db } from "../src/lib/db";

async function main() {
  const school = await db.school.findFirst();
  if (!school) {
    console.log("No school found");
    return;
  }
  console.log(`School: ${school.name}`);
  console.log(`Current forbiddenSlots: "${school.forbiddenSlots || ""}"`);

  const updated = await db.school.update({
    where: { id: school.id },
    data: { forbiddenSlots: "THU_7" },
  });
  console.log(`✓ Set forbiddenSlots = "${updated.forbiddenSlots}"`);
  console.log(`  → Thursday now has only 6 periods (period 7 is forbidden)`);

  // Clear stale timetable data (constraint changed, old snapshots invalid)
  await db.timetableEntry.deleteMany({});
  await db.timetableVersion.deleteMany({});
  await db.schedulingRun.deleteMany({});
  await db.timetableChange.deleteMany({});
  console.log("✅ Cleared stale timetable data");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
