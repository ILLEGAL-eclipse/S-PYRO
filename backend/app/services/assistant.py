"""S-PYRO research assistant: Gemini function-calling loop over controlled retrieval tools."""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException
from pydantic import ValidationError

from ..config import get_settings
from ..schemas import AssistantQuery, AssistantResponse
from .gemini_client import get_client, log_usage, usage_of
from .refs import RefRegistry
from .retrieval import ToolError
from .tools import TOOLS

SYSTEM_PROMPT = """You are S-PYRO, a scientific research assistant for NASA combustion science. You help researchers discover, \
retrieve, organise, summarise, compare and understand investigations documented in the S-PYRO research database. \
Researchers make all decisions; you assist.

HOW TO WORK
- Be efficient: plan which records you need, then request ALL independent tool calls together in a single step (they run in parallel). Prefer search_research_text for open questions and avoid repeating a search that already returned results. Most answers need at most two retrieval steps.
- Answer scientific questions ONLY from records returned by your retrieval tools. Call tools first; call more tools when the evidence \
is incomplete. Never assume a record exists.
- Every sentence that states a scientific fact, condition, number or finding must end with a citation marker such as [R3] or [R3, R5], \
using ONLY ref ids that appeared in tool results. Never invent a ref, paper, page, figure, table or number.
- Report numbers exactly as in the tool results, with their units and context. Do not compute, extrapolate or round new values.
- Distinguish evidence types: say when something is an author interpretation, a numerical/model result or an experimental observation \
(use each finding's evidence_type). Anything under 'ai_generated_summary' is an AI-written summary, not evidence: label it as such and do not cite it as a finding.
- If the database has no information, say so plainly ("S-PYRO has no record of ...") and name what is missing. Do not fill gaps with \
general knowledge. You may briefly explain scientific terminology from general knowledge, but label it as a general definition (no citation, no numbers).
- Do not compare values with different units, contexts or physical meaning as if they were equivalent; point out the difference.

YOU MUST NEVER
- prescribe engineering solutions or give fire-safety recommendations or say a design/agent/material will be safe or effective;
- present speculation as experimental evidence or invent results, measurements or papers;
- declare a researcher's information scientifically incorrect (you may only report what the sources document);
- treat relevance scores as safety ratings.
When asked for advice or a recommendation, instead summarise what the documented research reports, with citations, and state that \
the decision rests with the researcher.

STYLE: simple markdown (bullets, **bold**). You may use LaTeX only for symbols and equations, written as $...$ inline or $$...$$ on its own line (e.g. $S_L$, $\\phi$, $T_{ad}$); write numbers with units as plain text (0.5 atm, 298 K), not inside math. Be concise, structured, precise. Use short paragraphs or bullet lists. Mention investigation codes. Refer to units explicitly."""

_CITE_NUM = re.compile(r"(?<![\w.\[])\d+(?:\.\d+)?(?![\w\]])")


def _declarations():
    from google.genai import types

    def clean(schema):
        if isinstance(schema, dict):
            return {k: clean(v) for k, v in schema.items() if k != "title"}
        if isinstance(schema, list):
            return [clean(x) for x in schema]
        return schema

    return [types.FunctionDeclaration(name=n, description=d, parameters_json_schema=clean(m.model_json_schema()))
            for n, (m, _f, d) in TOOLS.items()]


def _shrink(obj, cap: int) -> str:
    """Serialise a tool result, trimming list tails until it fits the context budget."""
    text = json.dumps(obj, default=str)
    guard = 0
    while len(text) > cap and guard < 200:
        guard += 1
        longest = None

        def walk(o):
            nonlocal longest
            if isinstance(o, dict):
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                if len(o) > 1 and (longest is None or len(o) > len(longest)):
                    longest = o
                for v in o:
                    walk(v)
        walk(obj)
        if longest is None:
            return text[:cap]
        longest.pop()
        text = json.dumps(obj, default=str)
    return text


def execute_tool(name: str, args: dict, reg: RefRegistry) -> tuple[dict, bool]:
    if name not in TOOLS:
        return {"error": f"Unknown tool '{name}'."}, False
    model, fn, _ = TOOLS[name]
    try:
        parsed = model.model_validate(args or {})
        return fn(parsed, reg), True
    except ValidationError as e:
        msgs = "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()[:5])
        return {"error": f"Invalid parameters: {msgs}"}, False
    except ToolError as e:
        return {"error": str(e)}, False
    except HTTPException as e:
        return {"error": str(e.detail)}, False
    except Exception as e:  # never leak internals to the model
        log_usage("tool_error", error=f"{name}: {type(e).__name__}: {str(e)[:150]}")
        return {"error": "The retrieval tool failed."}, False


def _thinking_config(types):
    lvl = get_settings().gemini_thinking_level
    return types.ThinkingConfig(thinking_level=lvl) if lvl else None


def iter_assistant(req: AssistantQuery, user_id: str | None = None):
    """Run the retrieval/answer loop, yielding progress events:
      {"type":"step","id","tool","arguments","status":"running"|"ok"|"error", ...}
      {"type":"delta","text"}  /  {"type":"reset"}  /  {"type":"final","response":{...}}
    Independent tool calls in one model turn run in parallel; text is streamed as it is generated."""
    from google.genai import types
    s = get_settings()
    client = get_client()
    reg = RefRegistry()

    contents = []
    for t in req.history[-(s.assistant_max_history_turns * 2):]:
        contents.append(types.Content(role="user" if t.role == "user" else "model", parts=[types.Part.from_text(text=t.content)]))
    msg = req.message
    if req.investigation_ids:
        msg += f"\n\n[Scope: the researcher is focused on investigations {', '.join(req.investigation_ids)}.]"
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=msg)]))

    decls = types.Tool(function_declarations=_declarations())
    trace: list[dict] = []
    corpus: list[str] = []
    tin = tout = ncalls = 0
    per_result_cap = max(3000, s.assistant_max_context_chars // 4)
    answer = ""
    step_no = 0
    try:
        for rnd in range(s.assistant_max_tool_rounds + 1):
            last = rnd == s.assistant_max_tool_rounds
            cfg = types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT, temperature=0.2, max_output_tokens=s.assistant_max_output_tokens,
                tools=None if last else [decls], thinking_config=_thinking_config(types),
                automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
            parts, calls, text = [], [], ""
            for chunk in client.models.generate_content_stream(model=s.gemini_model, contents=contents, config=cfg):
                um = getattr(chunk, "usage_metadata", None)
                if um:
                    tin_r, tout_r = (um.prompt_token_count or 0), (um.candidates_token_count or 0)
                cand = chunk.candidates[0] if chunk.candidates else None
                if not cand or not cand.content or not cand.content.parts:
                    continue
                for part in cand.content.parts:
                    parts.append(part)
                    if getattr(part, "function_call", None) and not last:
                        calls.append(part.function_call)
                    elif part.text and not getattr(part, "thought", False):
                        text += part.text
                        yield {"type": "delta", "text": part.text}
            try:
                tin, tout = tin + tin_r, tout + tout_r
            except NameError:
                pass
            if not calls:
                answer = text
                break
            if text:
                yield {"type": "reset"}           # any preamble text is superseded by the tool results
            contents.append(types.Content(role="model", parts=parts))
            batch = calls[:6]
            ids = []
            for call in batch:
                step_no += 1
                ids.append(step_no)
                yield {"type": "step", "id": step_no, "tool": call.name, "arguments": dict(call.args or {}), "status": "running"}
            ncalls += len(batch)

            def run(call):
                return execute_tool(call.name, dict(call.args or {}), reg)
            if len(batch) > 1:
                with ThreadPoolExecutor(max_workers=min(4, len(batch))) as pool:
                    results = list(pool.map(run, batch))
            else:
                results = [run(batch[0])]

            resp_parts = []
            for sid, call, (result, ok) in zip(ids, batch, results):
                payload_text = _shrink(result, per_result_cap)
                corpus.append(payload_text)
                entry = {"tool": call.name, "arguments": dict(call.args or {}), "ok": ok, "error": result.get("error") if not ok else None}
                if ok and call.name == "get_experimental_conditions":
                    entry["conditions"] = [{"parameter": c["parameter"], "value": c["value"], "unit": c["unit"], "context": c["context"],
                                            "ref": c["ref"]} for c in result.get("conditions", [])[:14]]
                trace.append(entry)
                n = next((v for k, v in result.items() if isinstance(v, int) and k in ("returned", "total_matches")), None) if ok else None
                yield {"type": "step", "id": sid, "tool": call.name, "arguments": entry["arguments"], "status": "ok" if ok else "error",
                       "error": entry["error"], "returned": n}
                try:
                    payload = json.loads(payload_text)
                except ValueError:
                    payload = {"truncated_json": payload_text}
                resp_parts.append(types.Part.from_function_response(name=call.name, response={"result": payload}))
            if rnd == s.assistant_max_tool_rounds - 1:
                resp_parts.append(types.Part.from_text(text="Retrieval budget used up. Write the final answer now from the evidence already "
                                                            "retrieved, with [R#] citations; state plainly anything the records do not contain."))
            contents.append(types.Content(role="user", parts=resp_parts))
    except HTTPException:
        raise
    except Exception as e:
        log_usage("assistant", tin, tout, ncalls, error=f"{type(e).__name__}: {str(e)[:200]}", user_id=user_id)
        raise HTTPException(502, "The AI service is unavailable or returned an error. Please try again.")

    log_usage("assistant", tin, tout, ncalls, user_id=user_id)
    if not answer.strip():
        answer = "S-PYRO could not produce an answer from the retrieved records. Try rephrasing or narrowing the question."
    clean, cites, warnings = reg.resolve_answer(answer)
    if not ncalls:
        warnings.append("No database retrieval was performed for this answer; treat it as general information, not documented research.")
    elif not cites:
        warnings.append("This answer contains no source citations.")
    blob = " ".join(corpus)
    unverified = sorted({n for n in _CITE_NUM.findall(re.sub(r"\[R[\d, R]+\]", "", clean))
                         if (len(n) >= 3 or "." in n) and n not in blob})
    if unverified and ncalls:
        warnings.append("Numbers in the answer not found verbatim in retrieved records: " + ", ".join(unverified[:8]) +
                        ". Verify against the cited sources.")
    yield {"type": "final", "response": AssistantResponse(
        answer=clean, citations=cites, tool_trace=trace, warnings=warnings,
        usage={"input_tokens": tin, "output_tokens": tout, "tool_calls": ncalls}).model_dump()}


def run_assistant(req: AssistantQuery, user_id: str | None = None) -> AssistantResponse:
    final = None
    for ev in iter_assistant(req, user_id):
        if ev["type"] == "final":
            final = ev["response"]
    return AssistantResponse(**final)


COMPARE_SYSTEM = """You write evidence-based comparison summaries for NASA combustion research investigations from a structured \
comparison table. Use ONLY the supplied data. Cite every factual statement with its [R#] marker (only refs present in the data). \
Describe similarities, differences, missing information and what cannot be compared (different units/contexts). Do NOT decide which \
investigation is better, do NOT recommend engineering solutions, do NOT infer results that are not in the data, and do not treat \
author interpretations as experimental observations. Keep it under 300 words."""


def summarise_comparison(data: dict, reg: RefRegistry, user_id: str | None = None):
    from google.genai import types
    s = get_settings()
    client = get_client()
    payload = _shrink(data, s.assistant_max_context_chars)
    try:
        resp = client.models.generate_content(
            model=s.gemini_model, contents=payload,
            config=types.GenerateContentConfig(system_instruction=COMPARE_SYSTEM, temperature=0.1,
                                               max_output_tokens=s.assistant_max_output_tokens))
    except Exception as e:
        log_usage("compare_summary", error=f"{type(e).__name__}: {str(e)[:200]}", user_id=user_id)
        raise HTTPException(502, "The AI service is unavailable or returned an error.")
    i, o = usage_of(resp)
    log_usage("compare_summary", i, o, user_id=user_id)
    clean, cites, warnings = reg.resolve_answer(resp.text or "")
    return clean, cites, warnings
