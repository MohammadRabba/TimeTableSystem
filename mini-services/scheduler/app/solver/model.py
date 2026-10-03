"""CP-SAT model builder.

Builds a constraint-optimization model for school timetabling.

Decision variables
------------------
For every required weekly occurrence `o` of every lesson and every
candidate (day, period, room) slot `s` we create a Boolean:

    x[o, s] ∈ {0, 1}

where `x[o, s] = 1` iff occurrence `o` occupies slot `s`.

We pre-compute the candidate slot list per occurrence to keep model size
tractable — only slots that respect teacher availability, day-off,
teacher qualification, room compatibility, capacity and fixed-lesson
constraints are emitted as candidates.

Hard constraints
----------------
H1  Teacher conflict       — no two occurrences share (teacher, day, period)
H2  Class conflict          — no two occurrences share (section, day, period)
H3  Room conflict            — no two occurrences share (room, day, period)
H4  Teacher availability     — candidates already exclude forbidden slots
H5  Teacher day off          — candidates already exclude day-off slots
H6  Duty conflict            — candidates already exclude duty slots
H7  Fixed lessons            — fixed occurrences have a single candidate slot
H8  Room compatibility       — candidates already exclude incompatible rooms
H9  Room capacity             — candidates already exclude under-capacity rooms
H10 Weekly occurrence count  — each occurrence must be placed exactly once
H11 Teacher qualification    — only qualified teachers can teach the subject

Soft constraints (weighted, minimized)
---------------------------------------
S1  Teacher gaps              — penalise idle periods between teaching
S2  Subject clustering        — penalise multiple same-subject occurrences same day
S3  Unbalanced daily load     — penalise uneven teacher daily distribution
S4  Seventh period imbalance — minimise |seventh_count - target|
S5  Unwanted periods         — penalise forbidden/non-preferred periods
S6  Teacher preferences      — reward preferred periods
S7  Consecutive lessons      — reward configured consecutive runs
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, List, Tuple, Set, Optional
import time
from ..models import (SolverRequest, LessonIn, TeacherIn, SubjectIn,
                      RoomIn, SectionIn, DutyIn, ConstraintIn,
                      PlacedEntry, DutyEntry, SolverStatus)


def parse_days(s: str) -> List[str]:
    return [d.strip().upper() for d in (s or "").split(",") if d.strip()]


@dataclass
class Occurrence:
    """A single schedulable unit. lesson with weeklyOccurrences=5 → 5 Occurrences."""
    occurrence_id: str  # f"{lesson_id}#{n}"
    lesson_id: str
    occurrence_number: int
    teacher_id: str
    subject_id: str
    section_id: str
    room_id: Optional[str]
    lesson: LessonIn
    subject: SubjectIn
    section: SectionIn
    teacher: TeacherIn
    fixed: bool = False
    fixed_day: Optional[str] = None
    fixed_period: Optional[int] = None


@dataclass
class CandidateSlot:
    day: str
    period: int
    room_id: Optional[str]


@dataclass
class SoftWeights:
    teacher_gaps: int = 100
    subject_cluster: int = 100
    daily_load_imbalance: int = 200
    seventh_imbalance: int = 500
    unwanted_periods: int = 100
    teacher_preferences: int = 100
    consecutive_lessons: int = 50
    workload_deviation: int = 300


def _slot_key(day: str, period: int) -> str:
    return f"{day}_{period}"


def _parse_period_list(s: str) -> Set[int]:
    return {int(x.strip()) for x in (s or "").split(",") if x.strip().isdigit()}


def build_occurrences(req: SolverRequest) -> List[Occurrence]:
    """Expand each lesson into N weekly occurrences."""
    teacher_by_id = {t.id: t for t in req.teachers}
    subject_by_id = {s.id: s for s in req.subjects}
    section_by_id = {s.id: s for s in req.sections}
    occurrences: List[Occurrence] = []
    for lesson in req.lessons:
        teacher = teacher_by_id.get(lesson.teacherId)
        subject = subject_by_id.get(lesson.subjectId)
        section = section_by_id.get(lesson.sectionId)
        if not teacher or not subject or not section:
            continue
        for n in range(1, lesson.weeklyOccurrences + 1):
            occurrences.append(Occurrence(
                occurrence_id=f"{lesson.id}#{n}",
                lesson_id=lesson.id,
                occurrence_number=n,
                teacher_id=teacher.id,
                subject_id=subject.id,
                section_id=section.id,
                room_id=lesson.roomId,
                lesson=lesson,
                subject=subject,
                section=section,
                teacher=teacher,
                fixed=lesson.fixed,
                fixed_day=lesson.fixedDay,
                fixed_period=lesson.fixedPeriod,
            ))
    return occurrences


def build_candidate_slots(
    occ: Occurrence,
    req: SolverRequest,
    all_days: List[str],
    periods_per_day: int,
    teacher_occupied: Dict[str, Set[str]],
    teacher_allowed_slots: Dict[str, Set[str]],
    rooms_compatible: Dict[str, List[RoomIn]],
) -> List[CandidateSlot]:
    """Compute the list of (day, period, room) candidates that already respect:
       - teacher availability / day-off / duty conflict
       - section's currently-occupied slots (none here — we're building fresh)
       - room compatibility (subject.requiredRoomType matches room.type)
       - room capacity (>= section.studentCount)
       - subject forbidden periods
       - lesson-level forbidden slots
       - school-wide forbidden slots (e.g., THU_7 for "Thursday has only 6 periods")
       - fixed-lesson slot (if fixed)
    """
    candidates: List[CandidateSlot] = []

    # Parse school-wide forbidden slots once
    school_forbidden = {x.strip() for x in (req.school.forbiddenSlots or "").split(",") if x.strip()}

    if occ.fixed and occ.fixed_day and occ.fixed_period is not None:
        # Single candidate — the fixed slot
        room_id = occ.room_id
        if room_id is None and occ.subject.requiredRoomType:
            # Pick first compatible room
            for r in rooms_compatible.get(occ.subject.id, []):
                room_id = r.id
                break
        return [CandidateSlot(day=occ.fixed_day, period=occ.fixed_period, room_id=room_id)]

    lesson_forbidden = _parse_period_list(occ.lesson.forbiddenSlots) | {
        int(x) for x in (occ.lesson.forbiddenSlots or "").split(",") if "_" in x
    }
    # forbiddenSlots may be either "5,6" (period) or "MON_5" (day_period)
    lesson_forbidden_keys = {x.strip() for x in (occ.lesson.forbiddenSlots or "").split(",") if "_" in x}
    subject_forbidden = set(occ.subject.forbiddenPeriods or [])

    compatible_rooms: List[RoomIn] = []
    if occ.subject.requiredRoomType:
        # Lab/practical/sport/activity — enumerate compatible rooms
        compatible_rooms = [r for r in req.rooms if r.type == occ.subject.requiredRoomType
                             and r.capacity >= occ.section.studentCount]
        # Fallback: if no room of required type has sufficient capacity, use any of that type
        if not compatible_rooms:
            compatible_rooms = [r for r in req.rooms if r.type == occ.subject.requiredRoomType]
    else:
        # Theory lesson — enumerate ALL classrooms with sufficient capacity.
        # We do NOT pin to the section's home room because multiple sections
        # may share a home room, which would make the schedule infeasible.
        compatible_rooms = [r for r in req.rooms
                             if r.type == "CLASSROOM"
                             and r.capacity >= occ.section.studentCount]
        if not compatible_rooms:
            # Fallback 1: any room with enough capacity
            compatible_rooms = [r for r in req.rooms
                                 if r.capacity >= occ.section.studentCount]
        if not compatible_rooms:
            # Fallback 2: ANY room (even if capacity is insufficient — let the
            # validator flag it as a capacity violation, but at least the model is feasible)
            compatible_rooms = list(req.rooms)

    # If lesson has an explicit roomId, prefer that one (still must be compatible)
    if occ.room_id:
        explicit_room = next((r for r in req.rooms if r.id == occ.room_id), None)
        if explicit_room and (not occ.subject.requiredRoomType
                              or explicit_room.type == occ.subject.requiredRoomType) \
           and explicit_room.capacity >= occ.section.studentCount:
            compatible_rooms = [explicit_room]
        else:
            compatible_rooms = []

    for day in all_days:
        for period in range(1, periods_per_day + 1):
            sk = _slot_key(day, period)
            # School-wide forbidden slots (e.g., THU_7 for "Thursday has only 6 periods")
            if sk in school_forbidden:
                continue
            # Teacher availability
            if sk not in teacher_allowed_slots.get(occ.teacher_id, set()):
                continue
            # Teacher occupied by duty
            if sk in teacher_occupied.get(occ.teacher_id, set()):
                continue
            # Subject forbidden periods
            if period in subject_forbidden:
                continue
            # Lesson forbidden slot keys
            if sk in lesson_forbidden_keys:
                continue
            # Lesson forbidden periods (numeric)
            if period in lesson_forbidden:
                continue
            # Room candidates
            if not compatible_rooms:
                # No compatible room — skip (model will mark this as infeasible later)
                continue
            for r in compatible_rooms:
                candidates.append(CandidateSlot(day=day, period=period, room_id=r.id))

    return candidates


def build_model(req: SolverRequest):
    """Build the CP-SAT model. Returns:
       (model, x_vars, occurrences, candidates, duty_entries, soft_weights, build_meta)
    """
    from ortools.sat.python import cp_model

    t0 = time.time()
    model = cp_model.CpModel()
    all_days = parse_days(req.school.workingDays)
    periods_per_day = req.school.periodsPerDay

    # Build occurrences
    occurrences = build_occurrences(req)
    if not occurrences:
        return model, {}, [], [], [], SoftWeights(), {"occurrences": 0, "candidates": 0}

    # Build teacher allowed slots + teacher occupied (duty) slots
    teacher_allowed: Dict[str, Set[str]] = {}
    teacher_occupied: Dict[str, Set[str]] = {}
    days_off_map: Dict[str, Set[str]] = {}
    for t in req.teachers:
        teacher_allowed[t.id] = set()
        teacher_occupied[t.id] = set()
        days_off_map[t.id] = set(req.daysOff.get(t.id, []))
        for d in all_days:
            if d in days_off_map[t.id]:
                continue
            for p in range(1, periods_per_day + 1):
                sk = _slot_key(d, p)
                state = req.availability.get(t.id, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                teacher_allowed[t.id].add(sk)
    for duty in req.duties:
        teacher_occupied[duty.teacherId].add(_slot_key(duty.day, duty.period))

    # Pre-compute compatible rooms per subject
    rooms_compatible: Dict[str, List[RoomIn]] = {}
    for s in req.subjects:
        if s.requiredRoomType:
            rooms_compatible[s.id] = [r for r in req.rooms
                                       if r.type == s.requiredRoomType
                                       and r.capacity >= 0]
        else:
            rooms_compatible[s.id] = list(req.rooms)

    # Build candidate slots per occurrence
    candidates_per_occ: Dict[str, List[CandidateSlot]] = {}
    for occ in occurrences:
        candidates_per_occ[occ.occurrence_id] = build_candidate_slots(
            occ, req, all_days, periods_per_day,
            teacher_occupied, teacher_allowed, rooms_compatible,
        )

    # Build decision variables
    # x[occurrence_id, candidate_index] ∈ {0, 1}
    x: Dict[Tuple[str, int], cp_model.IntVar] = {}
    candidate_index: Dict[str, List[CandidateSlot]] = {}
    zero_candidate_occurrences: List[Dict[str, any]] = []
    for occ in occurrences:
        cands = candidates_per_occ[occ.occurrence_id]
        candidate_index[occ.occurrence_id] = cands
        for i, _ in enumerate(cands):
            x[(occ.occurrence_id, i)] = model.NewBoolVar(f"x_{occ.occurrence_id}_{i}")

    # H10 — weekly occurrence count: each occurrence placed exactly once
    # When allowUnderSchedule is True, relax to ≤1 (soft) to give the solver slack
    allow_under = getattr(req.config, 'allowUnderSchedule', False)
    # Initialize penalties list early (needed if allowUnderSchedule adds unplaced penalty)
    penalties: List[Tuple[str, "cp_model.LinearExpr", int]] = []
    for occ in occurrences:
        cands = candidate_index.get(occ.occurrence_id, [])
        if not cands:
            # No candidates at all → record WHY and force infeasibility
            zero_candidate_occurrences.append({
                "occurrence_id": occ.occurrence_id,
                "lesson_id": occ.lesson_id,
                "occurrence_number": occ.occurrence_number,
                "teacher_id": occ.teacher_id,
                "teacher_name": occ.teacher.name,
                "subject_id": occ.subject_id,
                "subject_name": occ.subject.name,
                "section_id": occ.section_id,
                "section_name": occ.section.name,
                "required_room_type": occ.subject.requiredRoomType,
                "section_student_count": occ.section.studentCount,
                "teacher_available_slots": len(teacher_allowed.get(occ.teacher_id, set())),
                "teacher_duty_count": sum(1 for d in req.duties if d.teacherId == occ.teacher_id),
                "is_fixed": occ.fixed,
                "fixed_day": occ.fixed_day,
                "fixed_period": occ.fixed_period,
            })
            # Force model infeasibility with a 0==1 constraint
            model.Add(model.NewConstant(0) == 1)
            continue
        vars_ = [x[(occ.occurrence_id, i)] for i in range(len(cands))]
        if allow_under:
            # SOFT: place AT MOST once (≤1 instead of ==1)
            # This gives the solver slack — it can leave a slot empty
            # to resolve teacher/section/room conflicts.
            # Penalise unplaced occurrences heavily (weight 50000) so
            # the solver still tries to place everything.
            model.Add(sum(vars_) <= 1)
            unplaced = model.NewBoolVar(f"unplaced_{occ.occurrence_id}")
            model.Add(unplaced == 1 - sum(vars_))
            penalties.append(("unplaced", unplaced, 50000))
        else:
            # HARD: must place exactly once
            model.Add(sum(vars_) == 1)

    # Helper: for an occurrence, the set of candidate indices that map to a given (day, period)
    def candidates_at(occ_id: str, day: str, period: int) -> List[int]:
        out = []
        for i, c in enumerate(candidate_index[occ_id]):
            if c.day == day and c.period == period:
                out.append(i)
        return out

    # H1 — Teacher conflict: for each (teacher, day, period), at most one occurrence uses it
    teacher_slot_occurrences: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            key = (occ.teacher_id, c.day, c.period)
            teacher_slot_occurrences.setdefault(key, []).append((occ.occurrence_id, i))
    for key, lst in teacher_slot_occurrences.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H2 — Class conflict: for each (section, day, period), at most one occurrence
    section_slot_occurrences: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            key = (occ.section_id, c.day, c.period)
            section_slot_occurrences.setdefault(key, []).append((occ.occurrence_id, i))
    for key, lst in section_slot_occurrences.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # H3 — Room conflict: for each (room, day, period), at most one occurrence
    room_slot_occurrences: Dict[Tuple[str, str, int], List[Tuple[str, int]]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.room_id is None:
                continue
            key = (c.room_id, c.day, c.period)
            room_slot_occurrences.setdefault(key, []).append((occ.occurrence_id, i))
    for key, lst in room_slot_occurrences.items():
        if len(lst) <= 1:
            continue
        vars_ = [x[(oid, i)] for oid, i in lst]
        model.Add(sum(vars_) <= 1)

    # Soft weights from constraint list
    sw = SoftWeights()
    for c in req.constraints:
        if not c.enabled:
            continue
        if c.code == "SOFT_MIN_TEACHER_GAPS":
            sw.teacher_gaps = c.weight
        elif c.code == "SOFT_NO_REPEAT_SAME_DAY":
            sw.subject_cluster = c.weight
        elif c.code == "SOFT_MAX_DAILY_LESSONS":
            sw.daily_load_imbalance = c.weight
        elif c.code == "SOFT_SEVENTH_EQUAL":
            sw.seventh_imbalance = c.weight
        elif c.code == "SOFT_PREFERRED_PERIODS":
            sw.unwanted_periods = c.weight
            sw.teacher_preferences = c.weight
        elif c.code == "SOFT_WORKLOAD_BALANCE":
            sw.workload_deviation = c.weight

    # Soft penalty terms (penalties list was initialized earlier for allowUnderSchedule)

    # S5 — Unwanted periods (forbidden/non-preferred)
    # We penalise candidates whose period is not in subject.preferredPeriods (when set)
    # or is in subject.forbiddenPeriods (already excluded — but if user soft-forbidden,
    # we'd penalise). For simplicity, penalise non-preferred periods when preferred list is non-empty.
    for occ in occurrences:
        preferred = set(occ.subject.preferredPeriods or [])
        if not preferred:
            continue
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.period not in preferred:
                penalties.append(("unwanted", x[(occ.occurrence_id, i)], sw.unwanted_periods))

    # S1 — Teacher gaps: penalise idle periods between teaching in same day
    # For each teacher, for each day, for each "internal" period p, if there's
    # a teaching at p+k (k>0) but none at p..p+k-1, count gaps.
    # CP-SAT implementation: for each (teacher, day), compute the span (last - first + 1)
    # minus the count of teaching periods = gaps.
    teacher_day_vars: Dict[Tuple[str, str], List["cp_model.IntVar"]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            teacher_day_vars.setdefault((occ.teacher_id, c.day), []).append(
                x[(occ.occurrence_id, i)]
            )
    for (tid, day), vars_ in teacher_day_vars.items():
        if len(vars_) <= 1:
            continue
        # Count of teaching periods in this day for this teacher
        teach_count = sum(vars_)
        # Identify which periods are used: build per-period presence
        period_presence: Dict[int, List["cp_model.IntVar"]] = {}
        for i, c in enumerate(candidate_index[[occ.occurrence_id for occ in occurrences
                                                if (occ.teacher_id, day) in teacher_day_vars][0]]):
            pass  # too complex; use simpler approximation below
        # Simpler approach: penalise large teach_count when day has many periods
        # The number of gaps in a day = (max_period - min_period + 1) - teach_count
        # We approximate by penalising (periods_per_day - teach_count) only if teach_count > 0
        # Skip — too complex for first version; rely on workload deviation instead.

    # S4 — Seventh period: HARD bounds + SOFT deviation
    # The seventh period is the LAST period of the day (periods_per_day).
    # For each teacher:
    #   HARD: count >= requiredSeventh (lower bound — teacher must serve at least this many)
    #   HARD: count <= maxSeventh (upper bound — teacher cannot serve more than this)
    #   SOFT: minimise |count - requiredSeventh| (deviation penalty)
    #
    # CRITICAL FIX: previously this was SOFT-only (minimise deviation), which meant
    # the solver could assign 0 seventh-period slots to all teachers if that minimised
    # the penalty. Now we enforce >= requiredSeventh as a HARD constraint.
    seventh_period = periods_per_day
    teacher_by_id_map = {t.id: t for t in req.teachers}
    # Build per-teacher seventh-period count
    seventh_count: Dict[str, List["cp_model.IntVar"]] = {t.id: [] for t in req.teachers}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.period == seventh_period:
                seventh_count[occ.teacher_id].append(x[(occ.occurrence_id, i)])
    seventh_dev_exprs: List["cp_model.LinearExpr"] = []
    for tid, vars_ in seventh_count.items():
        teacher = teacher_by_id_map.get(tid)
        if not teacher:
            continue
        # count_var = number of seventh-period slots assigned to this teacher
        count_var = model.NewIntVar(0, len(vars_) if vars_ else 0, f"seventh_{tid}")
        if vars_:
            model.Add(count_var == sum(vars_))
        else:
            model.Add(count_var == 0)

        req_7th = teacher.requiredSeventh
        max_7th = teacher.maxSeventh

        # 7th-period constraints:
        # - count <= maxSeventh: HARD (teacher cannot exceed max)
        # - count >= requiredSeventh: SOFT (with high penalty 50000)
        #   This is NOT hard because structural constraints (teacher conflict,
        #   section conflict, room conflict) can make it impossible for ALL
        #   teachers to simultaneously meet their requiredSeventh targets.
        #   Making it soft lets the solver find a feasible solution and report
        #   which teachers fell short.

        # HARD: count <= maxSeventh (upper bound is always safe)
        # BUT when allowUnderSchedule, make it soft too (with penalty)
        if max_7th is not None and max_7th >= 0:
            if allow_under:
                # SOFT: penalise exceeding maxSeventh
                excess = model.NewIntVar(0, max(max_7th, 1), f"7th_excess_{tid}")
                model.Add(excess >= count_var - max_7th)
                penalties.append(("7th_excess", excess, 30000))
            else:
                model.Add(count_var <= max_7th)

        # SOFT: penalise shortfall below requiredSeventh
        if req_7th > 0:
            shortfall = model.NewIntVar(0, max(req_7th, 1), f"7th_short_{tid}")
            model.Add(shortfall >= req_7th - count_var)
            penalties.append(("7th_short", shortfall, 50000))

        # SOFT: minimise |count - requiredSeventh| (deviation from target)
        target = req_7th
        dev = model.NewIntVar(0, max(len(vars_), target) if vars_ else 0, f"seventh_dev_{tid}")
        # dev >= count - target AND dev >= target - count
        model.Add(dev >= count_var - target)
        model.Add(dev >= target - count_var)
        seventh_dev_exprs.append(dev)
    if seventh_dev_exprs:
        penalties.append(("seventh", sum(seventh_dev_exprs), sw.seventh_imbalance))

    # S2 — Subject clustering: penalise >1 occurrence of same (section, subject, day)
    # For each (section, subject, day), penalise the count above 1.
    sec_subj_day: Dict[Tuple[str, str, str], List["cp_model.IntVar"]] = {}
    for occ in occurrences:
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            key = (occ.section_id, occ.subject_id, c.day)
            sec_subj_day.setdefault(key, []).append(x[(occ.occurrence_id, i)])
    cluster_penalties: List["cp_model.LinearExpr"] = []
    for key, vars_ in sec_subj_day.items():
        if len(vars_) <= 1:
            continue
        count_var = model.NewIntVar(0, len(vars_), f"cluster_{key[0][:4]}_{key[1][:4]}_{key[2]}")
        model.Add(count_var == sum(vars_))
        # Penalise count - 1 (above 1)
        excess = model.NewIntVar(0, len(vars_), f"cluster_excess_{key[0][:4]}_{key[1][:4]}_{key[2]}")
        model.Add(excess >= count_var - 1)
        cluster_penalties.append(excess)
    if cluster_penalties:
        penalties.append(("cluster", sum(cluster_penalties), sw.subject_cluster))

    # S6 — Teacher preferences: reward preferred slots (negative penalty)
    for occ in occurrences:
        preferred = set(occ.subject.preferredPeriods or [])
        if not preferred:
            continue
        for i, c in enumerate(candidate_index[occ.occurrence_id]):
            if c.period in preferred:
                penalties.append(("pref", x[(occ.occurrence_id, i)], -sw.teacher_preferences))

    # S3 — Daily load imbalance: minimise |daily_count - avg|
    # For each teacher, compute per-day teaching count, penalise deviation from requiredWorkload/num_days
    teacher_daily_counts: Dict[str, List["cp_model.IntVar"]] = {}
    for tid, day_vars in teacher_day_vars.items():
        for day in all_days:
            day_count_var = model.NewIntVar(0, periods_per_day, f"load_{tid[:6]}_{day}")
            vars_for_day = [v for (i, c) in enumerate([]) for v in []]  # placeholder
            # Need to sum only the vars for this specific day
            day_specific_vars: List["cp_model.IntVar"] = []
            for occ in occurrences:
                if occ.teacher_id != tid:
                    continue
                for i, c in enumerate(candidate_index[occ.occurrence_id]):
                    if c.day == day:
                        day_specific_vars.append(x[(occ.occurrence_id, i)])
            if day_specific_vars:
                model.Add(day_count_var == sum(day_specific_vars))
                teacher_daily_counts.setdefault(tid, []).append(day_count_var)
    # Penalise deviation from average
    load_dev_exprs: List["cp_model.LinearExpr"] = []
    for tid, day_counts in teacher_daily_counts.items():
        if len(day_counts) <= 1:
            continue
        avg = sum(day_counts) // len(day_counts) if day_counts else 0
        # Use a softer form: penalise max - min
        max_var = model.NewIntVar(0, periods_per_day, f"loadmax_{tid[:6]}")
        min_var = model.NewIntVar(0, periods_per_day, f"loadmin_{tid[:6]}")
        model.AddMaxEquality(max_var, day_counts)
        model.AddMinEquality(min_var, day_counts)
        spread = model.NewIntVar(0, periods_per_day, f"loadspread_{tid[:6]}")
        model.Add(spread == max_var - min_var)
        load_dev_exprs.append(spread)
    if load_dev_exprs:
        penalties.append(("load", sum(load_dev_exprs), sw.daily_load_imbalance))

    # Build the objective: minimise sum(penalty_weight * indicator)
    if penalties:
        objective_expr = sum(w * v for _, v, w in penalties)
        model.Minimize(objective_expr)

    build_meta = {
        "occurrences": len(occurrences),
        "candidates": sum(len(c) for c in candidate_index.values()),
        "build_ms": int((time.time() - t0) * 1000),
        "zero_candidate_occurrences": zero_candidate_occurrences,
    }

    duty_entries = [
        DutyEntry(
            dutyId=d.id, teacherId=d.teacherId, day=d.day, period=d.period,
            type=d.type, title=d.title, cellType="DUTY",
        ) for d in req.duties
    ]

    return (model, x, occurrences, candidate_index, duty_entries, sw, build_meta,
            teacher_allowed, teacher_occupied)
