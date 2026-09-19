"""Timetable agent: suggests or directly schedules class sections.

Two modes, chosen per request by the toggle in the UI:
  - "suggest": the agent can only *propose* a section (propose_class_selection,
    a dry run — no write). The client renders it as a card with an Apply
    button; clicking Apply hits POST /api/timetable/apply, which calls the
    exact same planner_ops.add_class_selection used by auto mode.
  - "auto": the agent calls add_class_selection directly and it lands on the
    calendar immediately.

Either way the write path is identical (planner_ops.add_class_selection) —
mode only changes which tool is on the menu for this request, not what the
write does.

Tool results for a proposal or a completed write are also emitted as
"<<SUGGEST:...>>" / "<<APPLIED:...>>" markers (base64 JSON) interleaved into
the plain-text stream, so the UI can render structured cards instead of
parsing prose.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from typing import Any, Literal

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import planner_ops
from app.services.catalog_queries import get_course_detail
from app.services.search import search_courses

Mode = Literal["suggest", "auto"]

BASE_SYSTEM_PROMPT = (
    "You are the UST Track timetable agent, grounded strictly in HKUST's actual catalog — "
    "not general knowledge about universities or courses. Every fact you state about a "
    "course, section, or meeting time must come from a tool result in this conversation. "
    "You may know real facts about HKUST or about university scheduling in general from "
    "training — never use them here, even to fill a small gap or sound more complete. If a "
    "course, section, or term isn't returned by a tool, say plainly that it's not in the "
    "catalog yet — do not describe it from memory or general expectation of what a course "
    "like that 'usually' involves. Prefer sections with no time conflict; if every option "
    "conflicts, say so plainly and name what it clashes with. Keep answers short and "
    "concrete: course code, section, meeting time — not generic advice."
)

SUGGEST_ADDENDUM = (
    " You are in SUGGEST mode: you cannot add anything to the calendar yourself. Use "
    "propose_class_selection to put a section forward — the student applies it themselves. "
    "Never claim a class has been added; only that you're suggesting it."
)

AUTO_ADDENDUM = (
    " You are in AUTO mode: use add_class_selection directly to put a class on the "
    "calendar as soon as you've found a good, non-conflicting option — don't ask for "
    "confirmation first. Tell the student what you added and why."
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
            "description": "Get full detail for one course: description, rules, and offerings/sections/meetings by term.",
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
            "name": "get_plan",
            "description": "Fetch everything currently on the student's calendar: scheduled class selections with meeting times.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

REMOVE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "remove_class_selection",
        "description": "Take a class section off the calendar. Omit section_code to remove every section of that course.",
        "parameters": {
            "type": "object",
            "properties": {
                "course_code": {"type": "string"},
                "section_code": {"type": "string"},
            },
            "required": ["course_code"],
        },
    },
}

_SECTION_PARAMS = {
    "type": "object",
    "properties": {
        "course_code": {"type": "string"},
        "section_code": {"type": "string"},
        "term_code": {
            "type": "string",
            "description": "Optional exact term code if the course is offered in more than one term",
        },
    },
    "required": ["course_code", "section_code"],
}

PROPOSE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "propose_class_selection",
        "description": "Propose one class section for the calendar without writing anything yet. Returns any conflicts it would have.",
        "parameters": _SECTION_PARAMS,
    },
}

ADD_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "add_class_selection",
        "description": "Put one class section directly onto the calendar. Returns any conflicts with what's already there.",
        "parameters": _SECTION_PARAMS,
    },
}


def _tools_for_mode(mode: Mode) -> list[dict[str, Any]]:
    action_tool = PROPOSE_TOOL if mode == "suggest" else ADD_TOOL
    return [*READ_TOOLS, REMOVE_TOOL, action_tool]


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
    if name == "get_plan":
        return planner_ops.resolve_plan(db, planner_id), None
    if name == "remove_class_selection":
        result = planner_ops.remove_class_selection(db, planner_id, args["course_code"], args.get("section_code"))
        return result, _marker("REMOVED", result) if result.get("ok") else None
    if name == "propose_class_selection":
        result = planner_ops.preview_class_selection(
            db, planner_id, args["course_code"], args["section_code"], args.get("term_code")
        )
        return result, _marker("SUGGEST", result) if result.get("proposed") else None
    if name == "add_class_selection":
        result = planner_ops.add_class_selection(
            db, planner_id, args["course_code"], args["section_code"], args.get("term_code")
        )
        return result, _marker("APPLIED", result) if result.get("ok") else None
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
                max_tokens=2000,
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
        yield f"\n\n[timetable agent error: {exc}]"
