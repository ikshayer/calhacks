"""Run the agents as two processes, so the Agent Inspector can connect the orchestrator.

The Inspector does not support a Bureau (several agents on one port): it answers
"Agent Bureaus are not supported in this version of the Inspector". So:

    python run_split.py workers        # ingest + simulation, private, on BUREAU_PORT + 1
    python run_split.py orchestrator   # the ASI:One-facing agent alone, on BUREAU_PORT

Start `workers` first. The orchestrator finds the other two through the Almanac,
where the workers' bureau registers their endpoints. `python run.py` (one process)
still works when no Inspector is needed.
"""

import sys

import config
from uagents import Bureau

MODES = ("orchestrator", "workers")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in MODES:
        raise SystemExit(f"usage: python run_split.py {'|'.join(MODES)}")

    if mode == "orchestrator":
        from orchestrator_agent import agent
        import ingest_agent
        import simulation_agent
        from uagents.dispatch import dispatcher

        # Importing the orchestrator also constructs the ingest and simulation agents here, and every
        # Agent registers itself as a local message sink on creation. Left in place, those unstarted
        # copies swallow the orchestrator's messages; removing them sends the messages out to the
        # real agents in the workers process.
        for private in (ingest_agent.agent, simulation_agent.agent):
            dispatcher.unregister(private.address, private)

        print(f"orchestrator (ASI:One): {agent.address}  port {config.BUREAU_PORT}")
        agent.run()
        return

    from ingest_agent import agent as ingest
    from simulation_agent import agent as simulation

    port = config.BUREAU_PORT + 1
    bureau = Bureau(port=port, endpoint=f"http://127.0.0.1:{port}/submit")
    bureau.add(ingest)
    bureau.add(simulation)
    print(f"ingest: {ingest.address}\nsimulation: {simulation.address}\nport {port}")
    bureau.run()


if __name__ == "__main__":
    main()
