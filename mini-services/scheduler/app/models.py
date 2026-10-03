"""Pydantic models for the scheduling microservice API.

A *lesson* is a (teacher, subject, section, room?, weeklyOccurrences) tuple.
A *weekly occurrence* is a single schedulable unit — e.g. a lesson requiring
5 periods/week produces 5 occurrences. The solver treats each occurrence as
an independent decision variable.
"""
from __future__ import annotations
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class DayCode(str, Enum):
    SAT = "SAT"
    SUN = "SUN"
    MON = "MON"
    TUE = "TUE"
    WED = "WED"
    THU = "THU"
    FRI = "FRI"


class AvailabilityState(str, Enum):
    AVAILABLE = "AVAILABLE"
    UNAVAILABLE = "UNAVAILABLE"
    PREFERRED = "PREFERRED"
    FORBIDDEN = "FORBIDDEN"


class SchoolIn(BaseModel):
    id: str
    name: str
    workingDays: str  # comma-separated
    periodsPerDay: int
    # School-wide forbidden (day, period) slots — comma-separated "DAY_PERIOD" keys.
    # Example: "THU_7" means Thursday period 7 is forbidden (Thursday has only 6 periods).
    forbiddenSlots: Optional[str] = None


class TeacherIn(BaseModel):
    id: str
    name: str
    requiredWorkload: int = 24
    maxDailyPeriods: int = 7
    minDailyPeriods: int = 0
    requiredSeventh: int = 0
    maxSeventh: int = 3


class SectionIn(BaseModel):
    id: str
    name: str
    studentCount: int = 0
    roomId: Optional[str] = None


class SubjectIn(BaseModel):
    id: str
    name: str
    type: str = "THEORY"
    defaultWeekly: int = 0
    maxPerDay: int = 2
    minGap: int = 0
    consecutive: bool = False
    preferredPeriods: List[int] = Field(default_factory=list)
    forbiddenPeriods: List[int] = Field(default_factory=list)
    requiredRoomType: Optional[str] = None
    priority: int = 100


class RoomIn(BaseModel):
    id: str
    name: str
    type: str = "CLASSROOM"
    capacity: int = 30


class LessonIn(BaseModel):
    id: str
    teacherId: str
    subjectId: str
    sectionId: str
    roomId: Optional[str] = None
    weeklyOccurrences: int = 1
    duration: int = 1
    lessonType: str = "THEORY"
    priority: int = 100
    requiredConsecutive: int = 0
    preferredSlots: str = ""
    forbiddenSlots: str = ""
    fixed: bool = False
    fixedDay: Optional[str] = None
    fixedPeriod: Optional[int] = None
    locked: bool = False
    coTeacherId: Optional[str] = None


class DutyIn(BaseModel):
    id: str
    teacherId: str
    type: str = "DUTY"
    title: str
    day: str
    period: int
    location: Optional[str] = None


class ConstraintIn(BaseModel):
    code: str
    type: str  # "HARD" | "SOFT"
    weight: int = 1000000
    enabled: bool = True


class SolverProfile(str, Enum):
    FAST = "FAST"
    BALANCED = "BALANCED"
    DEEP = "DEEP"


class SolverConfig(BaseModel):
    timeLimitSeconds: int = 60
    numWorkers: int = 8
    optimizationLevel: int = 2  # 0..3 (CP-SAT hash_seed/log_search_workers combo)
    profile: SolverProfile = SolverProfile.BALANCED
    allowPartial: bool = False  # if True, solver may return PARTIAL when no feasible complete solution
    allowUnderSchedule: bool = False  # if True, relaxes weekly count to ≤1 (soft) instead of ==1 (hard)
    # This gives the solver slack when demand == capacity (zero slack per section)


class SolverRequest(BaseModel):
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]  # teacherId -> "DAY_PERIOD" -> state
    daysOff: Dict[str, List[str]]  # teacherId -> [day, ...]
    constraints: List[ConstraintIn]
    config: SolverConfig = Field(default_factory=SolverConfig)


class PlacedEntry(BaseModel):
    occurrenceId: str  # "lessonId#n" — unique per occurrence
    lessonId: str
    occurrenceNumber: int  # 1..N
    teacherId: str
    subjectId: str
    sectionId: str
    roomId: Optional[str] = None
    day: str
    period: int
    cellType: str = "TEACHING"
    fixed: bool = False
    locked: bool = False


class DutyEntry(BaseModel):
    dutyId: str
    teacherId: str
    day: str
    period: int
    type: str
    title: str
    cellType: str = "DUTY"


class SolverStatus(str, Enum):
    OPTIMAL = "OPTIMAL"
    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    UNKNOWN = "UNKNOWN"
    MODEL_INVALID = "MODEL_INVALID"


class ValidationIssue(BaseModel):
    type: str
    severity: str  # "CRITICAL" | "WARNING" | "OPTIMIZATION"
    day: Optional[str] = None
    period: Optional[int] = None
    message: str
    entityIds: List[str] = Field(default_factory=list)


class FeasibilityFailure(BaseModel):
    scope: str  # "TEACHER" | "CLASS" | "ROOM" | "GLOBAL"
    entityId: Optional[str] = None
    reason: str
    suggestion: str


class SolverStats(BaseModel):
    requiredOccurrences: int
    scheduledOccurrences: int
    unscheduledOccurrences: int
    teacherConflicts: int
    classConflicts: int
    roomConflicts: int
    availabilityViolations: int
    dutyConflicts: int
    fixedLessonViolations: int
    capacityViolations: int
    teacherGaps: int
    seventhDeviation: int
    subjectCluster: int
    workloadDeviation: int
    unwantedSlots: int


class SolverResponse(BaseModel):
    status: SolverStatus
    feasible: bool  # True iff required == scheduled AND hardViolations == 0
    partial: bool  # True iff status == FEASIBLE but unscheduled > 0 (only when allowPartial)
    entries: List[PlacedEntry]
    dutyEntries: List[DutyEntry]
    stats: SolverStats
    softPenalty: int
    qualityScore: int  # 0..100
    objectiveValue: Optional[int] = None
    modelGenerationMs: int
    solverMs: int
    wallMs: int
    memoryMb: Optional[int] = None
    failures: List[FeasibilityFailure]
    conflicts: List[ValidationIssue]
    suggestions: List[str]
    # NEW: lessons that have ZERO valid candidate slots — root cause of instant INFEASIBLE
    zeroCandidateLessons: List[Dict[str, Any]] = Field(default_factory=list)


class ValidateRequest(BaseModel):
    """Independent validator request — takes a *full* timetable snapshot
    plus the requirement set and validates from scratch."""
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]
    daysOff: Dict[str, List[str]]
    entries: List[PlacedEntry]  # the timetable to validate
    dutyEntries: List[DutyEntry] = Field(default_factory=list)


class ValidateResponse(BaseModel):
    valid: bool
    hardViolations: int
    softPenalty: int
    issues: List[ValidationIssue]
    stats: SolverStats


class SwapSuggestion(BaseModel):
    day: str
    period: int
    swapWithLessonId: Optional[str] = None
    swapWithOccurrenceId: Optional[str] = None
    reason: str
    hardViolations: int
    softPenalty: int


class SwapRequest(BaseModel):
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]
    daysOff: Dict[str, List[str]]
    entries: List[PlacedEntry]  # current timetable
    targetOccurrenceId: str
    targetDay: str
    targetPeriod: int


class SwapResponse(BaseModel):
    suggestions: List[SwapSuggestion]


class RepairRequest(BaseModel):
    school: SchoolIn
    teachers: List[TeacherIn]
    sections: List[SectionIn]
    subjects: List[SubjectIn]
    rooms: List[RoomIn]
    lessons: List[LessonIn]
    duties: List[DutyIn]
    availability: Dict[str, Dict[str, str]]
    daysOff: Dict[str, List[str]]
    entries: List[PlacedEntry]  # current timetable
    movedOccurrenceId: str
    newDay: str
    newPeriod: int
    config: SolverConfig = Field(default_factory=SolverConfig)


class RepairResponse(BaseModel):
    status: SolverStatus
    feasible: bool
    entries: List[PlacedEntry]
    stats: SolverStats
    conflicts: List[ValidationIssue]
    repaired: bool
    message: str
