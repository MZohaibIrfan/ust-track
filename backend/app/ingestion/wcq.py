"""WCQ Class Schedule & Quota parser. Not implemented."""

from __future__ import annotations

from typing import Any


def fetch_term_index(term_code: str) -> list[str]:
    raise NotImplementedError("WCQ term index fetch is not implemented")


def fetch_subject_page(term_code: str, subject: str) -> str:
    raise NotImplementedError("WCQ subject page fetch is not implemented")


def parse_days_times(value: str) -> list[dict[str, Any]]:
    raise NotImplementedError("WCQ meeting parse is not implemented")


def parse_subject_html(html: str) -> list[dict[str, Any]]:
    raise NotImplementedError("WCQ HTML parse is not implemented")
