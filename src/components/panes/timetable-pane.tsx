"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr, DAY_LABELS, type Lang } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useMemo, useState, useEffect } from "react";
import { LessonInspector, type InspectorEntry } from "@/components/lesson-inspector";
import {
  DndContext, DragEndEvent, DragStartEvent, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import { Undo2, Redo2, Lock, Unlock, GripVertical, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DayCode } from "@/lib/scheduling/engine";

type ViewKind = "school" | "teacher" | "class" | "room" | "subject";

export function TimetablePane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const activeTeacherId = useAppStore((s) => s.activeTeacherId);
  const activeSectionId = useAppStore((s) => s.activeSectionId);
  const activeRoomId = useAppStore((s) => s.activeRoomId);
  const activeSubjectId = useAppStore((s) => s.activeSubjectId);
  const setActiveTeacherId = useAppStore((s) => s.setActiveTeacherId);
  const setActiveSectionId = useAppStore((s) => s.setActiveSectionId);
  const setActiveRoomId = useAppStore((s) => s.setActiveRoomId);
  const setActiveSubjectId = useAppStore((s) => s.setActiveSubjectId);
  const activeVersionId = useAppStore((s) => s.activeVersionId);
  const setActiveVersionId = useAppStore((s) => s.setActiveVersionId);

  const [view, setView] = useState<ViewKind>("school");
  const [inspectorEntry, setInspectorEntry] = useState<InspectorEntry | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [compareAId, setCompareAId] = useState<string>("");
  const [compareBId, setCompareBId] = useState<string>("");

  // Fetch school for workingDays + periods
  const { data: schoolData } = useQuery({
    queryKey: ["school", activeSchoolId],
    queryFn: async () => {
      if (!activeSchoolId) return null;
      const r = await fetch(`/api/schools/${activeSchoolId}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const school = schoolData?.school;

  // Versions
  const { data: versionsData } = useQuery({
    queryKey: ["versions", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/versions?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const versions = versionsData?.versions || [];

  // Set active version to current
  useEffect(() => {
    if (!activeVersionId && versions.length > 0) {
      const cur = versions.find((v: any) => v.isCurrent) || versions[0];
      setActiveVersionId(cur.id);
    }
  }, [versions, activeVersionId, setActiveVersionId]);

  // Teachers/Sections/Rooms/Subjects dropdowns
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/teachers?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: sectionsData } = useQuery({
    queryKey: ["sections", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/sections?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: roomsData } = useQuery({
    queryKey: ["rooms", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/rooms?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: subjectsData } = useQuery({
    queryKey: ["subjects", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/subjects?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const teachers = teachersData?.teachers || [];
  const sections = sectionsData?.sections || [];
  const rooms = roomsData?.rooms || [];
  const subjects = subjectsData?.subjects || [];

  // Fetch entries for the current view
  const entriesQuery = useQuery({
    queryKey: ["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId],
    queryFn: async () => {
      if (!activeVersionId) return { entries: [] };
      const p = new URLSearchParams({ versionId: activeVersionId });
      if (view === "teacher" && activeTeacherId) p.set("teacherId", activeTeacherId);
      if (view === "class" && activeSectionId) p.set("sectionId", activeSectionId);
      if (view === "room" && activeRoomId) p.set("roomId", activeRoomId);
      if (view === "subject" && activeSubjectId) p.set("subjectId", activeSubjectId);
      const r = await fetch(`/api/timetable/entries?${p}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeVersionId,
  });

  const entries = entriesQuery.data?.entries || [];

  // DnD setup
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const qc = useQueryClient();
  const moveMutation = useMutation({
    mutationFn: async ({ entryId, day, period }: { entryId: string; day: DayCode; period: number }) => {
      const r = await fetch("/api/timetable/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, day, period, versionId: activeVersionId }),
      });
      return r.json();
    },
    onMutate: async ({ entryId, day, period }) => {
      // Optimistic update
      await qc.cancelQueries({ queryKey: ["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId] });
      const prev = qc.getQueryData<any>(["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId]);
      if (prev) {
        const newEntries = prev.entries.map((e: any) => e.id === entryId ? { ...e, day, period } : e);
        qc.setQueryData(["entries", activeVersionId, view, activeTeacherId, activeSectionId, activeRoomId, activeSubjectId], { ...prev, entries: newEntries });
      }
      return { prev };
    },
    onSuccess: (data) => {
      if (data.conflict) {
        toast.error(`${lang === "ar" ? "تعارض" : "Conflict"}: ${data.conflicts?.[0]?.message || "Cannot move there"}`);
        qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
      } else {
        toast.success(lang === "ar" ? "تم النقل" : "Moved");
      }
    },
    onError: (_e: any, _v: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["entries", activeVersionId], ctx.prev);
      toast.error("Move failed");
    },
  });

  const lockMutation = useMutation({
    mutationFn: async ({ entryId, locked }: { entryId: string; locked: boolean }) => {
      const r = await fetch("/api/timetable/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId, locked }),
      });
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم التحديث" : "Updated");
      qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
    },
  });

  const undoMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/timetable/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: activeVersionId }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(lang === "ar" ? "تراجع" : "Undone");
        qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
      } else {
        toast.error(lang === "ar" ? "لا يوجد شيء للتراجع" : "Nothing to undo");
      }
    },
  });
  const redoMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/timetable/redo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: activeVersionId }),
      });
      return r.json();
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(lang === "ar" ? "أعيد" : "Redone");
        qc.invalidateQueries({ queryKey: ["entries", activeVersionId] });
      } else {
        toast.error(lang === "ar" ? "لا يوجد شيء للإعادة" : "Nothing to redo");
      }
    },
  });

  const workingDays = useMemo(() => {
    if (!school) return ["SUN", "MON", "TUE", "WED", "THU"] as DayCode[];
    return (school.workingDays || "SUN,MON,TUE,WED,THU").split(",").filter(Boolean) as DayCode[];
  }, [school]);
  const periodsPerDay = school?.periodsPerDay || 7;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const dragId = String(active.id);
    const dropId = String(over.id);
    // dropId is `DAY_PERIOD`
    const [day, period] = dropId.split("_");
    moveMutation.mutate({ entryId: dragId, day: day as DayCode, period: Number(period) });
  };

  if (!activeSchoolId) {
    return <div className="p-6 text-slate-500">{lang === "ar" ? "اختر مدرسة" : "Select a school"}</div>;
  }
  if (!activeVersionId) {
    return (
      <div className="p-6 space-y-3">
        <h1 className="text-2xl font-bold">{tr("nav_timetable", lang)}</h1>
        <Card>
          <CardContent className="p-6 text-center text-sm text-slate-500">
            {lang === "ar" ? "لا يوجد جدول بعد. اذهب لتوليد جدول جديد." : "No timetable yet. Generate one first."}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">{tr("nav_timetable", lang)}</h1>
        <div className="flex items-center gap-2">
          <Select value={activeVersionId || undefined} onValueChange={setActiveVersionId}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{versions.map((v: any) => <SelectItem key={v.id} value={v.id}>v#{v.version} {v.isCurrent ? "(current)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <Button id="btn-undo" variant="outline" size="icon" onClick={() => undoMutation.mutate()} title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button id="btn-redo" variant="outline" size="icon" onClick={() => redoMutation.mutate()} title="Redo (Ctrl+Y)">
            <Redo2 className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCompare(!showCompare)}>
            {lang === "ar" ? "مقارنة الإصدارات" : "Compare versions"}
          </Button>
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as ViewKind)}>
        <TabsList>
          <TabsTrigger value="school">{tr("school_view", lang)}</TabsTrigger>
          <TabsTrigger value="teacher">{tr("teacher_view", lang)}</TabsTrigger>
          <TabsTrigger value="class">{tr("class_view", lang)}</TabsTrigger>
          <TabsTrigger value="room">{tr("room_view", lang)}</TabsTrigger>
          <TabsTrigger value="subject">{tr("subject_view", lang)}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Compare panel */}
      {showCompare && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{lang === "ar" ? "مقارنة الإصدارات" : "Version Comparison"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={compareAId} onValueChange={setCompareAId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Version A" /></SelectTrigger>
                <SelectContent>{versions.map((v: any) => <SelectItem key={v.id} value={v.id}>v#{v.version}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-xs">↔</span>
              <Select value={compareBId} onValueChange={setCompareBId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Version B" /></SelectTrigger>
                <SelectContent>{versions.map((v: any) => <SelectItem key={v.id} value={v.id}>v#{v.version}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {compareAId && compareBId && compareAId !== compareBId && (
              <ComparisonView aId={compareAId} bId={compareBId} lang={lang} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Entity selectors */}
      <div className="flex items-center gap-2 flex-wrap">
        {view === "teacher" && (
          <Select value={activeTeacherId || undefined} onValueChange={setActiveTeacherId}>
            <SelectTrigger className="w-64"><SelectValue placeholder={tr("nav_teachers", lang)} /></SelectTrigger>
            <SelectContent>{teachers.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {view === "class" && (
          <Select value={activeSectionId || undefined} onValueChange={setActiveSectionId}>
            <SelectTrigger className="w-48"><SelectValue placeholder={tr("classes", lang)} /></SelectTrigger>
            <SelectContent>{sections.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {view === "room" && (
          <Select value={activeRoomId || undefined} onValueChange={setActiveRoomId}>
            <SelectTrigger className="w-48"><SelectValue placeholder={tr("rooms", lang)} /></SelectTrigger>
            <SelectContent>{rooms.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {view === "subject" && (
          <Select value={activeSubjectId || undefined} onValueChange={setActiveSubjectId}>
            <SelectTrigger className="w-48"><SelectValue placeholder={tr("subjects", lang)} /></SelectTrigger>
            <SelectContent>{subjects.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="relative flex">
          <div className="flex-1 overflow-x-auto">
            <TimetableGrid
              entries={entries}
              workingDays={workingDays}
              periodsPerDay={periodsPerDay}
              lang={lang}
              view={view}
              onToggleLock={(id, locked) => lockMutation.mutate({ entryId: id, locked })}
              onClick={(e) => {
                // Build inspector entry from the raw entry
                setInspectorEntry({
                  occurrenceId: e.id,
                  entryId: e.id,
                  versionId: activeVersionId || undefined,
                  lessonId: e.lessonId || e.dutyId || "",
                  occurrenceNumber: 1,
                  teacherId: e.teacherId || "",
                  teacherName: e.lesson?.teacher?.name || e.teacher?.name,
                  subjectId: e.subjectId || "",
                  subjectName: e.lesson?.subject?.name || e.subject?.name,
                  sectionId: e.sectionId || "",
                  sectionName: e.lesson?.section?.name || e.section?.name,
                  roomId: e.roomId || null,
                  roomName: e.lesson?.room?.name || e.room?.name,
                  day: e.day,
                  period: e.period,
                  cellType: e.cellType,
                  fixed: e.fixed || false,
                  locked: e.locked || false,
                });
              }}
            />
          </div>
          {inspectorEntry && (
            <LessonInspector
              entry={inspectorEntry}
              onClose={() => setInspectorEntry(null)}
              onToggleLock={(id, locked) => {
                lockMutation.mutate({ entryId: id, locked });
                setInspectorEntry({ ...inspectorEntry, locked });
              }}
            />
          )}
        </div>
      </DndContext>

      <style jsx>{`
        .tt-grid {
          display: grid;
          grid-template-columns: 100px repeat(${periodsPerDay}, minmax(140px, 1fr));
          gap: 2px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}

function TimetableGrid({
  entries, workingDays, periodsPerDay, lang, view, onToggleLock, onClick,
}: {
  entries: any[];
  workingDays: DayCode[];
  periodsPerDay: number;
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
  onClick?: (entry: any) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div style={{ display: "grid", gridTemplateColumns: `100px repeat(${periodsPerDay}, minmax(160px, 1fr))`, gap: "3px", fontSize: "12px" }}>
        {/* Header row */}
        <div className="bg-slate-900 text-white p-1.5 font-medium text-center">{tr("name", lang)}/Period</div>
        {Array.from({ length: periodsPerDay }, (_, i) => (
          <div key={i} className="bg-slate-900 text-white p-1.5 font-medium text-center">P{i + 1}</div>
        ))}

        {/* Body rows */}
        {workingDays.map((day) => (
          <DayRow key={day} day={day} entries={entries} periodsPerDay={periodsPerDay} lang={lang} view={view} onToggleLock={onToggleLock} onClick={onClick} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-4 text-xs flex-wrap">
        <Legend color="bg-emerald-500" label={tr("teaching", lang)} />
        <Legend color="bg-amber-500" label={tr("duty", lang)} />
        <Legend color="bg-blue-500" label={tr("supervision", lang)} />
        <Legend color="bg-slate-400" label={tr("reserve", lang)} />
        <Legend color="bg-slate-100" label={tr("free", lang)} />
        <Legend color="bg-red-400" label={tr("unavailable", lang)} />
      </div>
    </div>
  );
}

function DayRow({
  day, entries, periodsPerDay, lang, view, onToggleLock, onClick,
}: {
  day: DayCode;
  entries: any[];
  periodsPerDay: number;
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
  onClick?: (entry: any) => void;
}) {
  return (
    <>
      <div className="bg-slate-100 dark:bg-slate-800 p-1.5 font-medium text-center">
        {DAY_LABELS[lang][day]}
      </div>
      {Array.from({ length: periodsPerDay }, (_, i) => {
        const p = i + 1;
        const cellEntries = entries.filter((e) => e.day === day && e.period === p);
        return <Cell key={p} day={day} period={p} entries={cellEntries} lang={lang} view={view} onToggleLock={onToggleLock} onClick={onClick} />;
      })}
    </>
  );
}

function Cell({
  day, period, entries, lang, view, onToggleLock, onClick,
}: {
  day: DayCode;
  period: number;
  entries: any[];
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
  onClick?: (entry: any) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${day}_${period}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[72px] p-1.5 border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 hover:border-slate-400 dark:hover:border-slate-600 transition-colors",
        isOver && "ring-2 ring-blue-400"
      )}
    >
      {entries.length === 0 && (
        <div className="h-full flex items-center justify-center text-slate-300 text-[10px]">{tr("free", lang)}</div>
      )}
      {entries.map((e) => (
        <DraggableEntry key={e.id} entry={e} lang={lang} view={view} onToggleLock={onToggleLock} onClick={onClick} />
      ))}
    </div>
  );
}

function DraggableEntry({
  entry, lang, view, onToggleLock, onClick,
}: {
  entry: any;
  lang: Lang;
  view: ViewKind;
  onToggleLock: (id: string, locked: boolean) => void;
  onClick?: (entry: any) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entry.id });
  const subject = entry.lesson?.subject || entry.subject;
  const teacher = entry.lesson?.teacher || entry.teacher;
  const section = entry.lesson?.section || entry.section;
  const room = entry.lesson?.room || entry.room;
  const isDuty = ["DUTY", "SUPERVISION", "RESERVE"].includes(entry.cellType);

  const bg = isDuty
    ? entry.cellType === "SUPERVISION" ? "bg-blue-100 dark:bg-blue-950 border-blue-300 dark:border-blue-800"
    : entry.cellType === "RESERVE" ? "bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700"
    : "bg-amber-100 dark:bg-amber-950 border-amber-300 dark:border-amber-800"
    : "bg-emerald-100 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-800";

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "rounded border p-1 cursor-grab active:cursor-grabbing mb-1",
        bg,
        isDragging && "opacity-50",
        entry.locked && "ring-2 ring-red-500"
      )}
      style={{ borderInlineStart: subject?.color ? `3px solid ${subject.color}` : undefined }}
      onClick={(e) => {
        // Only open inspector if click was without drag
        // dnd-kit handles drag via listeners; click still fires when no drag occurred
        e.stopPropagation();
        if (onClick) onClick(entry);
      }}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="font-semibold truncate text-xs">
          {isDuty ? entry.duty?.title || entry.cellType : subject?.name || "—"}
        </div>
        <div className="flex items-center gap-0.5">
          {entry.locked ? (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleLock(entry.id, false); }}
              className="text-red-600"
            >
              <Unlock className="w-3 h-3" />
            </button>
          ) : (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleLock(entry.id, true); }}
              className="text-slate-500"
            >
              <Lock className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      {!isDuty && (
        <>
          {view !== "teacher" && <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{teacher?.name}</div>}
          {view !== "class" && <div className="text-[11px] text-slate-600 dark:text-slate-300 truncate">{section?.name}</div>}
          {view !== "room" && <div className="text-[11px] text-slate-500 truncate">{room?.name || "—"}</div>}
        </>
      )}
      {isDuty && entry.duty?.teacher && (
        <div className="text-[10px] text-slate-600 dark:text-slate-300 truncate">{entry.duty.teacher.name}</div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-3 h-3 ${color} rounded`} /> {label}
    </div>
  );
}

function ComparisonView({ aId, bId, lang }: { aId: string; bId: string; lang: "ar" | "en" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["compare", aId, bId],
    queryFn: async () => {
      const r = await fetch(`/api/timetable/compare?a=${aId}&b=${bId}`, { cache: "no-store" });
      return r.json();
    },
  });
  if (isLoading) return <div className="text-xs text-slate-500">{tr("loading", lang)}</div>;
  if (!data || data.error) return <div className="text-xs text-red-500">{data?.error || "Error"}</div>;

  const d = data.diff || {};
  const s = data.summary || {};

  return (
    <div className="space-y-3 text-xs">
      <div className="flex gap-4 flex-wrap text-xs">
        <Badge variant="outline">A: v{data.a?.version} ({data.a?.name})</Badge>
        <Badge variant="outline">B: v{data.b?.version} ({data.b?.name})</Badge>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="border border-slate-200 dark:border-slate-800 rounded p-2">
          <div className="text-[10px] text-slate-500">A entries</div>
          <div className="text-lg font-bold">{s.totalA}</div>
        </div>
        <div className="border border-slate-200 dark:border-slate-800 rounded p-2">
          <div className="text-[10px] text-slate-500">B entries</div>
          <div className="text-lg font-bold">{s.totalB}</div>
        </div>
        <div className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 rounded p-2">
          <div className="text-[10px] text-emerald-700">Added (B only)</div>
          <div className="text-lg font-bold text-emerald-700">{s.added}</div>
        </div>
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 rounded p-2">
          <div className="text-[10px] text-red-700">Removed (A only)</div>
          <div className="text-lg font-bold text-red-700">{s.removed}</div>
        </div>
      </div>
      {s.moved > 0 && (
        <div>
          <div className="font-medium mb-1">{lang === "ar" ? `حصص منقولة (${s.moved})` : `Moved lessons (${s.moved})`}:</div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {(d.moved || []).slice(0, 20).map((m: any, i: number) => (
              <div key={i} className="border-s-2 border-amber-500 ps-2 py-0.5">
                <span className="font-medium">{m.subjectName}</span> ({m.teacherName} → {m.sectionName}){" "}
                <Badge variant="outline" className="text-[9px]">{m.from.day} P{m.from.period}</Badge>
                → <Badge variant="outline" className="text-[9px]">{m.to.day} P{m.to.period}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
      {s.added > 0 && (
        <div>
          <div className="font-medium mb-1 text-emerald-700">{lang === "ar" ? "حصص مضافة" : "Added"} ({s.added}):</div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {(d.onlyB || []).slice(0, 10).map((m: any, i: number) => (
              <div key={i} className="border-s-2 border-emerald-500 ps-2 py-0.5">
                <span className="font-medium">{m.subjectName}</span> ({m.teacherName}){" "}
                <Badge variant="outline" className="text-[9px]">{m.day} P{m.period}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
      {s.removed > 0 && (
        <div>
          <div className="font-medium mb-1 text-red-700">{lang === "ar" ? "حصص محذوفة" : "Removed"} ({s.removed}):</div>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {(d.onlyA || []).slice(0, 10).map((m: any, i: number) => (
              <div key={i} className="border-s-2 border-red-500 ps-2 py-0.5">
                <span className="font-medium">{m.subjectName}</span> ({m.teacherName}){" "}
                <Badge variant="outline" className="text-[9px]">{m.day} P{m.period}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}
      {s.unchanged > 0 && (
        <div className="text-slate-500 text-[11px]">
          {lang === "ar" ? `${s.unchanged} حصة لم تتغير` : `${s.unchanged} unchanged`}
        </div>
      )}
    </div>
  );
}
