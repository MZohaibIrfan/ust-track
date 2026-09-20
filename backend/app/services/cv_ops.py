"""Generate a one-page LaTeX CV from a student's degree profile and logged
experiences, using the well-known "Jake's Resume" template structure.

Deterministic string assembly, no LLM involved — the source data (major,
courses, logged experiences) is already real; this just lays it out. Contact
info and skills are supplied fresh on each request rather than stored, since
they're not otherwise part of the student's planner data.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from datetime import date
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import CvGeneration
from app.services.career_ops import list_experiences
from app.services.degree_ops import get_student_profile
from app.services.planner_ops import get_or_create_planner


class PdfCompilerMissing(Exception):
    """No LaTeX toolchain (pdflatex) found on this machine."""


class PdfCompileError(Exception):
    """pdflatex ran but the document failed to compile — carries its log."""

    def __init__(self, log: str):
        super().__init__("LaTeX compilation failed")
        self.log = log

_LATEX_SPECIAL = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}
_LATEX_SPECIAL_RE = re.compile("|".join(re.escape(c) for c in _LATEX_SPECIAL))

DEGREE_LENGTH_YEARS = 4
DEFAULT_INSTITUTION = "The Hong Kong University of Science and Technology"
DEFAULT_LOCATION = "Hong Kong, HK"

# Catalog program names for minors are often already prefixed ("Minor Program
# in Bioengineering") — strip that before adding our own "Minor in" so it
# doesn't double up into "Minor in Minor Program in Bioengineering".
_MINOR_PREFIX_RE = re.compile(r"^\s*minor\s+(program\s+)?in\s+", re.IGNORECASE)
_EXTENDED_MAJOR_RE = re.compile(r"extended\s+major", re.IGNORECASE)

# Roles that name a second, co-equal degree (joined onto the major with "&"),
# vs. roles that add a credential alongside it (joined with ", "). None means
# a role that isn't a credential worth listing (e.g. school_requirement).
CO_MAJOR_ROLES = {"second_major", "additional_major", "dual_degree"}


def _format_extra_role(role: str, name: str) -> str | None:
    if role == "minor":
        return f"Minor in {_MINOR_PREFIX_RE.sub('', name).strip()}"
    if role == "extended_major":
        return name if _EXTENDED_MAJOR_RE.search(name) else f"Extended Major in {name}"
    if role == "school_requirement":
        return None
    return name


def _escape(text: str | None) -> str:
    if not text:
        return ""
    return _LATEX_SPECIAL_RE.sub(lambda m: _LATEX_SPECIAL[m.group()], text)


def _format_month_year(iso_date: str | None) -> str:
    if not iso_date:
        return ""
    y, m, _ = iso_date.split("-")
    return date(int(y), int(m), 1).strftime("%b %Y")


def _date_range(start: str | None, end: str | None) -> str:
    start_s = _format_month_year(start)
    end_s = _format_month_year(end) if end else ("Present" if start else "")
    if start_s and end_s:
        return f"{start_s} -- {end_s}"
    return start_s or end_s


def _bullets(description: str) -> str:
    lines = [line.strip("-• \t") for line in description.splitlines() if line.strip()]
    if not lines:
        return ""
    items = "\n".join(f"      \\resumeItem{{{_escape(line)}}}" for line in lines)
    return f"      \\resumeItemListStart\n{items}\n      \\resumeItemListEnd\n"


def _subheading_entry(exp: dict[str, Any]) -> str:
    dates = _date_range(exp["start_date"], exp["end_date"])
    body = (
        f"    \\resumeSubheading\n"
        f"      {{{_escape(exp['title'])}}}{{{_escape(dates)}}}\n"
        f"      {{{_escape(exp['organization'])}}}{{{_escape(exp['location'])}}}\n"
    )
    bullets = _bullets(exp["description"])
    return body + (bullets if bullets else "")


def _project_entry(exp: dict[str, Any]) -> str:
    dates = _date_range(exp["start_date"], exp["end_date"])
    heading = f"\\textbf{{{_escape(exp['title'])}}}"
    if exp["organization"]:
        heading += f" $|$ \\emph{{{_escape(exp['organization'])}}}"
    body = f"    \\resumeProjectHeading\n      {{{heading}}}{{{_escape(dates)}}}\n"
    bullets = _bullets(exp["description"])
    return body + (bullets if bullets else "")


def _section(title: str, entries: list[str]) -> str:
    if not entries:
        return ""
    body = "\n".join(entries)
    return (
        f"\\section{{{title}}}\n"
        f"  \\resumeSubHeadingListStart\n"
        f"{body}\n"
        f"  \\resumeSubHeadingListEnd\n\n"
    )


def _default_degree_line(profile: dict[str, Any]) -> str:
    major = next((d for d in profile["declared_programs"] if d["role"] == "major"), None)
    degree_line = major["name"] if major and major.get("name") else "Undergraduate Studies"

    co_majors: list[str] = []
    extras: list[str] = []
    for d in profile["declared_programs"]:
        if d["role"] == "major" or not d.get("name"):
            continue
        if d["role"] in CO_MAJOR_ROLES:
            co_majors.append(d["name"])
            continue
        formatted = _format_extra_role(d["role"], d["name"])
        if formatted:
            extras.append(formatted)

    if co_majors:
        degree_line += " & " + " & ".join(co_majors)
    if extras:
        degree_line += ", " + ", ".join(extras)
    return degree_line


def _default_dates(profile: dict[str, Any]) -> str:
    entry_year = profile.get("entry_year") or profile.get("intake_year")
    return f"Aug {entry_year} -- May {entry_year + DEGREE_LENGTH_YEARS}" if entry_year else ""


def education_defaults(db: Session, planner_id: str) -> dict[str, str]:
    """The same auto-derived education fields generate_cv_latex falls back
    to, exposed so the CV builder can prefill an editable form with them."""
    profile = get_student_profile(db, planner_id)
    return {
        "institution": DEFAULT_INSTITUTION,
        "location": DEFAULT_LOCATION,
        "degree_line": _default_degree_line(profile),
        "dates": _default_dates(profile),
    }


def _education_section(
    profile: dict[str, Any],
    institution: str = "",
    location: str = "",
    degree_line: str = "",
    dates: str = "",
) -> str:
    institution = institution.strip() or DEFAULT_INSTITUTION
    location = location.strip() or DEFAULT_LOCATION
    degree_line = degree_line.strip() or _default_degree_line(profile)
    dates = dates.strip() or _default_dates(profile)

    entry = (
        "    \\resumeEducation\n"
        f"      {{{_escape(institution)}}}{{{_escape(location)}}}\n"
        f"      {{{_escape(degree_line)}}}{{{_escape(dates)}}}\n"
    )
    return _section("Education", [entry])


def _skills_section(skills_lines: list[str]) -> str:
    rows = [line.strip() for line in skills_lines if line.strip()]
    if not rows:
        return ""
    items = []
    for line in rows:
        if ":" in line:
            label, rest = line.split(":", 1)
            items.append(f"     \\textbf{{{_escape(label.strip())}}}{{: {_escape(rest.strip())}}} \\\\")
        else:
            items.append(f"     {_escape(line)} \\\\")
    body = "\n".join(items)
    return (
        "\\section{Technical Skills}\n"
        " \\begin{itemize}[leftmargin=0.15in, label={}]\n"
        "    \\small{\\item{\n"
        f"{body}\n"
        "    }}\n"
        " \\end{itemize}\n\n"
    )


PREAMBLE = r"""\documentclass[letterpaper,10pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.7in}
\addtolength{\textheight}{1.4in}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-6pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\pdfgentounicode=1

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-4pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

% Like resumeSubheading, but the subtitle (degree/major line) is a wrapping
% paragraph column instead of a plain "l" column — a long "Major, Minor in
% X, Second Major in Y" line would otherwise run straight off the page since
% tabular* never wraps an "l" cell.
\newcommand{\resumeEducation}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
    \end{tabular*}\vspace{2pt}
    \begin{tabular*}{0.97\textwidth}[t]{@{}p{0.72\textwidth}@{\extracolsep{\fill}}r@{}}
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-6pt}}

\begin{document}
"""


def generate_cv_latex(
    db: Session,
    planner_id: str,
    full_name: str,
    email: str = "",
    phone: str = "",
    linkedin: str = "",
    github: str = "",
    website: str = "",
    skills_text: str = "",
    include_ids: list[str] | None = None,
    education_institution: str = "",
    education_location: str = "",
    education_degree_line: str = "",
    education_dates: str = "",
) -> str:
    profile = get_student_profile(db, planner_id)
    experiences = list_experiences(db, planner_id)["experiences"]
    if include_ids is not None:
        wanted = set(include_ids)
        experiences = [e for e in experiences if e["id"] in wanted]

    by_kind: dict[str, list[dict[str, Any]]] = {"internship": [], "project": [], "extracurricular": [], "research": []}
    for exp in experiences:
        by_kind.setdefault(exp["kind"], []).append(exp)

    contact_bits = []
    if phone:
        contact_bits.append(_escape(phone))
    if email:
        contact_bits.append(f"\\href{{mailto:{email}}}{{\\underline{{{_escape(email)}}}}}")
    if linkedin:
        contact_bits.append(f"\\href{{{linkedin}}}{{\\underline{{LinkedIn}}}}")
    if github:
        contact_bits.append(f"\\href{{{github}}}{{\\underline{{GitHub}}}}")
    if website:
        contact_bits.append(f"\\href{{{website}}}{{\\underline{{Website}}}}")
    contact_line = " $|$ ".join(contact_bits)

    header = (
        "\\begin{center}\n"
        f"    \\textbf{{\\Huge \\scshape {_escape(full_name) or 'Your Name'}}} \\\\ \\vspace{{1pt}}\n"
        f"    \\small {contact_line}\n"
        "\\end{center}\n\n"
    )

    sections = [
        _education_section(profile, education_institution, education_location, education_degree_line, education_dates),
        _section("Experience", [_subheading_entry(e) for e in by_kind.get("internship", [])]),
        _section("Research Experience", [_subheading_entry(e) for e in by_kind.get("research", [])]),
        _section("Projects", [_project_entry(e) for e in by_kind.get("project", [])]),
        _section("Extracurricular Activities", [_subheading_entry(e) for e in by_kind.get("extracurricular", [])]),
        _skills_section(skills_text.splitlines()),
    ]

    return PREAMBLE + header + "".join(sections) + "\\end{document}\n"


def compile_pdf(latex: str) -> bytes:
    """Shell out to pdflatex to render the CV. Raises PdfCompilerMissing if no
    LaTeX install is found on this machine, or PdfCompileError (with the log)
    if the document itself fails to compile."""
    pdflatex = shutil.which("pdflatex")
    if pdflatex is None:
        raise PdfCompilerMissing("pdflatex is not installed on this server")

    with tempfile.TemporaryDirectory() as tmp:
        tex_path = Path(tmp) / "resume.tex"
        tex_path.write_text(latex, encoding="utf-8")

        # tabularx column widths need a second pass to settle.
        for _ in range(2):
            result = subprocess.run(
                [pdflatex, "-interaction=nonstopmode", "-halt-on-error", "resume.tex"],
                cwd=tmp,
                capture_output=True,
                text=True,
                timeout=30,
            )

        pdf_path = Path(tmp) / "resume.pdf"
        if not pdf_path.exists():
            raise PdfCompileError(result.stdout[-4000:])
        return pdf_path.read_bytes()


def save_generation(
    db: Session,
    planner_id: str,
    full_name: str,
    latex: str,
    experience_count: int,
    name: str = "",
) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    row = CvGeneration(
        planner_id=planner.id,
        full_name=full_name.strip() or "Your Name",
        name=name.strip(),
        latex=latex,
        experience_count=experience_count,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": str(row.id),
        "name": row.name,
        "full_name": row.full_name,
        "experience_count": row.experience_count,
        "created_at": row.created_at.isoformat(),
    }


def list_generations(db: Session, planner_id: str) -> list[dict[str, Any]]:
    planner = get_or_create_planner(db, planner_id)
    rows = db.scalars(
        select(CvGeneration).where(CvGeneration.planner_id == planner.id).order_by(CvGeneration.created_at.desc())
    ).all()
    return [
        {
            "id": str(row.id),
            "name": row.name,
            "full_name": row.full_name,
            "experience_count": row.experience_count,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


def get_generation_latex(db: Session, planner_id: str, generation_id: str) -> str | None:
    planner = get_or_create_planner(db, planner_id)
    row = db.scalar(
        select(CvGeneration).where(CvGeneration.planner_id == planner.id, CvGeneration.id == UUID(generation_id))
    )
    return row.latex if row else None


def delete_generation(db: Session, planner_id: str, generation_id: str) -> dict[str, Any]:
    planner = get_or_create_planner(db, planner_id)
    removed = (
        db.query(CvGeneration)
        .filter(CvGeneration.planner_id == planner.id, CvGeneration.id == UUID(generation_id))
        .delete()
    )
    db.commit()
    return {"ok": True, "removed": removed > 0}


__all__ = [
    "generate_cv_latex",
    "compile_pdf",
    "PdfCompilerMissing",
    "PdfCompileError",
    "save_generation",
    "list_generations",
    "get_generation_latex",
    "delete_generation",
    "education_defaults",
]
