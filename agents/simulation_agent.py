"""Simulation agent: start a run, watch it, read the report back.

Private: it only answers the orchestrator. It starts nothing it does not own
and writes no results -- scoring stays in the Node worker (the JEV key must
never reach an agent) and the report is written by Claude in the worker. This
agent only calls `start_run` and reads rows.
"""

from __future__ import annotations

import time
import uuid

import config
import stdb
from contracts import (
    ProgressRequest,
    ProgressResult,
    RunRequest,
    RunResult,
)
from uagents import Agent, Context

agent = Agent(
    name="reel-simulation",
    seed=config.AGENT_SEED_SIMULATION or None,
    publish_agent_details=False,
)

TERMINAL = {"complete", "failed"}

# Matches the browser's defaults. Stated in the reply, never hidden:
# the first round exposes 10% of the audience.
SEED_EXPOSURE = 0.1
MAX_ROUNDS = 6


def island_url(run_id: str) -> str:
    return f"{config.ISLAND_URL}/workspace?run={run_id}"


async def profile_for(video: dict) -> dict | None:
    pid = video.get("profile_id") or config.PROFILE_ID
    if not pid:
        return None
    rows = await stdb.sql(f"SELECT * FROM company_profile WHERE id = {stdb.quote(pid)}")
    return rows[0] if rows else None


@agent.on_message(RunRequest, replies=RunResult)
async def handle_run(ctx: Context, sender: str, msg: RunRequest):
    ctx.logger.info(f"[{msg.request_id}] start run for video {msg.content_id}")
    try:
        run_id = await start(msg.content_id)
    except stdb.StdbError as exc:
        await ctx.send(sender, RunResult(request_id=msg.request_id, error=str(exc)))
        return

    await ctx.send(
        sender,
        RunResult(request_id=msg.request_id, run_id=run_id, island_url=island_url(run_id)),
    )


async def start(video_id: str) -> str:
    """Call start_run and return the new run's id."""
    videos = await stdb.sql(f"SELECT * FROM video WHERE id = {video_id}")
    if not videos:
        raise stdb.StdbError(f"no video with id {video_id}")
    video = videos[0]
    if video.get("status") != "ready":
        raise stdb.StdbError(f"video {video_id} is '{video.get('status')}', not analysed yet")

    profile = await profile_for(video)
    if not profile:
        raise stdb.StdbError("no company profile for that video; set PROFILE_ID")

    client_key = f"agent-{uuid.uuid4().hex[:12]}"
    options = [
        int(time.time()) % 2**31,          # seed
        int(profile.get("audience_version", 1)),
        SEED_EXPOSURE,
        MAX_ROUNDS,
    ]
    await stdb.call(
        "start_run",
        [
            client_key,
            profile["id"],
            video.get("campaign_id") or config.CAMPAIGN_ID,
            int(video["id"]),
            f"{video.get('label', 'Run')} (ASI:One)",
            options,
        ],
    )

    rows = await stdb.sql(f"SELECT * FROM run WHERE client_key = {stdb.quote(client_key)}")
    if not rows:
        raise stdb.StdbError("start_run returned no run row")
    return str(rows[0]["id"])


@agent.on_message(ProgressRequest, replies=ProgressResult)
async def handle_progress(ctx: Context, sender: str, msg: ProgressRequest):
    try:
        result = await progress(msg.request_id, msg.run_id)
    except stdb.StdbError as exc:
        await ctx.send(
            sender,
            ProgressResult(request_id=msg.request_id, run_id=msg.run_id, error=str(exc)),
        )
        return
    await ctx.send(sender, result)


async def progress(request_id: str, run_id: str) -> ProgressResult:
    runs = await stdb.sql(f"SELECT * FROM run WHERE id = {run_id}")
    if not runs:
        raise stdb.StdbError(f"no run with id {run_id}")
    run = runs[0]
    status = run.get("status", "")

    # The worker publishes its own progress text on the job row.
    jobs = await stdb.sql(f"SELECT * FROM job WHERE target_id = {stdb.quote(run_id)}")
    active = [j for j in jobs if j.get("status") in ("queued", "claimed")]
    stage = ""
    if active:
        stage = active[-1].get("stage") or ""
    failed_job = next((j for j in jobs if j.get("status") == "failed"), None)

    report_status = ""
    reports = await stdb.sql(f"SELECT * FROM report WHERE run_id = {run_id}")
    if reports:
        report_status = reports[0].get("status", "")

    error = ""
    if status == "failed":
        error = run.get("failure_reason") or "the run failed"
    elif failed_job and status not in TERMINAL:
        error = failed_job.get("error") or "a worker job failed"

    done = (status == "complete" and report_status in ("ready", "failed")) or bool(error)

    return ProgressResult(
        request_id=request_id,
        run_id=run_id,
        status=status,
        stage=stage,
        report_status=report_status,
        done=done,
        error=error,
    )


async def read_results(request_id: str, run_id: str) -> RunResult:
    """Metrics and the finished report. The agent never writes either."""
    runs = await stdb.sql(f"SELECT * FROM run WHERE id = {run_id}")
    if not runs:
        return RunResult(request_id=request_id, run_id=run_id, error="the run disappeared")
    run = runs[0]

    if run.get("status") == "failed":
        return RunResult(
            request_id=request_id,
            run_id=run_id,
            island_url=island_url(run_id),
            error=run.get("failure_reason") or "the run failed",
        )

    metrics = run.get("metrics") or {}
    summary = format_metrics(metrics)

    report_text = ""
    reports = await stdb.sql(f"SELECT * FROM report WHERE run_id = {run_id}")
    if reports:
        report = reports[0]
        if report.get("status") == "ready":
            report_text = report.get("summary", "")
        elif report.get("status") == "failed":
            report_text = f"(the report could not be written: {report.get('error') or 'unknown error'})"

    return RunResult(
        request_id=request_id,
        run_id=run_id,
        metrics_summary=summary,
        report_text=report_text,
        island_url=island_url(run_id),
    )


def format_metrics(metrics: dict) -> str:
    if not metrics:
        return "No metrics were recorded."
    def n(key: str) -> int:
        value = metrics.get(key)
        return int(value) if isinstance(value, (int, float)) else 0

    coverage = metrics.get("coverage")
    lines = [
        f"- Reached **{n('unique_exposed')}** of the simulated audience over {n('rounds')} rounds",
        f"- Watched through: **{n('watch')}**  ·  Likes: **{n('likes')}**  ·  "
        f"Comments: **{n('comments')}**  ·  Shares: **{n('shares')}**",
    ]
    if isinstance(coverage, (int, float)):
        lines.append(f"- Scored {coverage:.0%} of the audience ({n('missing')} members had no prediction)")
    spread = metrics.get("spread") or {}
    if isinstance(spread, dict) and spread.get("p50") is not None:
        lines.append(
            f"- Across 200 seeded trials, total actions ranged "
            f"P10 {spread.get('p10', 0):.0f} / P50 {spread.get('p50', 0):.0f} / P90 {spread.get('p90', 0):.0f}"
        )
    return "\n".join(lines)
