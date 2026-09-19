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
from app.services import degree_ops, planner_ops
from app.services.catalog_queries import get_course_detail, list_programs
from app.services.search import search_courses

Mode = Literal["suggest", "auto"]

BASE_SYSTEM_PROMPT = (
    "You are the USTrack degree agent, grounded strictly in HKUST's actual program catalog "
    "— not general knowledge about universities, degrees, or HKUST specifically. Every fact "
    "you state about a program, requirement, or credit count must come from a tool result "
    "in this conversation. You may know real facts about HKUST's actual programs from "
    "training — never use them here, even to fill a gap or sound more complete; this app's "
    "catalog is deliberately partial right now and your job is to reflect that, not paper "
    "over it. If a program or requirement isn't returned by a tool, say plainly that it "
    "isn't in the catalog yet — do not describe what it 'typically' or 'usually' requires "
    "from general knowledge of degree programs. You help a student figure out and build "
    "their pathway — major, minor, extended major, additional major, or dual degree. "
    "Always call get_student_profile before reasoning about what a student has done, and "
    "check_requirement_progress before claiming a program is or isn't a good fit — never "
    "estimate progress from memory. Before proposing or declaring a second program "
    "(minor/extended/additional/dual), call check_pathway_compatibility against everything "
    "already declared and mention any course overlaps plainly — an overlapping course "
    "usually counts toward only one program, not both. When comparing options, present "
    "them as trade-offs, not rankings: say what each path protects and what it costs, not "
    "which is 'best'. Keep answers concrete: program codes, requirement group names, "
    "specific missing courses."
)

SUGGEST_ADDENDUM = (
    " You are in SUGGEST mode: you cannot declare a program yourself. Use "
    "propose_declare_program to put one forward — the student applies it themselves. "
    "Never say a program has been declared; only that you're proposing it."
)

AUTO_ADDENDUM = (
    " You are in AUTO mode: use declare_program directly once you and the student have "
    "landed on a choice — don't wait for a separate confirmation step. Still run "
    "check_pathway_compatibility first and tell them about any overlaps you found."
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
            "description": "List every program in the catalog with its code, name, and school.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_student_profile",
            "description": "Get the student's declared programs and course history (completed/in-progress/planned).",
            "parameters": {"type": "object", "properties": {}},
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
                "properties": {"program_code": {"type": "string"}},
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
        "program_code": {"type": "string"},
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
        "name": "propose_declare_program",
        "description": "Propose declaring a program for the student without writing anything yet. Returns any compatibility overlaps.",
        "parameters": _DECLARE_PARAMS,
    },
}

DECLARE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "declare_program",
        "description": "Declare a program directly for the student. Returns any compatibility overlaps with what's already declared.",
        "parameters": _DECLARE_PARAMS,
    },
}


def _tools_for_mode(mode: Mode) -> list[dict[str, Any]]:
    action_tool = PROPOSE_TOOL if mode == "suggest" else DECLARE_TOOL
    return [*READ_TOOLS, REMOVE_TOOL, MARK_COURSE_TOOL, action_tool]


def _system_prompt(mode: Mode) -> str:
    return BASE_SYSTEM_PROMPT + (SUGGEST_ADDENDUM if mode == "suggest" else AUTO_ADDENDUM)


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


def _execute_tool(db: Session, planner_id: str, name: str, args: dict[str, Any]) -> tuple[Any, str | None]:
    """Returns (result, marker_or_None)."""
    if name == "search_courses":
        return search_courses(db, args.get("query", "")), None
    if name == "get_course":
        return get_course_detail(db, args["course_code"]), None
    if name == "list_programs":
        return list_programs(db), None
    if name == "get_student_profile":
        return degree_ops.get_student_profile(db, planner_id), None
    if name == "check_requirement_progress":
        return degree_ops.check_requirement_progress(db, planner_id, args["program_code"]), None
    if name == "check_pathway_compatibility":
        return degree_ops.check_pathway_compatibility(db, planner_id, args.get("program_codes", [])), None
    if name == "mark_course":
        return planner_ops.add_planned_course(db, planner_id, args["course_code"], args.get("status", "planned")), None
    if name == "remove_declared_program":
        result = degree_ops.remove_declared_program(db, planner_id, args["program_code"])
        return result, _marker("PROGRAM_REMOVED", result) if result.get("ok") else None
    if name == "propose_declare_program":
        result = degree_ops.preview_declare_program(db, planner_id, args["program_code"], args["role"])
        return result, _marker("PROGRAM_SUGGEST", result) if result.get("proposed") else None
    if name == "declare_program":
        result = degree_ops.declare_program(db, planner_id, args["program_code"], args["role"])
        return result, _marker("PROGRAM_APPLIED", result) if result.get("ok") else None
    return {"error": f"Unknown tool {name}"}, None


def stream_advisor(
    db: Session,
    messages: list[dict[str, str]],
    planner_id: str | None,
    mode: Mode = "suggest",
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
    history: list[dict[str, Any]] = [{"role": "system", "content": _system_prompt(mode)}, *messages]

    try:
        for _ in range(8):
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
                result, marker = _execute_tool(db, planner_id, call.function.name, args)
                if marker:
                    yield marker
                history.append(
                    {"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, default=str)}
                )
    except Exception as exc:  # surfaced to the chat UI, not swallowed
        yield f"\n\n[degree agent error: {exc}]"
