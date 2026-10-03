"""FastAPI entry point for the scheduling microservice.

Endpoints
---------
POST /health              — liveness probe
POST /solve               — full solve
POST /validate             — independent timetable validation
POST /swap                 — swap suggestion engine

The service is **stateless**: every request includes the full solver input
and the response is fully self-contained. The Next.js backend remains the
source of truth for persistence — this service only computes results.

Run with:
    uvicorn app.main:app --port 3040 --reload
"""
from __future__ import annotations
import logging
from fastapi import FastAPI, HTTPException
from .models import (SolverRequest, SolverResponse, ValidateRequest,
                      ValidateResponse, SwapRequest, SwapResponse,
                      RepairRequest, RepairResponse)
from .solver import solve, validate, find_swaps

logger = logging.getLogger("scheduler")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

app = FastAPI(title="School Timetable CP-SAT Solver", version="1.0.0")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "scheduler", "engine": "ortools-cp-sat"}


@app.post("/solve", response_model=SolverResponse)
def post_solve(req: SolverRequest) -> SolverResponse:
    try:
        return solve(req)
    except Exception as e:
        logger.exception("solver failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/validate", response_model=ValidateResponse)
def post_validate(req: ValidateRequest) -> ValidateResponse:
    try:
        return validate(req)
    except Exception as e:
        logger.exception("validator failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/swap", response_model=SwapResponse)
def post_swap(req: SwapRequest) -> SwapResponse:
    try:
        return find_swaps(req)
    except Exception as e:
        logger.exception("swap failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/repair", response_model=RepairResponse)
def post_repair(req: RepairRequest) -> RepairResponse:
    """Local repair — re-solve only the affected lessons after a manual move."""
    # For now, reuse the swap engine to find a target for the displaced occurrence.
    from .models import SwapRequest
    swap_req = SwapRequest(
        school=req.school, teachers=req.teachers, sections=req.sections,
        subjects=req.subjects, rooms=req.rooms, lessons=req.lessons,
        duties=req.duties, availability=req.availability, daysOff=req.daysOff,
        entries=req.entries,
        targetOccurrenceId=req.movedOccurrenceId,
        targetDay=req.newDay, targetPeriod=req.newPeriod,
    )
    swap_resp = find_swaps(swap_req)
    return RepairResponse(
        status="FEASIBLE" if swap_resp.suggestions else "UNKNOWN",
        feasible=bool(swap_resp.suggestions),
        entries=req.entries,
        stats=SolverStats(),
        conflicts=[],
        repaired=bool(swap_resp.suggestions),
        message="Repair candidates found" if swap_resp.suggestions
                 else "No repair candidates available",
    )
