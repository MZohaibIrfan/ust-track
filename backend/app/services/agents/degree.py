"""Degree/pathway agent: helps a student build a major/minor/extended/dual
pathway, replacing the wireframe's click-through track screens (4A-4E) with a
conversational flow over the same underlying operations.

Same split as the timetable agent: the model decides which programs to look
at, what to compare, and whether a combination is worth proposing; the actual
requirement matching and overlap detection (degree_ops.check_requirement_progress,
check_pathway_compatibility) is deterministic code the model can't fudge.

Two modes, same convention as the timetable agent:
  - "suggest": only propose_declare_program is available (dry run, returns
    compatibility overlaps, writes nothing) -> rendered as a card with Apply.
  - "auto": declare_program is available and writes immediately.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from typing import Any, Literal

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import degree_ops, planner_ops, study_plan_ops
from app.services.catalog_queries import get_course_detail, get_program_detail, list_programs, search_programs
from app.services.search import search_courses

Mode = Literal["suggest", "auto"]

BASE_SYSTEM_PROMPT = (
    "You are the USTrack degree agent. Students talk like students: elec, cs, mech, it, big data, "
    "electrical, computer engineering. That is enough. Do not ask them to say the official catalog code. "
    "When they name a field, call search_programs with their words, or pass those words as program_code — "
    "tools resolve nicknames. HKUST's ELEC is Electronic Engineering; there is no separate Electrical major "
    "in this catalog, so elec/electrical maps to ELEC. Never invent a program a tool did not return. "
    "The student's intake_year is the catalog they are bound to (e.g. intake 2025 → 2025-26). "
    "Never suggest skipped_unavailable or a later catalog year. "
    "Playbook: (1) get_student_profile first. If a major is already declared, do not ask what their "
    "major is. (2) If they named a program in slang or English, search_programs then check_requirement_progress "
    "and propose_pathway for that code. (3) If they want options / a minor / extended major without naming one, "
    "rank_add_on_pathways, then propose the top 2–3 with catalog data. (4) Talk in tool results: codes, "
    "already_counting, still_open, major_overlap. (5) list_pathways if they ask what they already opened. "
    "(6) Exchange, leave, or rearranging the study plan: get_study_plan, then propose_term_status "
    "(suggest) or apply_term_status (auto). Year 3 fall is year=3 season=fall. The tool moves courses "
    "and sets deferral.needed when they no longer fit in years 1–4 — say that and suggest deferring. "
    "Never invent a rearranged plan. Write like an advisor: short, specific. No filler."
)

SUGGEST_ADDENDUM = (
    " SUGGEST mode: propose_pathway / propose_term_status / propose_move_course only — the student applies. "
    "Never claim a pathway or study-plan change was written."
)

AUTO_ADDENDUM = (
    " AUTO mode: if they asked for options, still propose_pathway for 2–3 ranked add-ons. "
    "Use create_pathway only when they named a specific program. After create_pathway, say the label "
    "and that they can switch to it in the pathway menu. For exchange, leave, or study-plan moves, "
    "use apply_term_status / apply_move_course directly."
)

READ_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_courses",
            "description": "Search the catalog by keyword against course code or title.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_programs",
            "description": (
                "Resolve what the student said (elec, electrical, cs, mech, big data, it, ai) "
                "to catalog program codes. Call this whenever they name a field in English or slang "
                "instead of an official code."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_course",
            "description": "Get full detail for one course: description, rules, and offerings.",
            "parameters": {
                "type": "object",
                "properties": {"course_code": {"type": "string"}},
                "required": ["course_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_programs",
            "description": "List programs that exist in this student's intake catalog year, with code, name, school, kind, and catalog_year.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_program",
            "description": "Get one program's scraped requirement tree (groups, alternative courses, electives) for a catalog year.",
            "parameters": {
                "type": "object",
                "properties": {
                    "program_code": {"type": "string"},
                    "intake_year": {"type": "integer", "description": "Catalog intake year, e.g. 2025 for 2025-26"},
                },
                "required": ["program_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_student_profile",
            "description": "Get standing year, intake_year, catalog_year, declared programs, and course history.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_pathways",
            "description": "List this student's home profile and any what-if pathways already created.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rank_add_on_pathways",
            "description": (
                "Deterministically rank catalog minors and extended majors that existed in this "
                "student's intake year, by how many of their courses already appear in that year's "
                "requirement tree. Use this whenever they ask to generate pathways, add a minor, "
                "or see options. Do not eyeball fit yourself. Ignore skipped_unavailable (not offered "
                "that year) and skipped_empty."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "kinds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Subset of minor, extended_major. Default both.",
                    },
                    "limit": {"type": "integer", "description": "How many options to return (default 5)."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_requirement_progress",
            "description": (
                "Deterministically compute how much of one program's requirement tree the "
                "student's course history satisfies — which items are done, in progress, or "
                "missing. Use this instead of estimating fit yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "program_code": {"type": "string", "description": "Official code or slang (elec, cs, big data)."},
                    "intake_year": {"type": "integer"},
                },
                "required": ["program_code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_pathway_compatibility",
            "description": (
                "Deterministically find courses that would double-count across two or more "
                "programs (e.g. a minor course that's already required by the major). Pass "
                "every program code in the candidate combination, including ones already declared."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "program_codes": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["program_codes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_study_plan",
            "description": (
                "Read the student's current study-plan draft: each term's status (regular / exchange / "
                "leave), the courses on it, and anything still unplaced. Use this before proposing "
                "exchange, leave, or a rearrangement."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

REMOVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "remove_declared_program",
        "description": "Remove a program from the student's declared pathway.",
        "parameters": {
            "type": "object",
            "properties": {"program_code": {"type": "string"}},
            "required": ["program_code"],
        },
    },
}

MARK_COURSE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "mark_course",
        "description": "Record a course in the student's history with a status (completed, in_progress, or planned).",
        "parameters": {
            "type": "object",
            "properties": {
                "course_code": {"type": "string"},
                "status": {"type": "string", "description": "completed, in_progress, or planned"},
            },
            "required": ["course_code", "status"],
        },
    },
}

_DECLARE_PARAMS = {
    "type": "object",
    "properties": {
        "program_code": {
            "type": "string",
            "description": "Official code or slang (elec, cs, mech, big data).",
        },
        "role": {
            "type": "string",
            "description": "major, minor, extended_major, second_major, additional_major, dual_degree, or school_requirement",
        },
    },
    "required": ["program_code", "role"],
}

PROPOSE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_pathway",
        "description": (
            "Propose a pathway without writing. If the home profile has no major, this is "
            "declaring that major. If it already has a major, this is a new what-if copy "
            "plus the extra program (minor/extended/etc.)."
        ),
        "parameters": _DECLARE_PARAMS,
    },
}

DECLARE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "create_pathway",
        "description": (
            "Write a pathway. No major yet: declare it on the home profile. Otherwise copy "
            "the current profile and declare the extra program on the copy. Returns planner_id "
            "for the new pathway."
        ),
        "parameters": _DECLARE_PARAMS,
    },
}

_TERM_STATUS_PARAMS = {
    "type": "object",
    "properties": {
        "year": {"type": "integer", "description": "Programme year, e.g. 3 for Year 3."},
        "season": {"type": "string", "description": "fall or spring"},
        "status": {"type": "string", "description": "exchange, leave, or regular"},
    },
    "required": ["year", "season", "status"],
}

_MOVE_PARAMS = {
    "type": "object",
    "properties": {
        "course_id": {"type": "string", "description": "Study-plan course id, or a course code if id is unknown."},
        "year": {"type": "integer", "description": "Target programme year. Omit to unplace."},
        "season": {"type": "string", "description": "fall or spring. Omit to unplace."},
    },
    "required": ["course_id"],
}

PROPOSE_TERM_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_term_status",
        "description": (
            "Dry-run: mark a whole semester as exchange, leave, or regular. Moves unlocked courses "
            "off an exchange/leave term onto later regular terms. If they no longer fit in years 1–4, "
            "deferral.needed is true and Year 5 is added. Does not write until the student clicks Apply."
        ),
        "parameters": _TERM_STATUS_PARAMS,
    },
}

APPLY_TERM_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "apply_term_status",
        "description": "Same as propose_term_status but applied immediately in auto mode.",
        "parameters": _TERM_STATUS_PARAMS,
    },
}

PROPOSE_MOVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_move_course",
        "description": "Dry-run: move one study-plan course to another regular term, or unplace it.",
        "parameters": _MOVE_PARAMS,
    },
}

APPLY_MOVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "apply_move_course",
        "description": "Same as propose_move_course but applied immediately in auto mode.",
        "parameters": _MOVE_PARAMS,
    },
}


def _tools_for_mode(mode: Mode) -> list[dict[str, Any]]:
    if mode == "suggest":
        return [*READ_TOOLS, REMOVE_TOOL, MARK_COURSE_TOOL, PROPOSE_TOOL, PROPOSE_TERM_TOOL, PROPOSE_MOVE_TOOL]
    return [
        *READ_TOOLS,
        REMOVE_TOOL,
        MARK_COURSE_TOOL,
        PROPOSE_TOOL,
        DECLARE_TOOL,
        PROPOSE_TERM_TOOL,
        APPLY_TERM_TOOL,
        PROPOSE_MOVE_TOOL,
        APPLY_MOVE_TOOL,
    ]


def _system_prompt(mode: Mode, profile: dict[str, Any] | None = None, roster: str | None = None) -> str:
    extra = ""
    if profile:
        major = next((d for d in profile.get("declared_programs", []) if d.get("role") == "major"), None)
        extra = (
            f" This student: standing_year={profile.get('standing_year')}, "
            f"intake_year={profile.get('intake_year')}, catalog_year={profile.get('catalog_year')}, "
            f"major={(major or {}).get('code')}. Bind every suggestion to that catalog year."
        )
    if roster:
        extra += f" Programs in their catalog year: {roster}"
    extra += " Slang: elec/electrical/ee=ELEC Electronic Engineering; cs/comp=COMP; ce=CPEG; mech=MECH; it=MINOR-IT; big data=MINOR-BDT; ai=AI; extended ai=EXTM-AI."
    return BASE_SYSTEM_PROMPT + extra + (SUGGEST_ADDENDUM if mode == "suggest" else AUTO_ADDENDUM)


def _client() -> OpenAI:
    settings = get_settings()
    return OpenAI(
        api_key=settings.openrouter_api_key,
        base_url="https://openrouter.ai/api/v1",
        default_headers={"HTTP-Referer": "http://localhost:5173", "X-Title": "UST Track"},
    )


def _marker(kind: str, payload: Any) -> str:
    encoded = base64.b64encode(json.dumps(payload, default=str).encode()).decode()
    return f"<<{kind}:{encoded}>>"


def _plan_marker(kind: str, result: dict[str, Any]) -> str | None:
    if not result.get("ok"):
        return None
    payload = {k: v for k, v in result.items() if k != "draft"}
    return _marker(kind, payload)


def _execute_tool(
    db: Session,
    planner_id: str,
    name: str,
    args: dict[str, Any],
    ctx: dict[str, Any],
) -> tuple[Any, str | None]:
    """Returns (result, marker_or_None)."""
    intake_year = degree_ops.planner_intake_year(db, planner_id)
    draft = ctx.get("study_plan")
    if name == "search_courses":
        return search_courses(db, args.get("query", "")), None
    if name == "search_programs":
        return search_programs(db, args.get("query", ""), intake_year), None
    if name == "get_course":
        return get_course_detail(db, args["course_code"], intake_year), None
    if name == "list_programs":
        return list_programs(db, intake_year), None
    if name == "get_program":
        return get_program_detail(db, args["program_code"], args.get("intake_year", intake_year)), None
    if name == "get_student_profile":
        return degree_ops.get_student_profile(db, planner_id), None
    if name == "list_pathways":
        return degree_ops.list_pathways(db, planner_id), None
    if name == "rank_add_on_pathways":
        kinds = args.get("kinds") or None
        limit = int(args["limit"]) if args.get("limit") is not None else 5
        return degree_ops.rank_add_on_pathways(db, planner_id, kinds, limit), None
    if name == "check_requirement_progress":
        return degree_ops.check_requirement_progress(
            db, planner_id, args["program_code"], args.get("intake_year", intake_year)
        ), None
    if name == "check_pathway_compatibility":
        return degree_ops.check_pathway_compatibility(db, planner_id, args.get("program_codes", [])), None
    if name == "get_study_plan":
        return study_plan_ops.summarize(draft), None
    if name in ("propose_term_status", "apply_term_status"):
        result = study_plan_ops.set_term_status(draft, args["year"], args["season"], args["status"])
        if result.get("ok") and result.get("draft"):
            ctx["study_plan"] = result["draft"]
        kind = "PLAN_APPLIED" if name == "apply_term_status" else "PLAN_SUGGEST"
        return result, _plan_marker(kind, result)
    if name in ("propose_move_course", "apply_move_course"):
        result = study_plan_ops.move_course(draft, args["course_id"], args.get("year"), args.get("season"))
        if result.get("ok") and result.get("draft"):
            ctx["study_plan"] = result["draft"]
        kind = "PLAN_APPLIED" if name == "apply_move_course" else "PLAN_SUGGEST"
        return result, _plan_marker(kind, result)
    if name == "mark_course":
        return planner_ops.add_planned_course(db, planner_id, args["course_code"], args.get("status", "planned")), None
    if name == "remove_declared_program":
        result = degree_ops.remove_declared_program(db, planner_id, args["program_code"])
        return result, _marker("PROGRAM_REMOVED", result) if result.get("ok") else None
    if name == "propose_pathway" or name == "propose_declare_program":
        result = degree_ops.preview_pathway(db, planner_id, args["program_code"], args["role"])
        return result, _marker("PROGRAM_SUGGEST", result) if result.get("proposed") else None
    if name == "create_pathway" or name == "declare_program":
        result = degree_ops.create_pathway(db, planner_id, args["program_code"], args["role"])
        return result, _marker("PROGRAM_APPLIED", result) if result.get("ok") else None
    return {"error": f"Unknown tool {name}"}, None


def stream_advisor(
    db: Session,
    messages: list[dict[str, str]],
    planner_id: str | None,
    mode: Mode = "suggest",
    study_plan: dict[str, Any] | None = None,
    focus: str | None = None,
) -> Iterator[str]:
    settings = get_settings()
    if not settings.openrouter_api_key:
        yield "OPENROUTER_API_KEY is not configured on the server yet."
        return
    if not planner_id:
        yield "No planner_id was sent with this request."
        return

    client = _client()
    tools = _tools_for_mode(mode)
    profile = degree_ops.get_student_profile(db, planner_id)
    offered = list_programs(db, profile.get("intake_year"))
    roster = "; ".join(f"{row['code']}={row['name']}" for row in offered)
    prompt = _system_prompt(mode, profile, roster)
    if focus == "plan":
        prompt += " The student is on the Study plan page — prefer study-plan tools over declaring programs."
    elif focus == "requirements":
        prompt += " The student is on the Requirements page — prefer check_requirement_progress."
    ctx: dict[str, Any] = {"study_plan": study_plan}
    history: list[dict[str, Any]] = [{"role": "system", "content": prompt}, *messages]

    try:
        for _ in range(12):
            completion = client.chat.completions.create(
                model=settings.openrouter_model,
                messages=history,
                tools=tools,
                max_tokens=3500,
            )
            choice = completion.choices[0]
            message = choice.message

            if choice.finish_reason != "tool_calls" or not message.tool_calls:
                if message.content:
                    yield message.content
                return

            history.append(
                {
                    "role": "assistant",
                    "content": message.content,
                    "tool_calls": [
                        {
                            "id": call.id,
                            "type": "function",
                            "function": {"name": call.function.name, "arguments": call.function.arguments},
                        }
                        for call in message.tool_calls
                    ],
                }
            )

            for call in message.tool_calls:
                args = json.loads(call.function.arguments or "{}")
                result, marker = _execute_tool(db, planner_id, call.function.name, args, ctx)
                if marker:
                    yield marker
                tool_result = {k: v for k, v in result.items() if k != "draft"} if isinstance(result, dict) else result
                history.append(
                    {"role": "tool", "tool_call_id": call.id, "content": json.dumps(tool_result, default=str)}
                )
    except Exception as exc:  # surfaced to the chat UI, not swallowed
        yield f"\n\n[degree agent error: {exc}]"
