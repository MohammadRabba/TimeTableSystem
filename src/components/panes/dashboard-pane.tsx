"use client";
import { useQuery } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users, GraduationCap, BookOpen, DoorOpen, CalendarDays,
  AlertTriangle, Gauge, Calendar, Wand2, Play, CheckCircle2, XCircle,
} from "lucide-react";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from "recharts";

export function DashboardPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const setPane = useAppStore((s) => s.setPane);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard${activeSchoolId ? `?schoolId=${activeSchoolId}` : ""}`, { cache: "no-store" });
      return r.json();
    },
  });

  if (isLoading || !data) {
    return <div className="p-6 text-slate-500">{tr("loading", lang)}</div>;
  }

  const s = data.stats || {};
  const school = data.school;
  const cur = data.currentVersion;
  const placementRatio = s.lessons ? Math.round((s.scheduled / s.lessons) * 100) : 0;
  const qualityColor = s.qualityScore >= 80 ? "text-emerald-600" : s.qualityScore >= 50 ? "text-amber-600" : "text-red-600";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">{school?.name || tr("dashboard_title", lang)}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {school?.principalName && `${tr("principal", lang)}: ${school.principalName}`}
            {school?.currentSemester && ` · ${tr("semester", lang)}: ${school.currentSemester}`}
            {school && ` · ${tr("academicYear", lang)}: 2026/2027`}
          </p>
        </div>
        {cur && (
          <Badge variant="secondary" className="text-sm">
            {tr("version", lang)} #{cur.version} · {cur.name}
          </Badge>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard icon={Users} label={tr("teachers", lang)} value={s.teachers ?? 0} onClick={() => setPane("teachers")} />
        <StatCard icon={GraduationCap} label={tr("classes", lang)} value={s.classes ?? 0} onClick={() => setPane("academic")} />
        <StatCard icon={BookOpen} label={tr("subjects", lang)} value={s.subjects ?? 0} onClick={() => setPane("subjects")} />
        <StatCard icon={DoorOpen} label={tr("rooms", lang)} value={s.rooms ?? 0} onClick={() => setPane("rooms")} />
        <StatCard icon={CalendarDays} label={tr("lessons", lang)} value={s.lessons ?? 0} onClick={() => setPane("lessons")} />
        <StatCard icon={AlertTriangle} label={tr("conflicts", lang)} value={s.conflicts ?? 0} onClick={() => setPane("conflicts")} alert={(s.conflicts ?? 0) > 0} />
      </div>

      {/* Quality & balance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="w-4 h-4" /> {tr("quality", lang)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{s.qualityScore ?? 0}%</div>
            <Progress value={s.qualityScore ?? 0} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {tr("scheduled", lang)}: {s.scheduled ?? 0} / {s.lessons ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{tr("workload_balance", lang)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">
              {s.lessons && s.teachers ? Math.round((s.scheduled / Math.max(1, s.lessons)) * 100) : 0}%
            </div>
            <Progress value={s.lessons ? (s.scheduled / Math.max(1, s.lessons)) * 100 : 0} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {s.teachers ?? 0} {tr("teachers", lang)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4" /> {tr("recent_runs", lang)}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 max-h-40 overflow-y-auto">
            {(data.recentRuns || []).length === 0 && (
              <div className="text-xs text-slate-500">{tr("noData", lang)}</div>
            )}
            {(data.recentRuns || []).slice(0, 5).map((r: any) => (
              <div key={r.id} className="text-xs flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 py-1">
                <span className="font-mono">{r.mode}</span>
                <Badge variant={r.status === "COMPLETED" ? "default" : r.status === "FAILED" ? "destructive" : "secondary"}>
                  {r.status}
                </Badge>
                {r.qualityScore != null && <span className="text-slate-500">{r.qualityScore}%</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Placement + Quality widgets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> {lang === "ar" ? "نسبة الجدولة" : "Placement"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${placementRatio === 100 ? "text-emerald-600" : placementRatio > 0 ? "text-amber-600" : "text-red-600"}`}>
              {placementRatio}%
            </div>
            <Progress value={placementRatio} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {s.scheduled ?? 0} / {s.lessons ?? 0} {lang === "ar" ? "حصة مجدولة" : "scheduled"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="w-4 h-4" /> {tr("quality", lang)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${qualityColor}`}>{s.qualityScore ?? 0}%</div>
            <Progress value={s.qualityScore ?? 0} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {s.conflicts ?? 0} {tr("conflicts", lang)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {tr("nav_conflicts", lang)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${(s.conflicts ?? 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {s.conflicts ?? 0}
            </div>
            <Progress value={Math.min(100, (s.conflicts ?? 0) * 10)} className="mt-2" />
            <div className="text-xs text-slate-500 mt-2">
              {lang === "ar" ? "تعارضات صلبة" : "hard conflicts"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Button variant="outline" className="h-20 flex flex-col gap-1" onClick={() => setPane("setup")}>
          <Wand2 className="w-5 h-5" />
          <span className="text-xs">{lang === "ar" ? "معالج إعداد مدرسة جديدة" : "Setup new school"}</span>
        </Button>
        <Button variant="outline" className="h-20 flex flex-col gap-1" onClick={() => setPane("schedule")}>
          <Play className="w-5 h-5" />
          <span className="text-xs">{tr("generate", lang)}</span>
        </Button>
        <Button variant="outline" className="h-20 flex flex-col gap-1" onClick={() => setPane("timetable")}>
          <Calendar className="w-5 h-5" />
          <span className="text-xs">{tr("nav_timetable", lang)}</span>
        </Button>
        <Button variant="outline" className="h-20 flex flex-col gap-1" onClick={() => setPane("reports")}>
          <Gauge className="w-5 h-5" />
          <span className="text-xs">{tr("nav_reports", lang)}</span>
        </Button>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Placement donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{lang === "ar" ? "توزيع الجدولة" : "Scheduling Breakdown"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: lang === "ar" ? "مجدولة" : "Scheduled", value: s.scheduled ?? 0, color: "#10b981" },
                      { name: lang === "ar" ? "غير مجدولة" : "Unscheduled", value: Math.max(0, (s.lessons ?? 0) - (s.scheduled ?? 0)), color: "#ef4444" },
                    ].filter(d => d.value > 0)}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    innerRadius={35}
                    label={(entry: any) => `${entry.value}`}
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center text-xs text-slate-500 mt-1">
              {s.scheduled ?? 0} / {s.lessons ?? 0} {lang === "ar" ? "حصة" : "lessons"}
            </div>
          </CardContent>
        </Card>

        {/* Quality radial gauge */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{tr("quality", lang)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  innerRadius="60%"
                  outerRadius="100%"
                  data={[{ name: "quality", value: s.qualityScore ?? 0, fill: (s.qualityScore ?? 0) >= 80 ? "#10b981" : (s.qualityScore ?? 0) >= 50 ? "#f59e0b" : "#ef4444" }]}
                  startAngle={90}
                  endAngle={-270}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar background dataKey="value" cornerRadius={10} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center -mt-12 mb-2">
              <div className={`text-2xl font-bold ${qualityColor}`}>{s.qualityScore ?? 0}%</div>
            </div>
          </CardContent>
        </Card>

        {/* Conflicts bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{lang === "ar" ? "التعارضات حسب النوع" : "Conflicts by Type"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: lang === "ar" ? "معلم" : "Teacher", count: 0, fill: "#ef4444" },
                    { name: lang === "ar" ? "صف" : "Class", count: 0, fill: "#f59e0b" },
                    { name: lang === "ar" ? "قاعة" : "Room", count: 0, fill: "#3b82f6" },
                    { name: lang === "ar" ? "توفر" : "Avail.", count: 0, fill: "#8b5cf6" },
                    { name: lang === "ar" ? "أخرى" : "Other", count: s.conflicts ?? 0, fill: "#6b7280" },
                  ]}
                  margin={{ top: 10, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick action: Generate timetable */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tr("nav_schedule", lang)}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500 mb-3">
            {lang === "ar"
              ? "اضغط زر توليد الجدول لإنشاء جدول مدرسي كامل باستخدام محرك القيود. سيتم تطبيق القيود الصلبة أولاً ثم تحسين الجودة."
              : "Click Generate to create a complete school timetable using the constraint engine. Hard constraints are enforced first, then quality is optimized."}
          </p>
          <button
            onClick={() => setPane("schedule")}
            className="text-sm px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-700"
          >
            {tr("generate", lang)} →
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, alert, onClick }: { icon: any; label: string; value: number; alert?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-start rounded-lg border p-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${alert ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950" : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"}`}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-5 h-5 ${alert ? "text-red-600" : "text-slate-500"}`} />
        {alert && value > 0 && <Badge variant="destructive" className="text-[10px]">{value}</Badge>}
      </div>
      <div className={`text-2xl font-bold ${alert ? "text-red-700 dark:text-red-300" : ""}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </button>
  );
}
