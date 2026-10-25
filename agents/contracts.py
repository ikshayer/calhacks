"""Messages between the three agents.

Every request carries a `request_id` and every reply copies it back, so two
ASI:One conversations running at once cannot pick up each other's results.
Failures travel in `error`; nothing fails silently.
"""

from uagents import Model


class IngestRequest(Model):
    request_id: str
    url: str


class IngestResult(Model):
    request_id: str
    content_id: str = ""     # video.id, as a string
    title: str = ""
    source: str = ""         # 'matched' | 'created' | 'fallback'
    note: str = ""           # what we did, when it was not the obvious thing
    error: str = ""


class RunRequest(Model):
    request_id: str
    content_id: str


class RunResult(Model):
    request_id: str
    run_id: str = ""
    metrics_summary: str = ""
    report_text: str = ""
    island_url: str = ""
    error: str = ""


class ProgressRequest(Model):
    """Asks the simulation agent where a run has got to. Cheap; polled."""

    request_id: str
    run_id: str


class ProgressResult(Model):
    request_id: str
    run_id: str = ""
    status: str = ""         # scoring | cascading | complete | failed
    stage: str = ""          # the worker's own words, e.g. 'Scoring 250/500'
    report_status: str = ""  # writing | ready | failed | ''
    done: bool = False
    error: str = ""
