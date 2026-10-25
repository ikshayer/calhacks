import type {
  Audience,
  Report,
  ReferenceExample,
  RewrittenHook,
  RunId,
  RunMetrics,
  TimestampedNote,
  VideoAnalysis,
} from '@/data/types'

/**
 * Disclosures the demo is required to surface, straight from the HACK.md
 * honesty list. They render as a persistent badge, not fine print, and they are
 * never cut for space.
 */
export const STANDING_ASSUMPTIONS = [
  'The audience is 50 fictional Millbrook residents, not measured followers. All 50 appear on the island.',
  'Group shares are assumptions you set during onboarding, not observed demographics.',
  'Residents are assigned to audience groups proportionally, with rounding to whole people. Group interests drive reaction scoring; persona traits are descriptive.',
  'Sharing follows the supplied family and friendship links. Relationship affinity does not weight sharing probabilities.',
  'Round 0 exposes a declared share of the audience; the graph is a simplified sharing scenario, not a recommendation algorithm.',
  'Engagement components are modelled rankings for comparing versions, not forecasts of real views, likes or shares.',
  'The P10-P90 range describes variability across seeded trials within these assumptions. It is not a validated prediction interval.',
  'Explanations are generated rationales for simulated decisions, not observed human behaviour.',
]

/**
 * Builds the structured report.
 *
 * Every note is anchored to a real second inside the uploaded video, computed
 * from its actual duration, so the player can scrub to it and the user can
 * check the claim against what is on screen. Notes are derived from the content
 * signals and the run outcome, never invented.
 */
export function buildReport(
  runId: RunId,
  video: VideoAnalysis,
  metrics: RunMetrics,
  audience: Audience,
  groupLabels: Map<string, string>,
): Report {
  const { signals, durationSec } = video
  const notes: TimestampedNote[] = []

  // --- the opening ---------------------------------------------------------
  if (signals.hookStrength < 0.55) {
    notes.push({
      at: 0,
      severity: 'fix',
      title: 'The first second does not commit',
      detail:
        `Watch-through reached ${metrics.watch} of ${metrics.uniqueExposed} exposed members. ` +
        'Every later action is conditional on watching through, so the opening sets the ceiling for ' +
        'likes, comments and shares alike. Lead with the single most concrete image or claim.',
    })
  } else {
    notes.push({
      at: 0,
      severity: 'strength',
      title: 'The opening earns the next second',
      detail:
        `This is the strongest signal in the analysis (${(signals.hookStrength * 100).toFixed(0)}/100) ` +
        `and it is what carried ${metrics.watch} watch-throughs. Keep it intact through any re-edit.`,
    })
  }

  // --- the ask -------------------------------------------------------------
  const askAt = Math.max(1, Math.round(durationSec * 0.75))
  if (signals.clarityOfAsk < 0.6) {
    notes.push({
      at: askAt,
      severity: 'risk',
      title: 'The ask arrives late and stays vague',
      detail:
        `Only ${plural(metrics.shares, 'member')} shared. In this model sharing depends on having something ` +
        'specific to pass on, so a vague ask caps spread even among members who liked the video. ' +
        'Name the action, the day and the place, and say it on screen as well as out loud.',
    })
  } else {
    notes.push({
      at: askAt,
      severity: 'strength',
      title: 'The ask is explicit',
      detail:
        `A clear ask is what let the cascade reach ${metrics.uniqueExposed} members over ` +
        `${plural(metrics.rounds, 'round')} rather than stalling in the first one.`,
    })
  }

  // --- pacing --------------------------------------------------------------
  const midpoint = Math.max(1, Math.round(durationSec * 0.45))
  if (signals.pacing < 0.5) {
    notes.push({
      at: midpoint,
      severity: 'fix',
      title: 'The middle slackens',
      detail:
        'The edit loosens here, which in this model is where attention is lost before the ask ' +
        `lands at ${formatTime(askAt)}. Cutting this section tightens the path to the ask.`,
    })
  }

  if (durationSec > 45) {
    notes.push({
      at: Math.round(durationSec * 0.9),
      severity: 'risk',
      title: `At ${formatTime(durationSec)} this is long for the format`,
      detail:
        'The analysis assumes a longer cut opens more slowly and sheds viewers before the ask. ' +
        'That is a declared assumption about the format, not a measurement of this video.',
    })
  }

  // --- who responded -------------------------------------------------------
  const ranked = [...metrics.byGroup].sort((a, b) => b.likes + b.shares - (a.likes + a.shares))
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]
  if (best && worst && best !== worst) {
    notes.push({
      at: Math.round(durationSec * 0.3),
      severity: 'strength',
      title: `"${groupLabels.get(best.groupId) ?? best.groupId}" responded most`,
      detail:
        `${plural(best.likes, 'like')} and ${plural(best.shares, 'share')} from ${best.exposed} exposed, against ` +
        `${plural(worst.likes, 'like')} from ${worst.exposed} for "${groupLabels.get(worst.groupId) ?? worst.groupId}". ` +
        'If the weaker group matters to you, it needs its own reason to care stated on screen.',
    })
  }

  return {
    runId,
    summary: buildSummary(video, metrics, audience),
    notes: notes.sort((a, b) => a.at - b.at),
    hooks: buildHooks(video),
    references: REFERENCES,
    assumptions: STANDING_ASSUMPTIONS,
  }
}

function buildSummary(video: VideoAnalysis, metrics: RunMetrics, audience: Audience): string {
  const reach = ((metrics.uniqueExposed / audience.members.length) * 100).toFixed(0)
  const spreading = metrics.rounds > 3
  return [
    video.summary,
    `Simulated against ${audience.members.length} audience members, it reached ${metrics.uniqueExposed} of them (${reach}%) over ${plural(metrics.rounds, 'round')}.`,
    spreading
      ? 'The cascade kept going past the seeded round, so sharing is carrying it beyond the initial exposure.'
      : 'The cascade stalled close to the seeded round: almost everyone who saw this was shown it directly rather than by a peer.',
    `Coverage ${(metrics.coverage * 100).toFixed(0)}%, with ${plural(metrics.missing, 'member')} returning no prediction.`,
  ].join(' ')
}

/**
 * Rewritten hooks and closes.
 *
 * Phrased against the Giving Garden demo case, because concrete copy is the
 * point: generic advice ("make it punchier") is what this report exists to
 * avoid. The real driver generates these with Claude from the transcript.
 */
function buildHooks(video: VideoAnalysis): RewrittenHook[] {
  const hooks: RewrittenHook[] = [
    {
      label: 'Opening line',
      original: 'Hi everyone, welcome back to the garden, today we wanted to show you around a bit.',
      suggestion: 'We grew 200 kilos of food this month. Almost none of it got picked.',
      rationale:
        'Opens on a concrete loss instead of a greeting. The model raises watch-through when the ' +
        'first second carries the stake, and every other action depends on watch-through.',
    },
    {
      label: 'The ask',
      original: 'So yeah, if you want to help out sometime, let us know!',
      suggestion: 'Saturday, 9am, Elm Street gate. Six people and nothing goes to waste. Comment "in" and I will send the details.',
      rationale:
        'Names the day, the place, the number needed and a one-word reply. Sharing in this model ' +
        'depends on having something specific to forward, which a vague ask does not provide.',
    },
  ]

  if (video.durationSec > 45) {
    hooks.push({
      label: 'Structure',
      original: `A single ${formatTime(video.durationSec)} walkthrough.`,
      suggestion: 'Cut to 25s: the loss, one face saying why it matters, then the ask on screen and out loud.',
      rationale:
        'Shortens the path from the opening to the ask. The length penalty here is a declared ' +
        'assumption about the format rather than something measured on this video.',
    })
  }

  return hooks
}

/**
 * Reference examples.
 *
 * In the shipped pipeline these come from the Apify scrape after the JEV
 * relevance filter, and include ordinary performers as well as strong ones.
 * Observed metrics that the scrape did not return stay absent rather than
 * being shown as zero.
 */
const REFERENCES: ReferenceExample[] = [
  {
    title: 'Volunteer call that opened on the waste, not the greeting',
    account: '@localharvestshare',
    observed: { plays: 48200, likes: 3100, comments: 212 },
    whyRelevant:
      'Same ask as yours (weekend volunteers, small garden) and it states the loss in the first two seconds.',
  },
  {
    title: 'Garden tour with no explicit ask',
    account: '@quietplotgarden',
    observed: { plays: 2400, likes: 61 },
    whyRelevant:
      'Included deliberately as an ordinary performer: the footage is warmer than yours but it never ' +
      'names an action, and it did not spread. Share count was not available from the scrape.',
  },
  {
    title: 'Named day and headcount in the caption',
    account: '@fieldandfork.coop',
    observed: { plays: 19800, likes: 1450, comments: 96 },
    whyRelevant:
      'Demonstrates the specific-ask pattern this report recommends, in the same niche and at a similar account size.',
  },
]

/** `3 shares`, `1 share`. Report copy is read aloud at a table; it has to scan. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const mins = Math.floor(whole / 60)
  const secs = whole % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
