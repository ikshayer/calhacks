"""Ingest agent: turn a reel URL into a runnable video id.

Private: it only answers the orchestrator.

What it can and cannot do, given the module as it stands:

  * It CAN scrape a public reel with Apify, so the chat reply is grounded in
    the real caption and counts rather than invented text.
  * It CANNOT turn that reel into a runnable `video` row. `create_video`
    rejects any sourceUrl that does not start with `demo:` on purpose -- the
    worker would otherwise fetch any path or URL a stranger sent it. So an
    arbitrary Instagram link cannot become a simulation subject today.

So ingest resolves a URL to an already-analysed video, and when it cannot it
falls back to the configured demo video and says so in `note`. The
orchestrator repeats that note in the chat. A fallback is never silent.
"""

from __future__ import annotations

import re

import config
import stdb
from contracts import IngestRequest, IngestResult
from uagents import Agent, Context

agent = Agent(
    name="reel-ingest",
    seed=config.AGENT_SEED_INGEST or None,
    publish_agent_details=False,
)

SHORTCODE = re.compile(r"instagram\.com/(?:reels?|p)/([A-Za-z0-9_-]+)")


def shortcode(url: str) -> str | None:
    match = SHORTCODE.search(url)
    return match.group(1) if match else None


async def scrape(url: str) -> dict | None:
    """Fetch one reel's metadata. Returns None if Apify is unavailable."""
    if not config.APIFY_TOKEN:
        return None
    try:
        from apify_client import ApifyClientAsync

        client = ApifyClientAsync(token=config.APIFY_TOKEN)
        run = await client.actor(config.APIFY_REEL_ACTOR).call(
            run_input={"username": [url], "resultsLimit": 1, "skipPinnedPosts": True}
        )
        if not run or run.get("status") != "SUCCEEDED":
            return None
        page = await client.dataset(run["defaultDatasetId"]).list_items()
        items = [i for i in (page.items or []) if not i.get("error")]
        return items[0] if items else None
    except Exception:
        return None


async def ready_videos() -> list[dict]:
    """Analysed videos the agent's identity can actually start a run on."""
    where = "status = 'ready'"
    if config.PROFILE_ID:
        where += f" AND profile_id = {stdb.quote(config.PROFILE_ID)}"
    return await stdb.sql(f"SELECT * FROM video WHERE {where}")


def match_video(videos: list[dict], code: str | None, url: str) -> dict | None:
    """Has someone already loaded this reel as a demo video?"""
    needles = [n for n in (code, url) if n]
    for video in videos:
        haystack = f"{video.get('name', '')} {video.get('source_url') or ''} {video.get('summary', '')}".lower()
        if any(n.lower() in haystack for n in needles):
            return video
    return None


@agent.on_message(IngestRequest, replies=IngestResult)
async def handle_ingest(ctx: Context, sender: str, msg: IngestRequest):
    ctx.logger.info(f"[{msg.request_id}] ingest {msg.url}")

    try:
        videos = await ready_videos()
    except stdb.StdbError as exc:
        await ctx.send(sender, IngestResult(request_id=msg.request_id, error=str(exc)))
        return

    if not videos:
        await ctx.send(
            sender,
            IngestResult(
                request_id=msg.request_id,
                error=(
                    "No analysed video is available to simulate. Upload one in the "
                    "web app and let the worker analyse it first."
                ),
            ),
        )
        return

    code = shortcode(msg.url)
    scraped = await scrape(msg.url) if msg.url else None
    caption = (scraped or {}).get("caption", "") or ""
    title = caption.strip().split("\n")[0][:80] if caption else ""

    matched = match_video(videos, code, msg.url) if msg.url else None
    if matched:
        await ctx.send(
            sender,
            IngestResult(
                request_id=msg.request_id,
                content_id=str(matched["id"]),
                title=title or matched.get("name", ""),
                source="matched",
            ),
        )
        return

    # Fall back to a known-good analysed video, and be explicit about it.
    fallback = None
    if config.FALLBACK_VIDEO_ID:
        fallback = next((v for v in videos if str(v["id"]) == config.FALLBACK_VIDEO_ID), None)
    fallback = fallback or videos[0]

    if msg.url:
        if scraped:
            note = (
                f"That reel is not loaded as a campaign video, so I simulated the "
                f"cached demo video **{fallback.get('name', '')}** instead. I did read "
                f"the real reel: {_counts(scraped)}."
            )
        else:
            note = (
                f"I could not fetch that reel, so I simulated the cached demo video "
                f"**{fallback.get('name', '')}** instead."
            )
    else:
        note = ""

    await ctx.send(
        sender,
        IngestResult(
            request_id=msg.request_id,
            content_id=str(fallback["id"]),
            title=title or fallback.get("name", ""),
            source="fallback" if msg.url else "matched",
            note=note,
        ),
    )


def _counts(item: dict) -> str:
    bits = []
    for key, label in (("videoPlayCount", "plays"), ("likesCount", "likes"), ("commentsCount", "comments")):
        value = item.get(key)
        # Instagram hides counts as null or a negative; missing stays missing.
        if isinstance(value, (int, float)) and value >= 0:
            bits.append(f"{int(value):,} {label}")
    return ", ".join(bits) if bits else "no public counts"
