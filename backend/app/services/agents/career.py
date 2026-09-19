"""Career agent: explains job-description -> course matches in plain language,
and can log a student's past internships/jobs from conversation.

Same split as the other agents: match_job_description calls the deterministic
engine (career_ops.recommend_courses_for_job — plain keyword overlap against
real catalog.course_version descriptions, no model guessing at course
content). The model's only job is to read that tool result and explain *why*
each course showed up, in the context of the student's profile and history —
never to invent a course, score, or match term itself.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from typing import Any

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services import career_ops
from app.services.catalog_queries import get_course_detail
from app.services.degree_ops import get_student_profile
from app.services.search import search_courses

BASE_SYSTEM_PROMPT = (
    "You are the UST Track career agent. You help students see how a job description maps onto "
    "HKUST's actual catalog, and keep a record of internships/jobs they've already done. "
    "Every course fact you state — code, title, why it matches — must come from a tool result in "
    "this conversation. Never describe a course from general knowledge, even to fill a small gap. "
    "Playbook: (1) get_student_profile once at the start of a conversation so you know their major "
    "and course history — don't ask for it if the tool already has it. (2) Whenever they paste or "
    "describe a job posting, call match_job_description with the full text verbatim. Then explain the "
    "result in plain language: which of their completed courses already cover parts of it (say why, "
    "using matched_terms), and which recommended courses would fill the gaps — mention in_major when "
    "true, since that means it's already free real estate in their degree. If already_relevant or "
    "recommended come back empty, say so plainly; don't pad it with generic advice. (3) If they "
    "describe an internship, job, or project they've done, offer to log it with add_experience, and "
    "call it once they confirm the details (title, organization, kind, dates if given). (4) "
    "list_experiences if they ask what's already logged; remove_experience if they ask to delete one. "
    "Write like a career advisor talking to one student: short, specific, no filler, no generic "
    "'strong communication skills' padding."
)

TOOLS: list[dict[str, Any]] = [
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
            "name": "match_job_description",
            "description": (
                "Deterministically match a job description against every course description in the "
                "catalog. Returns matched_keywords, already_relevant (courses the student has taken "
                "that already cover parts of the posting), and recommended (courses not yet taken, "
                "ranked, flagged in_major when they're already part of the student's degree). Always "
                "use this instead of judging fit yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {"job_description": {"type": "string"}},
                "required": ["job_description"],
            },
        },
    },
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
            "name": "list_experiences",
            "description": "List internships, jobs, and projects already logged for this student.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_experience",
            "description": "Log an internship, job, or project the student has already done.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "organization": {"type": "string"},
                    "kind": {"type": "string", "description": "internship, job, or project"},
                    "start_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
                    "end_date": {"type": "string", "description": "YYYY-MM-DD, optional"},
                    "description": {"type": "string", "description": "What they actually did"},
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "remove_experience",
            "description": "Delete a logged experience by its id (from list_experiences).",
            "parameters": {
                "type": "object",
                "properties": {"experience_id": {"type": "string"}},
                "required": ["experience_id"],
            },
        },
    },
]


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
    if name == "get_student_profile":
        return get_student_profile(db, planner_id), None
    if name == "match_job_description":
        result = career_ops.recommend_courses_for_job(db, planner_id, args.get("job_description", ""))
        return result, _marker("JOB_MATCH", result) if not result.get("error") else None
    if name == "search_courses":
        return search_courses(db, args.get("query", "")), None
    if name == "get_course":
        return get_course_detail(db, args["course_code"]), None
    if name == "list_experiences":
        return career_ops.list_experiences(db, planner_id), None
    if name == "add_experience":
        result = career_ops.add_experience(
            db,
            planner_id,
            args["title"],
            args.get("organization", ""),
            args.get("kind", "internship"),
            args.get("start_date"),
            args.get("end_date"),
            args.get("description", ""),
        )
        return result, _marker("EXPERIENCE_ADDED", {**result, "title": args["title"]}) if result.get("ok") else None
    if name == "remove_experience":
        result = career_ops.remove_experience(db, planner_id, args["experience_id"])
        return result, _marker("EXPERIENCE_REMOVED", result) if result.get("ok") else None
    return {"error": f"Unknown tool {name}"}, None


def stream_advisor(
    db: Session,
    messages: list[dict[str, str]],
    planner_id: str | None,
) -> Iterator[str]:
    settings = get_settings()
    if not settings.openrouter_api_key:
        yield "OPENROUTER_API_KEY is not configured on the server yet."
        return
    if not planner_id:
        yield "No planner_id was sent with this request."
        return

    client = _client()
    history: list[dict[str, Any]] = [{"role": "system", "content": BASE_SYSTEM_PROMPT}, *messages]

    try:
        for _ in range(8):
            completion = client.chat.completions.create(
                model=settings.openrouter_model,
                messages=history,
                tools=TOOLS,
                max_tokens=2500,
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
        yield f"\n\n[career agent error: {exc}]"
