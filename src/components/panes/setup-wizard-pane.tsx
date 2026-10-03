"use client";
import { useState } from "react";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, ChevronLeft, School, Calendar, Users, BookOpen, DoorOpen, ClipboardList, Settings } from "lucide-react";

const STEPS = [
  { id: "school", label_ar: "معلومات المدرسة", label_en: "School Information", icon: School },
  { id: "year", label_ar: "العام الدراسي", label_en: "Academic Year", icon: Calendar },
  { id: "grades", label_ar: "الصفوف", label_en: "Grades", icon: Users },
  { id: "subjects", label_ar: "المواد", label_en: "Subjects", icon: BookOpen },
  { id: "rooms", label_ar: "القاعات", label_en: "Rooms", icon: DoorOpen },
  { id: "teachers", label_ar: "المعلمون", label_en: "Teachers", icon: Users },
  { id: "lessons", label_ar: "الحصص", label_en: "Lessons", icon: ClipboardList },
  { id: "constraints", label_ar: "القيود", label_en: "Constraints", icon: Settings },
];

export function SetupWizardPane() {
  const lang = useLangStore((s) => s.lang);
  const setPane = useAppStore((s) => s.setPane);
  const setActiveSchoolId = useAppStore((s) => s.setActiveSchoolId);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [schoolForm, setSchoolForm] = useState({
    name: "", principalName: "", workingDays: "SUN,MON,TUE,WED,THU",
    periodsPerDay: 7, periodDuration: 45, breakDuration: 15,
    startTime: "07:30", endTime: "14:00", forbiddenSlots: "THU_7",
  });

  // Auto-detect completion state by querying counts
  const { data: completion } = useQuery({
    queryKey: ["setup-completion", activeSchoolId],
    queryFn: async () => {
      if (!activeSchoolId) return null;
      const r = await fetch(`/api/dashboard?schoolId=${activeSchoolId}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const stats = completion?.stats || {};
  const completionFlags: boolean[] = [
    !!activeSchoolId,                                    // school
    !!completion?.currentVersion || !!stats.teachers,     // year (auto-created with school)
    (stats.classes ?? 0) > 0,                              // grades (sections imply grades exist)
    (stats.subjects ?? 0) > 0,                             // subjects
    (stats.rooms ?? 0) > 0,                                // rooms
    (stats.teachers ?? 0) > 0,                              // teachers
    (stats.lessons ?? 0) > 0,                              // lessons
    true,                                                  // constraints (always "complete" - defaults work)
  ];

  const createSchool = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schoolForm),
      });
      if (!r.ok) {
        const j = await r.json();
        throw new Error(j.error || "Failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setActiveSchoolId(data.school.id);
      toast.success(lang === "ar" ? "تم إنشاء المدرسة" : "School created");
      setStep(1);
      qc.invalidateQueries({ queryKey: ["schools"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{lang === "ar" ? "معالج إعداد المدرسة" : "School Setup Wizard"}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {lang === "ar"
            ? "اتبع الخطوات لإعداد مدرستك من البداية ثم أولّد الجدول."
            : "Follow the steps to set up your school from scratch, then generate the timetable."}
        </p>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">
              {lang === "ar" ? "الخطوة" : "Step"} {step + 1} {lang === "ar" ? "من" : "of"} {STEPS.length}
            </div>
            <div className="text-xs text-slate-500">{Math.round(progress)}%</div>
          </div>
          <Progress value={progress} />
          <div className="flex items-center justify-between mt-3 overflow-x-auto">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = completionFlags[i] || i < step;
              const active = i === step;
              return (
                <button
                  key={s.id}
                  onClick={() => i <= step && setStep(i)}
                  className={`flex flex-col items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap ${active ? "text-slate-900 dark:text-white font-medium" : done ? "text-emerald-600" : "text-slate-400"}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] ${active ? "bg-slate-900 text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 dark:bg-slate-700"}`}>
                    {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                  </div>
                  <span>{lang === "ar" ? s.label_ar : s.label_en}</span>
                </button>
              );
            })}
          </div>
          {/* Completion summary */}
          {activeSchoolId && (
            <div className="text-xs text-slate-500 mt-2 flex items-center gap-4">
              <span>{lang === "ar" ? "الحالة الحالية:" : "Current state:"}</span>
              <span>🏫 {stats.teachers ?? 0} {lang === "ar" ? "معلم" : "teachers"}</span>
              <span>📚 {stats.subjects ?? 0} {lang === "ar" ? "مادة" : "subjects"}</span>
              <span>🚪 {stats.rooms ?? 0} {lang === "ar" ? "قاعة" : "rooms"}</span>
              <span>📋 {stats.lessons ?? 0} {lang === "ar" ? "حصة" : "lessons"}</span>
              <span>🎓 {stats.classes ?? 0} {lang === "ar" ? "صف" : "sections"}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {(() => {
              const Icon = STEPS[step].icon;
              return <Icon className="w-4 h-4" />;
            })()}
            {lang === "ar" ? STEPS[step].label_ar : STEPS[step].label_en}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {step === 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={tr("school_name", lang)}>
                <Input value={schoolForm.name} onChange={(e) => setSchoolForm({ ...schoolForm, name: e.target.value })} placeholder="مدرسة النجاح الثانوية" />
              </Field>
              <Field label={tr("principal", lang)}>
                <Input value={schoolForm.principalName} onChange={(e) => setSchoolForm({ ...schoolForm, principalName: e.target.value })} />
              </Field>
              <Field label={tr("periodsPerDay", lang)}>
                <Input type="number" value={schoolForm.periodsPerDay} onChange={(e) => setSchoolForm({ ...schoolForm, periodsPerDay: Number(e.target.value) })} />
              </Field>
              <Field label={tr("periodDuration", lang)}>
                <Input type="number" value={schoolForm.periodDuration} onChange={(e) => setSchoolForm({ ...schoolForm, periodDuration: Number(e.target.value) })} />
              </Field>
              <Field label={lang === "ar" ? "الحصص الممنوعة" : "Forbidden slots"}>
                <Input value={schoolForm.forbiddenSlots} onChange={(e) => setSchoolForm({ ...schoolForm, forbiddenSlots: e.target.value })} placeholder="THU_7" />
                <div className="text-[10px] text-slate-500 mt-1">
                  {lang === "ar" ? "مثال: THU_7 = الخميس له 6 حصص فقط" : "Example: THU_7 = Thursday has only 6 periods"}
                </div>
              </Field>
            </div>
          )}
          {step === 1 && (
            <div className="text-sm text-slate-600 dark:text-slate-300 space-y-2">
              <p>{lang === "ar" ? "تم إنشاء العام الدراسي تلقائياً مع المدرسة." : "An academic year is created automatically with the school."}</p>
              <p>{lang === "ar" ? "الافتراضي: 2026/2027، فصلان دراسيان." : "Default: 2026/2027, two semesters."}</p>
              <p>{lang === "ar" ? "يمكنك تعديل التفاصيل لاحقاً من صفحة المدرسة." : "You can edit details later from the School pane."}</p>
            </div>
          )}
          {step === 2 && (
            <div className="text-sm space-y-2">
              <p className="text-slate-600 dark:text-slate-300">
                {lang === "ar" ? "أضف الصفوف (مثال: الصف العاشر، الحادي عشر، الثاني عشر)." : "Add grades (e.g., Grade 10, 11, 12)."}
              </p>
              <Button variant="outline" size="sm" onClick={() => setPane("academic")}>
                {lang === "ar" ? "اذهب إلى الهيكل الأكاديمي" : "Go to Academic Structure"} →
              </Button>
            </div>
          )}
          {step === 3 && (
            <div className="text-sm space-y-2">
              <p className="text-slate-600 dark:text-slate-300">
                {lang === "ar" ? "أضف المواد مع تحديد العدد الأسبوعي ونوع الغرفة المطلوب." : "Add subjects with weekly counts and required room types."}
              </p>
              <Button variant="outline" size="sm" onClick={() => setPane("subjects")}>
                {lang === "ar" ? "اذهب إلى المواد" : "Go to Subjects"} →
              </Button>
            </div>
          )}
          {step === 4 && (
            <div className="text-sm space-y-2">
              <p className="text-slate-600 dark:text-slate-300">
                {lang === "ar" ? "أضف القاعات (غرف صفوف، مختبرات، قاعة رياضية، إلخ)." : "Add rooms (classrooms, labs, sports hall, etc.)."}
              </p>
              <Button variant="outline" size="sm" onClick={() => setPane("rooms")}>
                {lang === "ar" ? "اذهب إلى القاعات" : "Go to Rooms"} →
              </Button>
            </div>
          )}
          {step === 5 && (
            <div className="text-sm space-y-2">
              <p className="text-slate-600 dark:text-slate-300">
                {lang === "ar" ? "أضف المعلمين وحدد توفرهم الأسبوعي والمواد التي يدرسونها." : "Add teachers and set their weekly availability + subjects."}
              </p>
              <Button variant="outline" size="sm" onClick={() => setPane("teachers")}>
                {lang === "ar" ? "اذهب إلى المعلمين" : "Go to Teachers"} →
              </Button>
            </div>
          )}
          {step === 6 && (
            <div className="text-sm space-y-2">
              <p className="text-slate-600 dark:text-slate-300">
                {lang === "ar" ? "أنشئ الحصص: لكل قسم، اختر مادة + معلم + عدد أسبوعي." : "Create lessons: for each section, pick subject + teacher + weekly count."}
              </p>
              <Button variant="outline" size="sm" onClick={() => setPane("lessons")}>
                {lang === "ar" ? "اذهب إلى الحصص" : "Go to Lessons"} →
              </Button>
            </div>
          )}
          {step === 7 && (
            <div className="text-sm space-y-2">
              <p className="text-slate-600 dark:text-slate-300">
                {lang === "ar" ? "راجع القيود ثم أولّد الجدول." : "Review constraints then generate the timetable."}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPane("constraints")}>
                  {lang === "ar" ? "اذهب إلى القيود" : "Go to Constraints"} →
                </Button>
                <Button size="sm" onClick={() => setPane("schedule")}>
                  {lang === "ar" ? "توليد الجدول الآن" : "Generate Timetable Now"} →
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          <ChevronLeft className="w-4 h-4 me-1" />
          {lang === "ar" ? "السابق" : "Previous"}
        </Button>
        {step === 0 ? (
          <Button onClick={() => createSchool.mutate()} disabled={!schoolForm.name || createSchool.isPending}>
            {createSchool.isPending ? "..." : lang === "ar" ? "إنشاء المدرسة" : "Create School"}
          </Button>
        ) : step < STEPS.length - 1 ? (
          <Button onClick={() => setStep(step + 1)}>
            {lang === "ar" ? "التالي" : "Next"}
            <ChevronRight className="w-4 h-4 ms-1" />
          </Button>
        ) : (
          <Button onClick={() => setPane("schedule")}>
            {lang === "ar" ? "توليد الجدول" : "Generate Timetable"}
            <ChevronRight className="w-4 h-4 ms-1" />
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs mb-1 block">{label}</Label>
      {children}
    </div>
  );
}
