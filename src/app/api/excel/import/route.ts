import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, audit } from "@/lib/auth";
import ExcelJS from "exceljs";

// POST /api/excel/import
// Multipart form data with file=upload.xlsx and schoolId=xxx and entity=teachers|subjects|sections|rooms|lessons
// Parses the Excel file, validates, and returns a preview. Does NOT commit until
// the user confirms via a separate /api/excel/commit call.
export async function POST(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(s.role))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File;
  const schoolId = String(formData.get("schoolId") || s.schoolId || "");
  const entity = String(formData.get("entity") || "teachers");

  if (!file) return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
  if (!schoolId) return NextResponse.json({ error: "NO_SCHOOL" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid xlsx: ${e?.message || e}` }, { status: 400 });
  }

  const ws = wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "EMPTY_WORKBOOK" }, { status: 400 });

  // Read header row
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, col) => {
    headers[col - 1] = String(cell.value || "").trim();
  });

  // Read data rows
  const rows: any[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: any = {};
    headers.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      obj[h] = cell.value;
    });
    // Skip empty rows
    if (Object.values(obj).every(v => v === null || v === undefined || v === "")) continue;
    rows.push(obj);
  }

  // Validate + preview based on entity
  const valid: any[] = [];
  const errors: any[] = [];
  const warnings: any[] = [];

  if (entity === "teachers") {
    rows.forEach((row, idx) => {
      const name = String(row.name || row.Name || "").trim();
      const employeeNumber = String(row.employeeNumber || row.employee_number || row.code || "").trim();
      if (!name) {
        errors.push({ row: idx + 2, error: "Missing name" });
        return;
      }
      if (!employeeNumber) {
        errors.push({ row: idx + 2, error: "Missing employeeNumber" });
        return;
      }
      valid.push({
        name,
        employeeNumber,
        specialization: String(row.specialization || row.Specialization || "").trim() || null,
        email: String(row.email || row.Email || "").trim() || null,
        phone: String(row.phone || row.Phone || "").trim() || null,
        requiredWorkload: Number(row.requiredWorkload || row.workload || 24) || 24,
        maxDailyPeriods: Number(row.maxDailyPeriods || 7) || 7,
        requiredSeventh: Number(row.requiredSeventh || 0) || 0,
      });
    });
  } else if (entity === "subjects") {
    rows.forEach((row, idx) => {
      const name = String(row.name || row.Name || "").trim();
      const code = String(row.code || row.Code || "").trim();
      if (!name) { errors.push({ row: idx + 2, error: "Missing name" }); return; }
      if (!code) { errors.push({ row: idx + 2, error: "Missing code" }); return; }
      valid.push({
        name, code,
        type: String(row.type || row.Type || "THEORY").trim().toUpperCase(),
        defaultWeekly: Number(row.defaultWeekly || row.weekly || 3) || 3,
        maxPerDay: Number(row.maxPerDay || 2) || 2,
        requiredRoomType: String(row.requiredRoomType || row.roomType || "").trim() || null,
        priority: Number(row.priority || 100) || 100,
      });
    });
  } else if (entity === "sections") {
    rows.forEach((row, idx) => {
      const name = String(row.name || row.Name || "").trim();
      const code = String(row.code || row.Code || "").trim();
      const gradeId = String(row.gradeId || row.grade_id || "").trim();
      if (!name) { errors.push({ row: idx + 2, error: "Missing name" }); return; }
      if (!code) { errors.push({ row: idx + 2, error: "Missing code" }); return; }
      if (!gradeId) { errors.push({ row: idx + 2, error: "Missing gradeId" }); return; }
      valid.push({
        name, code, gradeId,
        studentCount: Number(row.studentCount || row.students || 25) || 25,
        roomId: String(row.roomId || "").trim() || null,
      });
    });
  } else if (entity === "rooms") {
    rows.forEach((row, idx) => {
      const name = String(row.name || row.Name || "").trim();
      const code = String(row.code || row.Code || "").trim();
      if (!name) { errors.push({ row: idx + 2, error: "Missing name" }); return; }
      if (!code) { errors.push({ row: idx + 2, error: "Missing code" }); return; }
      valid.push({
        name, code,
        type: String(row.type || row.Type || "CLASSROOM").trim().toUpperCase(),
        capacity: Number(row.capacity || row.Capacity || 30) || 30,
        equipment: String(row.equipment || "").trim() || null,
      });
    });
  } else if (entity === "lessons") {
    rows.forEach((row, idx) => {
      const teacherId = String(row.teacherId || row.teacher_id || "").trim();
      const subjectId = String(row.subjectId || row.subject_id || "").trim();
      const sectionId = String(row.sectionId || row.section_id || "").trim();
      if (!teacherId) { errors.push({ row: idx + 2, error: "Missing teacherId" }); return; }
      if (!subjectId) { errors.push({ row: idx + 2, error: "Missing subjectId" }); return; }
      if (!sectionId) { errors.push({ row: idx + 2, error: "Missing sectionId" }); return; }
      valid.push({
        teacherId, subjectId, sectionId,
        roomId: String(row.roomId || "").trim() || null,
        weeklyOccurrences: Number(row.weeklyOccurrences || row.weekly || 3) || 3,
        lessonType: String(row.lessonType || row.type || "THEORY").trim().toUpperCase(),
        priority: Number(row.priority || 100) || 100,
      });
    });
  } else {
    return NextResponse.json({ error: `Unknown entity: ${entity}` }, { status: 400 });
  }

  await audit({
    userId: s.id, schoolId,
    action: "IMPORT_EXCEL_PREVIEW",
    entity: entity,
    entityId: null,
    newValue: { file: file.name, valid: valid.length, errors: errors.length, warnings: warnings.length },
  });

  return NextResponse.json({
    ok: true,
    entity,
    schoolId,
    file: file.name,
    headers,
    rowCount: rows.length,
    valid: valid.length,
    errors: errors.length,
    warnings: warnings.length,
    validRows: valid.slice(0, 50), // preview first 50
    errorDetails: errors.slice(0, 20),
    warningDetails: warnings.slice(0, 20),
    // NOTE: this is a PREVIEW only. The client must call /api/excel/commit
    // with the same data to actually persist it.
  });
}
