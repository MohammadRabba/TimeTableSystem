"""Solver package — exposes solve(), validate(), find_swaps()."""
from .driver import solve
from .validator import validate
from .conflict_analyzer import analyze
from .repair import find_swaps

__all__ = ["solve", "validate", "analyze", "find_swaps"]
