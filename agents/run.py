"""Run all three agents in one Bureau: one process, one port.

Only the orchestrator connects to Agentverse, because only the orchestrator
needs to be reachable from ASI:One. Ingest and simulation stay inside the
bureau, which is also what keeps them private.
"""

import config
from uagents import Bureau

from ingest_agent import agent as ingest
from orchestrator_agent import agent as orchestrator
from simulation_agent import agent as simulation

bureau = Bureau(port=config.BUREAU_PORT, endpoint=f"http://127.0.0.1:{config.BUREAU_PORT}/submit")
bureau.add(orchestrator)
bureau.add(ingest)
bureau.add(simulation)


def main() -> None:
    print("=" * 72)
    print("Reel Rehearsal — Fetch.ai agents")
    print("=" * 72)
    print(f"  orchestrator (ASI:One) : {orchestrator.address}")
    print(f"  ingest                 : {ingest.address}")
    print(f"  simulation             : {simulation.address}")
    print(f"  spacetimedb            : {config.STDB_URL}/{config.STDB_DATABASE}")
    print(f"  island                 : {config.ISLAND_URL}")
    for name, value in (
        ("AGENT_SEED_ORCHESTRATOR", config.AGENT_SEED_ORCHESTRATOR),
        ("STDB_TOKEN", config.STDB_TOKEN),
        ("PROFILE_ID", config.PROFILE_ID),
    ):
        if not value:
            print(f"  WARNING: {name} is not set (see agents/README.md)")
    print("=" * 72)
    bureau.run()


if __name__ == "__main__":
    main()
