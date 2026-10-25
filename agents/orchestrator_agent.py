"""Orchestrator: the one agent ASI:One can see.

Implements the Agent Chat Protocol. It parses the chat message, asks the
ingest and simulation agents to do the work, streams progress lines back into
the conversation, and finishes with the metrics, the report and a link to the
island. It computes nothing itself.
"""

from __future__ import annotations

import asyncio
import re
import time
import uuid
from typing import Any

import config
import simulation_agent
from contracts import (
    IngestRequest,
    IngestResult,
    ProgressRequest,
    ProgressResult,
    RunRequest,
    RunResult,
)
from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from ingest_agent import agent as ingest
from simulation_agent import agent as simulation

INGEST_ADDRESS = ingest.address
SIMULATION_ADDRESS = simulation.address

agent = Agent(
    name="reels-orchestrator",
    seed=config.AGENT_SEED_ORCHESTRATOR or None,
    port=config.BUREAU_PORT,
    mailbox=not config.LOCAL_ONLY,
    publish_agent_details=not config.LOCAL_ONLY,
    handle=config.AGENT_HANDLE or None,
    handle_messages_concurrently=True,
    readme_path=str(config.AGENTS_DIR / "AGENT_README.md"),
    description=(
        "Tests how a short video lands with different audiences before you "
        "publish it. Send a reel link or say 'test demo' and it runs a private "
        "audience simulation, streams progress, and returns engagement "
        "numbers and a written report."
    ),
)

chat_proto = Protocol(spec=chat_protocol_spec)

URL_RE = re.compile(r"https?://\S+")
# "test demo", "run the demo video", "simulate this reel", or just "demo". A bare "run" or "test"
# inside another sentence ("what do you do to run it?") must not start a simulation.
START_RE = re.compile(r"\b(?:test|run|simulate)\b[\s\w]{0,24}?\b(?:demo|reel|video)\b")
def wants_simulation(low: str) -> bool:
    return low.strip(" .!?") in ("demo", "test", "simulate") or START_RE.search(low) is not None

HELP = """**Reel Rehearsal** — see how a video lands before you post it.

- `test demo` — run the simulation on the loaded demo video.
- Paste an Instagram reel link and I'll test it.

I'll stream progress while it runs, then give you the simulated engagement
numbers and the written report.

These are **simulated** audience reactions, not predictions of real
engagement. The first round exposes 10% of the audience and the scoring
calibration is fixed."""


async def say(ctx: Context, to: str, text: str, *, end: bool = False) -> None:
    content: list[Any] = [TextContent(text=text)]
    if end:
        content.append(EndSessionContent())
    await ctx.send(to, ChatMessage(content=content))


async def ask(
    ctx: Context, address: str, message: Any, response_type: type, request_id: str
) -> Any:
    """Send a request and wait for the reply that carries our request_id."""
    reply, _ = await ctx.send_and_receive(
        address,
        message,
        response_type=response_type,
        timeout=config.WORKER_TIMEOUT_SECONDS,
    )
    if reply is None:
        return None
    if getattr(reply, "request_id", None) != request_id:
        ctx.logger.warning(f"ignoring reply for {getattr(reply, 'request_id', '?')}")
        return None
    return reply


async def run_workflow(ctx: Context, sender: str, url: str) -> None:
    request_id = uuid.uuid4().hex

    # 1. Resolve what we are going to test.
    if url:
        await say(ctx, sender, f"Looking up {url} …")
    ingested = await ask(
        ctx, INGEST_ADDRESS, IngestRequest(request_id=request_id, url=url), IngestResult, request_id
    )
    if ingested is None:
        await say(ctx, sender, "The ingest agent did not respond. Nothing was started.", end=True)
        return
    if ingested.error:
        await say(ctx, sender, f"I could not get a video to test: {ingested.error}", end=True)
        return
    if ingested.note:
        await say(ctx, sender, ingested.note)

    subject = ingested.title or f"video {ingested.content_id}"
    await say(ctx, sender, f"Starting a private audience simulation for **{subject}**.")

    # 2. Start the run.
    started = await ask(
        ctx,
        SIMULATION_ADDRESS,
        RunRequest(request_id=request_id, content_id=ingested.content_id),
        RunResult,
        request_id,
    )
    if started is None:
        await say(ctx, sender, "The simulation agent did not respond. Nothing was started.", end=True)
        return
    if started.error:
        await say(ctx, sender, f"The run could not be started: {started.error}", end=True)
        return

    run_id = started.run_id
    await say(ctx, sender, f"Run `{run_id}` is going.")

    # 3. Stream progress until the run and its report settle.
    deadline = time.monotonic() + config.RUN_TIMEOUT_SECONDS
    last = ""
    failure = ""
    while time.monotonic() < deadline:
        poll_id = uuid.uuid4().hex
        status = await ask(
            ctx,
            SIMULATION_ADDRESS,
            ProgressRequest(request_id=poll_id, run_id=run_id),
            ProgressResult,
            poll_id,
        )
        if status is None:
            await asyncio.sleep(config.POLL_SECONDS)
            continue

        line = progress_line(status)
        if line and line != last:
            await say(ctx, sender, line)
            last = line

        if status.error:
            failure = status.error
            break
        if status.done:
            break
        await asyncio.sleep(config.POLL_SECONDS)
    else:
        await say(
            ctx,
            sender,
            f"The run is still going after {config.RUN_TIMEOUT_SECONDS}s. It keeps running in the background.",
            end=True,
        )
        return

    if failure:
        await say(
            ctx,
            sender,
            f"The run failed: {failure}\n\nNothing was published.",
            end=True,
        )
        return

    # 4. Read the finished numbers and the worker's report.
    results = await simulation_agent.read_results(request_id, run_id)
    await say(ctx, sender, render(subject, results), end=True)


def progress_line(status: ProgressResult) -> str:
    if status.stage:
        return status.stage
    if status.status == "scoring":
        return "Scoring the audience…"
    if status.status == "cascading":
        return "Running the sharing cascade…"
    if status.status == "complete" and status.report_status == "writing":
        return "Cascade done. Writing the report…"
    return ""


def render(subject: str, result: RunResult) -> str:
    if result.error:
        return f"The run failed: {result.error}"
    parts = [f"### {subject}", "", result.metrics_summary]
    if result.report_text:
        parts += ["", "**Report**", "", result.report_text]
    parts += [
        "",
        "_Simulated audience reactions, not a prediction of real engagement. "
        "The first round exposes 10% of the audience and the scoring "
        "calibration is fixed._",
    ]
    return "\n".join(parts)


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    # ACP: acknowledge every inbound message, first thing.
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))

    if any(isinstance(c, StartSessionContent) for c in msg.content):
        ctx.logger.info(f"session started with {sender}")

    text = msg.text().strip()
    if not text:
        return
    ctx.logger.info(f"chat from {sender}: {text[:120]}")

    try:
        match = URL_RE.search(text)
        low = text.lower()
        if match:
            await run_workflow(ctx, sender, match.group(0).rstrip(".,)"))
        elif wants_simulation(low):
            await run_workflow(ctx, sender, "")
        else:
            await say(ctx, sender, HELP, end=True)
    except Exception as exc:
        ctx.logger.exception("workflow failed")
        await say(ctx, sender, f"Something broke on my side: `{exc}`. Nothing was published.", end=True)


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


# publish_manifest advertises AgentChatProtocol so ASI:One can discover us.
agent.include(chat_proto, publish_manifest=True)


if __name__ == "__main__":
    print(f"orchestrator address: {agent.address}")
    agent.run()
