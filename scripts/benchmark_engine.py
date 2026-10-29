"""Isolated local comparison; never reads or mutates the user's Library.

Run from the repository root with:
.venv/bin/python scripts/benchmark_engine.py

No downloads, credentials, native editor, models, or real network are used.
The baseline is the previous local-read/admission behavior reproduced here;
the comparison invokes the current application implementation. This measures
local DB work and request-worker contention, not end-to-end import/image time.
"""

import json
import os
import platform
import sqlite3
import statistics
import sys
from pathlib import Path
import tempfile
import time
from threading import Event, Lock
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    with tempfile.TemporaryDirectory(prefix="shortforge-after-audit-") as temporary:
        os.environ["SHORTFORGE_DATA_DIR"] = temporary
        import anyio
        from fastapi import HTTPException
        from starlette.concurrency import run_in_threadpool
        from engine.core import db, routes, thumbnails
        from engine.core.source_urls import is_youtube_clip

        rows = [
            (
                f"clip-{index}",
                f"ig:Audit{index:06}",
                f"https://www.instagram.com/reel/Audit{index:06}/",
                f"Clip {index}",
                "A" * 990,
                f"2026-10-30T{index // 3600:02}:{index // 60 % 60:02}:{index % 60:02}+00:00",
            )
            for index in range(5000)
        ]
        with db.connect() as conn:
            conn.executemany(
                "INSERT INTO clips(id,video_id,url,title,description,created_at) VALUES(?,?,?,?,?,?)",
                rows,
            )
        ids = [row[0] for row in rows[:100]]

        def previous_enrichment_reads():
            clips = [db.get_clip(identity) for identity in ids]
            external = {
                clip["video_id"]: clip for clip in clips if is_youtube_clip(clip)
            }
            # Instagram rows exercise the full local-read stage and then return
            # before configuration or any provider request in both versions.
            assert not external

        measurements = {"previous_ms": [], "implemented_ms": []}
        previous_enrichment_reads()
        routes.enrich_clips(ids)
        for _ in range(15):
            start = time.perf_counter()
            previous_enrichment_reads()
            measurements["previous_ms"].append((time.perf_counter() - start) * 1000)
            start = time.perf_counter()
            routes.enrich_clips(ids)
            measurements["implemented_ms"].append((time.perf_counter() - start) * 1000)
        with patch.object(db, "connect", wraps=db.connect) as connects:
            routes.enrich_clips(ids)
            read_connections = connects.call_count
        results = {
            "environment": {
                "python": platform.python_version(),
                "sqlite": sqlite3.sqlite_version,
                "system": platform.system(),
                "logical_cpus": os.cpu_count(),
            },
            "enrichment": {
                "library_clips": 5000,
                "requested_clips": 100,
                "samples": 15,
                "median_ms": {
                    key: round(statistics.median(value), 3)
                    for key, value in measurements.items()
                },
                "samples_ms": {
                    key: [round(sample, 3) for sample in value]
                    for key, value in measurements.items()
                },
                "implemented_connections": read_connections,
                "scope": "Local reads only; no provider/network time",
            },
        }

        async def thumbnail_case(gated):
            release, done = Event(), Event()
            guard = Lock()
            counts = {"entered": 0}
            get_clip = db.get_clip

            def counted_clip(identity):
                result = get_clip(identity)
                with guard:
                    counts["entered"] += 1
                return result

            def unavailable(_):
                assert release.wait(3), "bounded fixture deadline exceeded"
                raise ValueError("Unavailable synthetic thumbnail")

            async def request(identity):
                try:
                    if gated:
                        await routes.preview_clip(identity)
                    else:
                        # Original sync endpoint admission: its whole lookup was
                        # dispatched to the default worker pool by FastAPI.
                        await run_in_threadpool(thumbnails.clip_thumbnail, identity)
                except HTTPException as error:
                    assert error.status_code == 404

            record = {}

            async def unrelated_request():
                start = time.perf_counter()
                await run_in_threadpool(lambda: None)
                record["unrelated_dispatch_ms"] = round(
                    (time.perf_counter() - start) * 1000, 3
                )
                done.set()

            with (
                patch.object(db, "get_clip", counted_clip),
                patch.object(thumbnails, "remote_thumbnail", unavailable),
            ):
                async with anyio.create_task_group() as group:
                    try:
                        for identity in ids[:40]:
                            group.start_soon(request, identity)
                        with anyio.fail_after(2):
                            while counts["entered"] < (3 if gated else 40):
                                await anyio.sleep(0.005)
                        record["borrowed_default_workers"] = (
                            anyio.to_thread.current_default_thread_limiter().borrowed_tokens
                        )
                        group.start_soon(unrelated_request)
                        await anyio.sleep(0.2)
                        record["blocked_after_200_ms"] = not done.is_set()
                    finally:
                        release.set()
            return record

        async def compare():
            assert anyio.to_thread.current_default_thread_limiter().total_tokens == 40
            return {
                "before": await thumbnail_case(False),
                "after": await thumbnail_case(True),
                "requests": 40,
                "scope": (
                    "Injected extractor hold; no real network. Before uses original "
                    "synchronous admission, after uses the async route. This measures "
                    "unrelated worker dispatch, not HTTP/browser thumbnail latency."
                ),
            }

        results["thumbnail_admission"] = anyio.run(compare)
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
