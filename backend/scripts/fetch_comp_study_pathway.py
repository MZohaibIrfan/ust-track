"""Download the official CSE COMP study-pathway PDF into data/raw/.

The structured dataset lives in backend/app/data/study_pathways/.
This script only fetches the source file (not committed).

Usage (from backend/):  python scripts/fetch_comp_study_pathway.py
"""

from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen

URL = "https://cse.hkust.edu.hk/ug/comp/study_pathways_COMP_2025-26_intake.pdf"
DEST = Path(__file__).resolve().parents[2] / "data" / "raw" / "study_pathways_COMP_2025-26_intake.pdf"


def main() -> None:
    DEST.parent.mkdir(parents=True, exist_ok=True)
    req = Request(URL, headers={"User-Agent": "UST-Track/1.0"})
    with urlopen(req) as resp:
        DEST.write_bytes(resp.read())
    print(f"Wrote {DEST} ({DEST.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
