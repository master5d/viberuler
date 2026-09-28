#!/usr/bin/env python3
"""Product numbers for the viberuler tab in a labwatch-style dashboard shell.

Writes dashboard/snapshot.json (sections: stats | rows | text | links). Public
endpoints only — the npm registry and viberuler.dev's own public API — so it needs
no credentials and is safe to run anywhere. Every source has a timeout; a source
that fails shows up as "?" plus a line saying why, never as a zero.

Run: python dashboard/ship_snapshot.py   (the shell runs it on a TTL)
"""
from __future__ import annotations

import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "snapshot.json"
API = os.environ.get("VIBERULER_API", "https://viberuler.dev")
TIMEOUT_S = 10


def _get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "viberuler-ship-snapshot",
                                               "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return json.loads(r.read().decode("utf-8"))


def collect() -> dict:
    items, rows, errors = [], [], []

    try:
        npm = _get_json("https://registry.npmjs.org/viberuler")
        latest = npm["dist-tags"]["latest"]
        items.append({"k": "npm latest", "v": latest})
        items.append({"k": "published", "v": (npm.get("time") or {}).get(latest, "?")[:10]})
    except Exception as e:  # noqa: BLE001 — any failure is reported, not raised
        items.append({"k": "npm latest", "v": "?", "status": "warn"})
        errors.append(f"npm registry: {type(e).__name__}: {e}")

    try:
        items.append({"k": "tokens benchmarked", "v": _get_json(f"{API}/api/stats-badge")["message"]})
    except Exception as e:  # noqa: BLE001
        items.append({"k": "tokens benchmarked", "v": "?", "status": "warn"})
        errors.append(f"stats-badge: {type(e).__name__}: {e}")

    try:
        lb = _get_json(f"{API}/api/leaderboard")
        items.append({"k": "on the board", "v": lb.get("total", "?")})
        for r in (lb.get("rows") or [])[:5]:
            rows.append([r.get("rank"), r.get("login"), r.get("vibe_score"),
                         r.get("tok_per_usd"), (r.get("submitted_at") or "")[:10]])
    except Exception as e:  # noqa: BLE001
        items.append({"k": "on the board", "v": "?", "status": "warn"})
        errors.append(f"leaderboard: {type(e).__name__}: {e}")

    sections = [{"type": "stats", "title": "Product", "items": items}]
    if rows:
        sections.append({"type": "rows", "title": "Leaderboard (top 5)",
                         "columns": ["#", "login", "vibe", "tok/$", "submitted"], "rows": rows})
    if errors:
        sections.append({"type": "text", "title": "Sources that failed", "body": "\n".join(errors)})
    return {"as_of": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sections": sections}


def main() -> int:
    snap = collect()
    # atomic replace: the shell may read the file while this runs
    fd, tmp = tempfile.mkstemp(dir=HERE, prefix=".snapshot-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    os.replace(tmp, OUT)
    failed = sum(1 for s in snap["sections"] if s.get("title") == "Sources that failed")
    print(f"snapshot -> {OUT}" + (" (some sources failed, see the file)" if failed else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
