from .compare import CompareArgs, compare_investigations
from .ranking import RankArgs, rank_investigations
from .retrieval import BASE_TOOLS, Tool

TOOLS: dict[str, Tool] = {
    **BASE_TOOLS,
    "compare_investigations": (CompareArgs, compare_investigations,
        "Structured comparison of 2-6 investigations: conditions (same/different/missing), findings, objectives."),
    "rank_investigations": (RankArgs, rank_investigations,
        "Rank investigations by similarity of documented conditions to requested gravity (g), oxygen %, pressure kPa, "
        "temperature K and/or a research objective. Returns explainable relevance scores (discovery aid only)."),
}
