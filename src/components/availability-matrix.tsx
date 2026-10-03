"use client";
import { useQuery } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DayCode } from "@/lib/scheduling/engine";

const DAYS: DayCode[] = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"];
const DAY_LABELS_AR: Record<DayCode, string> = {
  SAT: "السبت", SUN: "الأحد", MON: "الاثنين", TUE: "الثلاثاء",
  WED: "الأربعاء", THU: "الخميس", FRI: "الجمعة",
};
const DAY_LABELS_EN: Record<DayCode, string> = {
  SAT: "Sat", SUN: "Sun", MON: "Mon", TUE: "Tue",
  WED: "Wed", THU: "Thu", FRI: "Fri",
};

const stateColors: Record<string, string> = {
  AVAILABLE: "bg-emerald-500 hover:bg-emerald-600",
  PREFERRED: "bg-blue-500 hover:bg-blue-600",
  UNAVAILABLE: "bg-red-500 hover:bg-red-600",
  FORBIDDEN: "bg-slate-800 hover:bg-slate-900",
};
const stateLabels: Record<string, { ar: string; en: string }> = {
  AVAILABLE: { ar: "متاح", en: "Available" },
  PREFERRED: { ar: "مفضل", en: "Preferred" },
  UNAVAILABLE: { ar: "غير متاح", en: "Unavailable" },
  FORBIDDEN: { ar: "ممنوع", en: "Forbidden" },
};

interface AvailabilityMatrixProps {
  teacherId: string;
  compact?: boolean;
}

export function AvailabilityMatrix({ teacherId, compact = false }: AvailabilityMatrixProps) {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);

  const { data } = useQuery({
    queryKey: ["avail-matrix", teacherId, activeSchoolId],
    queryFn: async () => {
      const tr = await fetch(`/api/teachers/${teacherId}`, { cache: "no-store" });
      return tr.json();
    },
    enabled: !!teacherId,
  });

  const school = data?.teacher;
  // Build slot->state map
  const slotMap: Record<string, string> = {};
  for (const a of data?.teacher?.availability || []) {
    slotMap[`${a.day}_${a.period}`] = a.state;
  }
  const daysOff = new Set((data?.teacher?.daysOff || []).map((d: any) => d.day));

  // Get school working days + periods
  const workingDays = (DAYS as DayCode[]).filter(d => !daysOff.has(d));
  const periodsPerDay = 7; // default

  const cellSize = compact ? "w-7 h-7" : "w-10 h-10";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {lang === "ar" ? "مصفوفة التوفر الأسبوعية" : "Weekly Availability Matrix"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={200}>
          <div className="inline-block">
            {/* Header row */}
            <div className="flex gap-1 mb-1">
              <div className={`${cellSize} flex items-center justify-center text-[10px] font-medium`}></div>
              {Array.from({ length: periodsPerDay }, (_, i) => (
                <div key={i} className={`${cellSize} flex items-center justify-center text-[10px] font-medium`}>
                  P{i + 1}
                </div>
              ))}
            </div>
            {/* Day rows */}
            {DAYS.map((day) => {
              const isOff = daysOff.has(day);
              return (
                <div key={day} className="flex gap-1 mb-1">
                  <div className={`${cellSize} flex items-center justify-center text-[10px] font-medium`}>
                    {lang === "ar" ? DAY_LABELS_AR[day] : DAY_LABELS_EN[day]}
                  </div>
                  {Array.from({ length: periodsPerDay }, (_, i) => {
                    const p = i + 1;
                    const sk = `${day}_${p}`;
                    const state = isOff ? "DAY_OFF" : (slotMap[sk] || "AVAILABLE");
                    let color = stateColors[state] || "bg-slate-100 dark:bg-slate-800";
                    if (isOff) color = "bg-slate-300 dark:bg-slate-700";
                    const label = isOff
                      ? (lang === "ar" ? "إجازة" : "Day off")
                      : (stateLabels[state]?.[lang] || state);
                    return (
                      <Tooltip key={p}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              `${cellSize} rounded text-white text-[9px] flex items-center justify-center cursor-default transition-colors`,
                              color
                            )}
                          >
                            {isOff ? "" : state.charAt(0)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs">
                            <div>{lang === "ar" ? DAY_LABELS_AR[day] : DAY_LABELS_EN[day]} P{p}</div>
                            <div>{label}</div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        {/* Legend */}
        <div className="flex items-center gap-3 mt-3 text-xs flex-wrap">
          {Object.entries(stateColors).map(([s, c]) => (
            <div key={s} className="flex items-center gap-1">
              <span className={`w-3 h-3 ${c.split(" ")[0]} rounded`} />
              <span>{stateLabels[s]?.[lang] || s}</span>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 bg-slate-300 dark:bg-slate-700 rounded" />
            <span>{lang === "ar" ? "إجازة" : "Day off"}</span>
          </div>
        </div>

        {/* Summary */}
        {data?.teacher && (
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">{lang === "ar" ? "النصاب المطلوب" : "Required workload"}</span>
              <span className="font-medium">{data.teacher.requiredWorkload}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{lang === "ar" ? "أقصى/يوم" : "Max/day"}</span>
              <span className="font-medium">{data.teacher.maxDailyPeriods}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{lang === "ar" ? "السابعة المطلوبة" : "Required 7th"}</span>
              <span className="font-medium">{data.teacher.requiredSeventh}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{lang === "ar" ? "أيام الإجازة" : "Days off"}</span>
              <span className="font-medium">{data.teacher._count?.daysOff || 0}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
