"""FlareLine geometry engine: pure calculation, no GUI, no I/O."""
from .analysis import (BendResult, DevelopmentOptions, RouteAnalysis, SegmentResult,
                       TubeSection, analyze, estimate_extrados_wall)
from .formats import (BendStep, Frame, LegData, LraData, RotationConvention,
                      legs_to_lra, legs_to_route, lra_to_legs, lra_to_route,
                      route_to_legs, route_to_lra)
from .interference import check_self_interference
from .issues import Issue, Severity
from .route import TubeRoute
from .springback import SpringbackTable
from .validation import CheckLimits, validate

__all__ = [
    "BendResult", "BendStep", "CheckLimits", "DevelopmentOptions", "Frame", "Issue",
    "LegData", "LraData", "RotationConvention", "RouteAnalysis", "SegmentResult",
    "Severity", "SpringbackTable", "TubeRoute", "TubeSection", "analyze",
    "check_self_interference", "estimate_extrados_wall", "legs_to_lra", "legs_to_route",
    "lra_to_legs", "lra_to_route", "route_to_legs", "route_to_lra", "validate",
]
