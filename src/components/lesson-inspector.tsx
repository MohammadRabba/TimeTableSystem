"use client";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Lock, Unlock, AlertTriangle, User, BookOpen, DoorOpen, Calendar, UserCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

export interface InspectorEntry {
  occurrenceId: string;
  lessonId: string;
  occurrenceNumber: number;
  teacherId: string;
  teacherName?: string;
  subjectId: string;
  subjectName?: string;
  sectionId: string;
  sectionName?: string;
  roomId?: string | null;
  roomName?: string;
  day: string;
  period: number;
  cellType: string;
  fixed: boolean;
  locked: boolean;
  versionId?: string;
  entryId?: string;
}

interface LessonInspectorProps {
  entry: InspectorEntry | null;
  warning?: string | null;
  onClose: () => void;
  onToggleLock?: (id: string, locked: boolean) => void;
  onMove?: () => void;
  onSwap?: () => void;
  onDelete?: () => void;
}

export function LessonInspector({ entry, warning, onClose, onToggleLock, onMove, onSwap, onDelete }: LessonInspectorProps) {
  const lang = useLangStore((s) => s.lang);
  const setPane = useAppStore((s) => s.setPane);
  const setActiveTeacherId = useAppStore((s) => s.setActiveTeacherId);
  const setActiveSectionId = useAppStore((s) => s.setActiveSectionId);
  const setActiveRoomId = useAppStore((s) => s.setActiveRoomId);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const [showTeacherSwap, setShowTeacherSwap] = useState(false);
  const [selectedTeacher, setSelectedTeacher] = useState<string>("");
  const [swapResult, setSwapResult] = useState<any | null>(null);

  // Fetch teachers list for swap dropdown
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/teachers?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId && showTeacherSwap,
  });
  const teachers = teachersData?.teachers || [];

  const swapTeacherMutation = useMutation({
    mutationFn: async ({ newTeacherId, apply }: { newTeacherId: string; apply: boolean }) => {
      if (!entry?.entryId || !entry?.versionId) return null;
      const r = await fetch("/api/timetable/swap-teacher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId: entry.entryId,
          newTeacherId,
          versionId: entry.versionId,
          apply,
        }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      setSwapResult(data);
      if (data?.applied) {
        toast.success(lang === "ar" ? "تم تبديل المعلم" : "Teacher swapped");
        qc.invalidateQueries({ queryKey: ["entries"] });
        setShowTeacherSwap(false);
        setSwapResult(null);
      } else if (data?.canSwap) {
        toast.info(lang === "ar" ? "التبديل صالح — اضغط تطبيق" : "Swap is valid — click Apply");
      } else if (data?.conflicts?.length > 0) {
        toast.error(lang === "ar" ? `تعارض: ${data.conflicts[0].message}` : `Conflict: ${data.conflicts[0].message}`);
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!entry) return null;

  const isDuty = ["DUTY", "SUPERVISION", "RESERVE"].includes(entry.cellType);

  return (
    <div className="absolute top-0 end-0 h-full w-80 bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 shadow-lg z-30 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-800">
        <div className="font-semibold text-sm flex items-center gap-2">
          {isDuty ? tr("duty", lang) : tr("nav_lessons", lang)}
          <Badge variant="outline" className="text-[10px]">{entry.cellType}</Badge>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {/* Warning */}
        {warning && (
          <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 rounded p-2 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>{warning}</div>
          </div>
        )}

        {/* Subject / Duty title */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            {isDuty ? tr("duty", lang) : tr("subjects", lang)}
          </div>
          <div className="font-semibold">
            {entry.subjectName || entry.lessonId || entry.cellType}
          </div>
        </div>

        {/* Day / Period */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {tr("nav_timetable", lang)}
          </div>
          <div className="font-mono text-xs">
            {entry.day} · P{entry.period}
          </div>
        </div>

        {/* Teacher */}
        {entry.teacherId && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <User className="w-3 h-3" /> {tr("nav_teachers", lang)}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                className="text-xs text-blue-600 hover:underline flex-1 text-start truncate"
                onClick={() => {
                  setActiveTeacherId(entry.teacherId);
                  setPane("timetable");
                }}
              >
                {entry.teacherName || entry.teacherId}
              </button>
              {!entry.fixed && !isDuty && entry.entryId && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setShowTeacherSwap(!showTeacherSwap)}
                >
                  <UserCheck className="w-3 h-3" />
                  {lang === "ar" ? "تبديل" : "Swap"}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Teacher swap panel */}
        {showTeacherSwap && (
          <div className="border border-slate-200 dark:border-slate-800 rounded p-2 space-y-2 bg-slate-50 dark:bg-slate-950">
            <div className="text-[10px] font-medium">{lang === "ar" ? "اختر معلم جديد:" : "Select new teacher:"}</div>
            <select
              className="w-full text-xs border border-slate-300 dark:border-slate-700 rounded p-1 bg-white dark:bg-slate-900"
              value={selectedTeacher}
              onChange={(e) => {
                setSelectedTeacher(e.target.value);
                setSwapResult(null);
              }}
            >
              <option value="">—</option>
              {teachers.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {selectedTeacher && selectedTeacher !== entry.teacherId && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] h-7"
                  disabled={swapTeacherMutation.isPending}
                  onClick={() => swapTeacherMutation.mutate({ newTeacherId: selectedTeacher, apply: false })}
                >
                  {lang === "ar" ? "فحص" : "Check"}
                </Button>
                <Button
                  size="sm"
                  className="text-[10px] h-7"
                  disabled={swapTeacherMutation.isPending || (swapResult && !swapResult.canSwap)}
                  onClick={() => swapTeacherMutation.mutate({ newTeacherId: selectedTeacher, apply: true })}
                >
                  {lang === "ar" ? "تطبيق" : "Apply"}
                </Button>
              </div>
            )}
            {swapResult?.conflicts?.length > 0 && (
              <div className="space-y-1">
                {swapResult.conflicts.map((c: any, i: number) => (
                  <div key={i} className={`text-[10px] p-1 rounded ${c.severity === "CRITICAL" ? "text-red-600 bg-red-50 dark:bg-red-950" : "text-amber-600 bg-amber-50 dark:bg-amber-950"}`}>
                    {c.severity}: {c.message}
                  </div>
                ))}
              </div>
            )}
            {swapResult?.canSwap && !swapResult?.applied && (
              <div className="text-[10px] text-emerald-600">
                {lang === "ar" ? "✓ التبديل صالح" : "✓ Swap is valid"}
              </div>
            )}
          </div>
        )}

        {/* Section */}
        {entry.sectionId && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
              {tr("classes", lang)}
            </div>
            <button
              className="text-xs text-blue-600 hover:underline"
              onClick={() => {
                setActiveSectionId(entry.sectionId);
                setPane("timetable");
              }}
            >
              {entry.sectionName || entry.sectionId}
            </button>
          </div>
        )}

        {/* Room */}
        {entry.roomId && (
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5 flex items-center gap-1">
              <DoorOpen className="w-3 h-3" /> {tr("rooms", lang)}
            </div>
            <button
              className="text-xs text-blue-600 hover:underline"
              onClick={() => {
                setActiveRoomId(entry.roomId!);
                setPane("timetable");
              }}
            >
              {entry.roomName || entry.roomId}
            </button>
          </div>
        )}

        {/* Occurrence info */}
        {!isDuty && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
              {lang === "ar" ? "رقم الحصة" : "Occurrence"}
            </div>
            <div className="text-xs font-mono">#{entry.occurrenceNumber}</div>
          </div>
        )}

        {/* Lock status */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2">
          <div>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-0.5">
              {tr("locked", lang)}
            </div>
            <div className="text-xs">
              {entry.locked ? (
                <Badge variant="destructive" className="text-[10px]">
                  <Lock className="w-3 h-3 me-1" /> {tr("locked", lang)}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  <Unlock className="w-3 h-3 me-1" /> {tr("free", lang)}
                </Badge>
              )}
              {entry.fixed && (
                <Badge variant="secondary" className="ms-1 text-[10px]">FIXED</Badge>
              )}
            </div>
          </div>
          {onToggleLock && !entry.fixed && (
            <Button
              size="sm"
              variant={entry.locked ? "outline" : "default"}
              onClick={() => onToggleLock(entry.lessonId, !entry.locked)}
            >
              {entry.locked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {entry.locked ? tr("unlock", lang) : tr("lock", lang)}
            </Button>
          )}
        </div>
      </div>

      {/* Actions footer */}
      {!entry.fixed && (
        <div className="border-t border-slate-200 dark:border-slate-800 p-3 flex flex-wrap gap-2">
          {onMove && <Button size="sm" variant="outline" onClick={onMove} className="flex-1">{tr("edit", lang)}</Button>}
          {onSwap && <Button size="sm" variant="outline" onClick={onSwap} className="flex-1">{tr("swap", lang)}</Button>}
          {onDelete && <Button size="sm" variant="outline" onClick={onDelete} className="text-red-600">{tr("delete", lang)}</Button>}
        </div>
      )}
    </div>
  );
}
