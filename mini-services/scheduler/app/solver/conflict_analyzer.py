"""Pre-solver feasibility analyzer.

Detects capacity problems before CP-SAT starts:
- Teacher workload > available slots
- Class weekly lessons > week slots
- Lab requirements with no compatible room
- Capacity mismatches
- Fixed-lesson conflicts
- Resource contention (e.g., 3 classes need the same teacher at the same fixed slot)
"""
from __future__ import annotations
from typing import Dict, List, Set
from ..models import SolverRequest, FeasibilityFailure


def parse_days(s: str) -> List[str]:
    return [d.strip().upper() for d in (s or "").split(",") if d.strip()]


def analyze(req: SolverRequest) -> List[FeasibilityFailure]:
    failures: List[FeasibilityFailure] = []
    days = parse_days(req.school.workingDays)
    periods_per_day = req.school.periodsPerDay

    # Build teacher allowed slot count
    teacher_allowed_count: Dict[str, int] = {}
    teacher_duty_count: Dict[str, int] = {}
    for t in req.teachers:
        days_off = set(req.daysOff.get(t.id, []))
        allowed = 0
        for d in days:
            if d in days_off:
                continue
            for p in range(1, periods_per_day + 1):
                sk = f"{d}_{p}"
                state = req.availability.get(t.id, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                allowed += 1
        teacher_allowed_count[t.id] = allowed
        teacher_duty_count[t.id] = sum(1 for du in req.duties if du.teacherId == t.id)

    # Per-teacher required teaching
    teacher_required_teaching: Dict[str, int] = {}
    for l in req.lessons:
        teacher_required_teaching[l.teacherId] = (
            teacher_required_teaching.get(l.teacherId, 0) + l.weeklyOccurrences
        )

    for t in req.teachers:
        allowed = teacher_allowed_count[t.id]
        duties = teacher_duty_count[t.id]
        required_teaching = teacher_required_teaching.get(t.id, 0)
        # Required workload includes teaching + duties + seventh target
        total_required = required_teaching + duties + t.requiredSeventh
        if total_required > allowed:
            failures.append(FeasibilityFailure(
                scope="TEACHER",
                entityId=t.id,
                reason=(f"Teacher {t.name} requires {total_required} periods "
                        f"(teaching {required_teaching} + duties {duties} + seventh {t.requiredSeventh}) "
                        f"but only {allowed} valid slots exist."),
                suggestion="Reduce required workload, add availability, or assign lessons to another teacher.",
            ))
        elif required_teaching > allowed:
            failures.append(FeasibilityFailure(
                scope="TEACHER",
                entityId=t.id,
                reason=(f"Teacher {t.name} teaching requirement {required_teaching} "
                        f"exceeds available slots {allowed}."),
                suggestion="Assign some lessons to another qualified teacher.",
            ))

    # Class weekly lessons vs week slots
    section_required: Dict[str, int] = {}
    for l in req.lessons:
        section_required[l.sectionId] = section_required.get(l.sectionId, 0) + l.weeklyOccurrences
    section_by_id = {s.id: s for s in req.sections}
    max_week_slots = len(days) * periods_per_day
    for sid, required in section_required.items():
        sec = section_by_id.get(sid)
        if required > max_week_slots:
            failures.append(FeasibilityFailure(
                scope="CLASS",
                entityId=sid,
                reason=(f"Class {sec.name if sec else sid} requires {required} lessons "
                        f"but only {max_week_slots} slots exist in the week."),
                suggestion="Reduce weekly lesson count or add working periods/days.",
            ))

    # Lab requirements with no compatible room
    for s in req.subjects:
        if s.requiredRoomType:
            has = any(r.type == s.requiredRoomType and
                       r.capacity >= (min(sec.studentCount for sec in req.sections
                                           if any(l.subjectId == s.id for l in req.lessons
                                                  if l.sectionId == sec.id)) or 0)
                       for r in req.rooms)
            if not has:
                # Check more loosely — capacity >= 0
                has_room = any(r.type == s.requiredRoomType for r in req.rooms)
                if not has_room:
                    failures.append(FeasibilityFailure(
                        scope="GLOBAL",
                        reason=(f"Subject {s.name} requires room type {s.requiredRoomType} "
                                f"but no compatible room exists."),
                        suggestion="Add a compatible laboratory/room, or change subject room type requirement.",
                    ))
                else:
                    # Has the type but capacity too low
                    max_cap = max((r.capacity for r in req.rooms
                                   if r.type == s.requiredRoomType), default=0)
                    failures.append(FeasibilityFailure(
                        scope="ROOM",
                        reason=(f"Subject {s.name} requires room type {s.requiredRoomType} "
                                f"but max capacity of compatible rooms is {max_cap}, "
                                f"too low for some sections."),
                        suggestion="Increase room capacity or reduce section student count.",
                    ))

    # Fixed-lesson conflicts: same teacher at same fixed slot
    fixed_buckets: Dict[str, int] = {}
    teacher_by_id = {t.id: t for t in req.teachers}
    for l in req.lessons:
        if l.fixed and l.fixedDay and l.fixedPeriod is not None:
            k = f"{l.teacherId}_{l.fixedDay}_{l.fixedPeriod}"
            fixed_buckets[k] = fixed_buckets.get(k, 0) + 1
            if fixed_buckets[k] > 1:
                teacher = teacher_by_id.get(l.teacherId)
                failures.append(FeasibilityFailure(
                    scope="TEACHER",
                    entityId=l.teacherId,
                    reason=(f"Teacher {teacher.name if teacher else l.teacherId} has "
                            f"{fixed_buckets[k]} fixed lessons at {l.fixedDay} P{l.fixedPeriod}."),
                    suggestion="Move or unfix conflicting fixed lessons.",
                ))

    # Capacity mismatch for explicitly assigned rooms
    section_students = {s.id: s.studentCount for s in req.sections}
    for l in req.lessons:
        if not l.roomId:
            continue
        room = next((r for r in req.rooms if r.id == l.roomId), None)
        if not room:
            continue
        students = section_students.get(l.sectionId, 0)
        if room.capacity < students:
            failures.append(FeasibilityFailure(
                scope="ROOM",
                entityId=l.roomId,
                reason=(f"Lesson in section {l.sectionId} ({students} students) "
                        f"assigned to room {room.name} (capacity {room.capacity})."),
                suggestion="Assign a room with greater capacity.",
            ))

    # === AGGREGATE FEASIBILITY CHECKS ===
    # These catch structural infeasibility that per-lesson checks miss.

    # Parse school forbidden slots (e.g., "THU_7" = Thursday period 7)
    school_forbidden = {x.strip() for x in (req.school.forbiddenSlots or "").split(",") if x.strip()}

    # Compute per-section capacity (accounting for forbidden slots)
    # capacity = number of (day, period) slots available for this section
    total_capacity = 0
    for day in days:
        for p in range(1, periods_per_day + 1):
            sk = f"{day}_{p}"
            if sk in school_forbidden:
                continue
            total_capacity += 1
    capacity_per_section = total_capacity  # each section can use each slot once

    # Check 1: per-section demand vs capacity
    section_by_id = {s.id: s for s in req.sections}
    section_demand: Dict[str, int] = {}
    for l in req.lessons:
        section_demand[l.sectionId] = section_demand.get(l.sectionId, 0) + l.weeklyOccurrences

    over_capacity_sections = 0
    for sid, demand in section_demand.items():
        sec = section_by_id.get(sid)
        if demand > capacity_per_section:
            over_capacity_sections += 1
            failures.append(FeasibilityFailure(
                scope="CLASS",
                entityId=sid,
                reason=(f"Section {sec.name if sec else sid} requires {demand} weekly occurrences "
                        f"but only {capacity_per_section} slots exist per section "
                        f"(after school forbidden slots). Slack = {capacity_per_section - demand}."),
                suggestion=(f"Reduce weekly occurrences for section {sec.name if sec else sid} "
                            f"by at least {demand - capacity_per_section + 1} to create slack, "
                            f"or add more working days/periods."),
            ))

    # Check 2: total demand vs total capacity (aggregate)
    total_demand = sum(l.weeklyOccurrences for l in req.lessons)
    total_section_capacity = len(req.sections) * capacity_per_section
    if total_demand > total_section_capacity:
        failures.append(FeasibilityFailure(
            scope="GLOBAL",
            reason=(f"Total demand ({total_demand} weekly occurrences) exceeds total section capacity "
                    f"({len(req.sections)} sections × {capacity_per_section} slots = {total_section_capacity}). "
                    f"Deficit = {total_demand - total_section_capacity}."),
            suggestion="Reduce weekly occurrences across all subjects, or add sections/days/periods.",
        ))

    # Check 3: 7th-period aggregate feasibility
    # days with a 7th period = days where (day, 7) is NOT in school_forbidden
    days_with_7th = [d for d in days if f"{d}_{periods_per_day}" not in school_forbidden]
    required_7th_slots = len(req.sections) * len(days_with_7th)
    sum_required_7th = sum(t.requiredSeventh for t in req.teachers)
    sum_max_7th = sum(t.maxSeventh for t in req.teachers)

    if sum_max_7th < required_7th_slots and required_7th_slots > 0:
        failures.append(FeasibilityFailure(
            scope="GLOBAL",
            reason=(f"7th-period capacity crisis: {len(req.sections)} sections × {len(days_with_7th)} days "
                    f"with 7th period = {required_7th_slots} required 7th-period teacher-slots, "
                    f"but sum(maxSeventh) = {sum_max_7th}. "
                    f"Deficit = {required_7th_slots - sum_max_7th}."),
            suggestion=("Increase maxSeventh for teachers (allow more 7th-period assignments), "
                        "reduce requiredSeventh, or add more teachers."),
        ))

    if sum_required_7th > required_7th_slots and required_7th_slots > 0:
        failures.append(FeasibilityFailure(
            scope="GLOBAL",
            reason=(f"7th-period over-supply: sum(requiredSeventh) = {sum_required_7th} but only "
                    f"{required_7th_slots} 7th-period slots are needed. "
                    f"The model will be over-constrained."),
            suggestion="Reduce requiredSeventh values to be ≤ sections × days_with_7th.",
        ))

    # Check 4: per-teacher demand vs capacity (accounting for days-off + forbidden)
    teacher_demand: Dict[str, int] = {}
    for l in req.lessons:
        teacher_demand[l.teacherId] = teacher_demand.get(l.teacherId, 0) + l.weeklyOccurrences
    teacher_duty_count: Dict[str, int] = {}
    for d in req.duties:
        teacher_duty_count[d.teacherId] = teacher_duty_count.get(d.teacherId, 0) + 1

    for t in req.teachers:
        demand = teacher_demand.get(t.id, 0)
        duties = teacher_duty_count.get(t.id, 0)
        # Compute teacher's available slots (same as model)
        days_off_t = set(req.daysOff.get(t.id, []))
        available = 0
        for d in days:
            if d in days_off_t:
                continue
            for p in range(1, periods_per_day + 1):
                sk = f"{d}_{p}"
                if sk in school_forbidden:
                    continue
                state = req.availability.get(t.id, {}).get(sk)
                if state in ("UNAVAILABLE", "FORBIDDEN"):
                    continue
                available += 1
        total_needed = demand + duties + t.requiredSeventh
        if total_needed > available:
            failures.append(FeasibilityFailure(
                scope="TEACHER",
                entityId=t.id,
                reason=(f"Teacher {t.name} needs {total_needed} periods "
                        f"(teaching {demand} + duties {duties} + 7th {t.requiredSeventh}) "
                        f"but only has {available} available slots "
                        f"(after days-off, school forbidden, and UNAVAILABLE periods). "
                        f"Deficit = {total_needed - available}."),
                suggestion=("Reduce this teacher's lessons, add availability, remove days-off, "
                            "or reduce requiredSeventh/maxDailyPeriods constraints."),
            ))

    return failures
