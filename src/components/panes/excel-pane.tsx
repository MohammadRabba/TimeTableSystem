"use client";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useState } from "react";
import { Download, Loader2, FileSpreadsheet, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const SCOPES = [
  { code: "all", label_ar: "الكل (شامل)", label_en: "All (complete)" },
  { code: "school", label_ar: "نظرة المدرسة", label_en: "School overview" },
  { code: "teachers", label_ar: "جداول المعلمين", label_en: "Teachers' timetables" },
  { code: "classes", label_ar: "جداول الصفوف", label_en: "Classes' timetables" },
  { code: "rooms", label_ar: "جداول القاعات", label_en: "Rooms' timetables" },
  { code: "workload", label_ar: "نصاب المعلمين", label_en: "Teacher workload" },
  { code: "duties", label_ar: "الإشغالات", label_en: "Duties" },
  { code: "free", label_ar: "الحصص الفارغة", label_en: "Free periods" },
  { code: "conflicts", label_ar: "التعارضات", label_en: "Conflicts" },
];

export function ExcelPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const activeVersionId = useAppStore((s) => s.activeVersionId);
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);
  // Import state
  const qc = useQueryClient();
  const [importEntity, setImportEntity] = useState<string>("teachers");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);

  const { data: versionsData } = useQuery({
    queryKey: ["versions", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/versions?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const versions = versionsData?.versions || [];

  const handleExport = async () => {
    if (!activeSchoolId) {
      toast.error(lang === "ar" ? "اختر مدرسة" : "Select a school");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/excel/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: activeSchoolId,
          versionId: activeVersionId,
          scope,
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Export failed");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") || "timetable.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(lang === "ar" ? "تم التصدير" : "Exported");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <FileSpreadsheet className="w-6 h-6" /> {tr("nav_excel", lang)}
      </h1>

      <Card>
        <CardHeader><CardTitle className="text-base">{lang === "ar" ? "خيارات التصدير" : "Export Options"}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">{tr("version", lang)}</Label>
            <Select value={activeVersionId || undefined} onValueChange={(v) => useAppStore.getState().setActiveVersionId(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{versions.map((v: any) => <SelectItem key={v.id} value={v.id}>v#{v.version}{v.isCurrent ? " (current)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">{lang === "ar" ? "نطاق التصدير" : "Scope"}</Label>
            <div className="space-y-2">
              {SCOPES.map((s) => (
                <label key={s.code} className="flex items-center gap-2 cursor-pointer p-2 rounded border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <input
                    type="radio"
                    name="scope"
                    value={s.code}
                    checked={scope === s.code}
                    onChange={() => setScope(s.code)}
                  />
                  <span className="text-sm">{lang === "ar" ? s.label_ar : s.label_en}</span>
                  <Badge variant="outline" className="ms-auto text-[10px]">{s.code}</Badge>
                </label>
              ))}
            </div>
          </div>
          <Button onClick={handleExport} disabled={busy || !activeSchoolId || !activeVersionId}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {tr("export", lang)} .xlsx
          </Button>
          {!activeVersionId && (
            <div className="text-xs text-amber-600">
              {lang === "ar" ? "لا يوجد إصدار جدول. ولّد جدولاً أولاً." : "No timetable version. Generate one first."}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">{lang === "ar" ? "ما الذي سيتم تصديره:" : "What will be exported:"}</CardTitle></CardHeader>
        <CardContent>
          <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <li>• {lang === "ar" ? "نظرة عامة على المدرسة مع إحصائيات الإصدار" : "School overview sheet with version statistics"}</li>
            <li>• {lang === "ar" ? "ورقة لكل معلم تعرض جدوله الأسبوعي" : "One sheet per teacher with weekly grid"}</li>
            <li>• {lang === "ar" ? "ورقة لكل صف تعرض جدوله الأسبوعي" : "One sheet per class with weekly grid"}</li>
            <li>• {lang === "ar" ? "ورقة لكل قاعة تعرض استخدامها" : "One sheet per room with usage"}</li>
            <li>• {lang === "ar" ? "تقرير النصاب الكامل للمعلمين" : "Complete teacher workload report"}</li>
            <li>• {lang === "ar" ? "تقرير الإشغالات والتعارضات والحصص الفارغة" : "Duties, conflicts, and free-period reports"}</li>
            <li>• {lang === "ar" ? "RTL وتنسيق احترافي مع ترويسة المدرسة وأرقام الصفحات" : "RTL formatting with school header and page numbers"}</li>
          </ul>
        </CardContent>
      </Card>

      {/* === Import section === */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            {lang === "ar" ? "استيراد Excel" : "Excel Import"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-500">
            {lang === "ar"
              ? "ارفع ملف Excel لاستيراد المعلمين/المواد/الصفوف/القاعات/الحصص. سيتم عرض معاينة قبل الحفظ."
              : "Upload an Excel file to import teachers/subjects/sections/rooms/lessons. A preview is shown before committing."}
          </p>

          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <Label className="text-xs mb-1 block">{lang === "ar" ? "النوع" : "Entity"}</Label>
              <Select value={importEntity} onValueChange={setImportEntity}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="teachers">{tr("nav_teachers", lang)}</SelectItem>
                  <SelectItem value="subjects">{tr("nav_subjects", lang)}</SelectItem>
                  <SelectItem value="sections">{tr("classes", lang)}</SelectItem>
                  <SelectItem value="rooms">{tr("rooms", lang)}</SelectItem>
                  <SelectItem value="lessons">{tr("nav_lessons", lang)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">{lang === "ar" ? "الملف" : "File"}</Label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setImportFile(f || null);
                  setImportPreview(null);
                }}
                className="text-xs"
              />
            </div>
            <Button
              size="sm"
              disabled={!importFile || !activeSchoolId || importing}
              onClick={async () => {
                if (!importFile || !activeSchoolId) return;
                setImporting(true);
                setImportPreview(null);
                try {
                  const fd = new FormData();
                  fd.append("file", importFile);
                  fd.append("schoolId", activeSchoolId);
                  fd.append("entity", importEntity);
                  const r = await fetch("/api/excel/import", { method: "POST", body: fd });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.error || "Import failed");
                  setImportPreview(j);
                  if (j.errors > 0) {
                    toast.warning(lang === "ar" ? `${j.errors} صف به أخطاء` : `${j.errors} rows with errors`);
                  } else {
                    toast.success(lang === "ar" ? `معاينة: ${j.valid} صف صالح` : `Preview: ${j.valid} valid rows`);
                  }
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setImporting(false);
                }
              }}
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {lang === "ar" ? "معاينة" : "Preview"}
            </Button>
          </div>

          {/* Preview panel */}
          {importPreview && (
            <div className="border border-slate-200 dark:border-slate-800 rounded p-3 space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <Badge variant="outline">{importPreview.file}</Badge>
                <span>{importPreview.rowCount} {lang === "ar" ? "صف" : "rows"}</span>
                {importPreview.valid > 0 && (
                  <Badge variant="default" className="bg-emerald-600">
                    <CheckCircle2 className="w-3 h-3 me-1" /> {importPreview.valid} {lang === "ar" ? "صالح" : "valid"}
                  </Badge>
                )}
                {importPreview.errors > 0 && (
                  <Badge variant="destructive">
                    <AlertTriangle className="w-3 h-3 me-1" /> {importPreview.errors} {lang === "ar" ? "خطأ" : "errors"}
                  </Badge>
                )}
              </div>

              {importPreview.errorDetails?.length > 0 && (
                <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-2 max-h-32 overflow-y-auto">
                  {importPreview.errorDetails.slice(0, 10).map((e: any, i: number) => (
                    <div key={i}>Row {e.row}: {e.error}</div>
                  ))}
                </div>
              )}

              {importPreview.validRows?.length > 0 && (
                <div className="overflow-x-auto max-h-60">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Object.keys(importPreview.validRows[0]).map(k => (
                          <TableHead key={k} className="text-[10px]">{k}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.validRows.slice(0, 10).map((row: any, i: number) => (
                        <TableRow key={i}>
                          {Object.values(row).map((v: any, j: number) => (
                            <TableCell key={j} className="text-[10px] py-1">{String(v ?? "—")}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {importPreview.validRows.length > 10 && (
                    <div className="text-[10px] text-slate-500 mt-1">
                      + {importPreview.validRows.length - 10} {lang === "ar" ? "المزيد" : "more"}
                    </div>
                  )}
                </div>
              )}

              {importPreview.valid > 0 && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={importing}
                    onClick={async () => {
                      setImporting(true);
                      try {
                        const r = await fetch("/api/excel/commit", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            schoolId: activeSchoolId,
                            entity: importEntity,
                            rows: importPreview.validRows,
                          }),
                        });
                        const j = await r.json();
                        if (!r.ok) throw new Error(j.error || "Commit failed");
                        toast.success(lang === "ar" ? `تم إنشاء ${j.created} سجل` : `Created ${j.created} records`);
                        setImportPreview(null);
                        setImportFile(null);
                        qc.invalidateQueries({ queryKey: [importEntity, activeSchoolId] });
                      } catch (e: any) {
                        toast.error(e.message);
                      } finally {
                        setImporting(false);
                      }
                    }}
                  >
                    {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {lang === "ar" ? "حفظ" : "Commit"} ({importPreview.valid})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setImportPreview(null); setImportFile(null); }}>
                    {tr("cancel", lang)}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Format reference */}
          <div className="text-[11px] text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-2">
            <div className="font-medium mb-1">{lang === "ar" ? "الأعمدة المتوقعة:" : "Expected columns:"}</div>
            <div className="font-mono">
              {importEntity === "teachers" && "name, employeeNumber, specialization, email, phone, requiredWorkload, maxDailyPeriods, requiredSeventh"}
              {importEntity === "subjects" && "name, code, type, defaultWeekly, maxPerDay, requiredRoomType, priority"}
              {importEntity === "sections" && "name, code, gradeId, studentCount, roomId"}
              {importEntity === "rooms" && "name, code, type, capacity, equipment"}
              {importEntity === "lessons" && "teacherId, subjectId, sectionId, roomId, weeklyOccurrences, lessonType, priority"}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
