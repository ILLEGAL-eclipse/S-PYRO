from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

Classification = Literal["MATCH", "DISCREPANCY", "CONTEXT MISMATCH", "NOT FOUND", "INSUFFICIENT EVIDENCE"]
IssueStatus = Literal["open", "acknowledged", "resolved", "not_applicable"]


class Citation(BaseModel):
    ref: str
    kind: str
    label: str
    investigation_id: str | None = None
    investigation_title: str | None = None
    publication_id: str | None = None
    publication_title: str | None = None
    page: int | None = None
    section: str | None = None
    figure: str | None = None
    table: str | None = None
    quote: str | None = None


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class AssistantQuery(BaseModel):
    message: str = Field(min_length=2, max_length=4000)
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    investigation_ids: list[str] | None = Field(default=None, max_length=10)


class AssistantResponse(BaseModel):
    answer: str
    citations: list[Citation]
    tool_trace: list[dict[str, Any]]
    warnings: list[str] = []
    usage: dict[str, int] = {}


class CompareRequest(BaseModel):
    investigation_ids: list[str] = Field(min_length=2, max_length=6)
    generate_summary: bool = False


class MissionEnvironment(BaseModel):
    mission_type: Literal["iss", "spacecraft", "lunar_habitat", "martian_habitat", "pressurised_rover", "custom"] = "custom"
    gravity_g: float | None = Field(default=None, ge=0, le=100, description="Gravity in units of g (1 g = 9.80665 m/s2)")
    oxygen_percent: float | None = Field(default=None, ge=0, le=100)
    pressure_kpa: float | None = Field(default=None, gt=0, le=100000)
    temperature_k: float | None = Field(default=None, gt=0, le=10000)
    atmosphere_composition: str | None = Field(default=None, max_length=300)
    objective: str | None = Field(default=None, max_length=1000)
    limit: int = Field(default=10, ge=1, le=25)

    @model_validator(mode="after")
    def need_something(self):
        if all(v is None or v == "" for v in (self.gravity_g, self.oxygen_percent, self.pressure_kpa,
                                               self.temperature_k, self.objective, self.atmosphere_composition)):
            raise ValueError("Provide at least one environmental parameter or a research objective.")
        return self


class IssueUpdate(BaseModel):
    status: IssueStatus
    researcher_note: str | None = Field(default=None, max_length=2000)


class ValidationItem(BaseModel):
    """A researcher-supplied scientific statement, as parsed from the input (never altered)."""
    kind: Literal["parameter", "claim"] = "parameter"
    parameter: str | None = None
    value: str | None = None
    unit: str | None = None
    context: str | None = None
    text: str | None = None
    investigation_hint: str | None = None
    cited_publication: str | None = None
    cited_page: int | None = None
    cited_figure: str | None = None
    cited_table: str | None = None
    raw: str | None = None
