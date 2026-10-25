"""Local Chat Protocol client: drives the orchestrator without ASI:One.

Speaks the same AgentChatProtocol ASI:One speaks, over an in-process bureau,
so it needs no mailbox and no Almanac. If this works, the ASI:One path is
only a matter of linking the mailbox.

    python client.py "test demo"
"""

import os
import sys

os.environ.setdefault("AGENT_LOCAL_ONLY", "1")  # must precede the agent imports

import config  # noqa: E402
from uagents import Agent, Bureau, Context  # noqa: E402
from uagents_core.contrib.protocols.chat import (  # noqa: E402
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
)

from ingest_agent import agent as ingest  # noqa: E402
from orchestrator_agent import agent as orchestrator  # noqa: E402
from simulation_agent import agent as simulation  # noqa: E402

PROMPT = " ".join(sys.argv[1:]) or "test demo"

client = Agent(name="acp-test-client", seed="calhacks-acp-test-client", publish_agent_details=False)


@client.on_event("startup")
async def send(ctx: Context):
    print(f"\n-> {PROMPT}\n", flush=True)
    await ctx.send(
        orchestrator.address,
        ChatMessage(content=[StartSessionContent(), TextContent(text=PROMPT)]),
    )


@client.on_message(ChatMessage)
async def on_message(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(acknowledged_msg_id=msg.msg_id))
    if msg.text():
        print(f"<- {msg.text()}\n", flush=True)
    if any(isinstance(c, EndSessionContent) for c in msg.content):
        print("[session ended — ctrl-c to exit]", flush=True)


@client.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


bureau = Bureau(port=config.BUREAU_PORT, endpoint=f"http://127.0.0.1:{config.BUREAU_PORT}/submit")
for a in (orchestrator, ingest, simulation, client):
    bureau.add(a)

if __name__ == "__main__":
    bureau.run()
