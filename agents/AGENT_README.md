![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)
![domain:marketing](https://img.shields.io/badge/marketing-8A2BE2)
![tag:simulation](https://img.shields.io/badge/simulation-2E8B57)

# Reel Rehearsal

<description>
See how a short video lands with an audience before you publish it. Send a
reel link, or say "test demo", and this agent runs a private audience
simulation: a few hundred synthetic audience members each decide whether they
would watch it through, like, comment or share, and sharing spreads the video
through their social graph round by round. You get the simulated engagement
numbers, a written report with timestamped notes and rewritten hooks, and a
link to watch the cascade replay in 3D. Nothing is published and nothing is
posted on your behalf.
</description>

<use_cases>
    <use_case>Test an unpublished reel against a simulated audience before posting it.</use_case>
    <use_case>See which parts of a video lose people, with timestamps.</use_case>
    <use_case>Get rewritten hook suggestions grounded in the actual video.</use_case>
    <use_case>Watch how a video would spread through a social graph, round by round.</use_case>
</use_cases>

<payload_requirements>
<description>Plain natural language over the Agent Chat Protocol. No structured payload.</description>
<payload>
    <requirement>
        <parameter>text</parameter>
        <description>An Instagram reel URL, or "test demo" to run the loaded demo video.</description>
    </requirement>
</payload>
</payload_requirements>

## Honest limits

Results are **simulated** audience reactions, not predictions of real
engagement and not measured data. The first cascade round exposes 10% of the
audience, and the scoring calibration is fixed rather than fitted to your
account. The audience is synthetic, generated from a company profile.
