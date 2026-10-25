import type { AudienceGroup, CompanyProfile } from '@/data/types'

/**
 * Starting audience groups offered during onboarding.
 *
 * These are *suggestions the user confirms or edits*, not measured follower
 * demographics. HACK.md is explicit about that distinction and the UI repeats it
 * wherever shares are shown. The defaults are tuned for a small local
 * organisation (the Giving Garden demo case) and are fully editable.
 */
const DEFAULT_GROUPS: AudienceGroup[] = [
  {
    id: 'students',
    label: 'Students',
    share: 0.22,
    color: '#5b9bd5',
    blurb: 'University and high-school students nearby, scrolling between classes.',
    interests: ['campus life', 'volunteering', 'cheap eats', 'climate', 'short video'],
  },
  {
    id: 'families',
    label: 'Local families',
    share: 0.2,
    color: '#f0a35e',
    blurb: 'Parents within a short drive, looking for weekend activities with the kids.',
    interests: ['family outings', 'weekend plans', 'neighbourhood', 'gardening', 'healthy food'],
  },
  {
    id: 'retirees',
    label: 'Retirees',
    share: 0.16,
    color: '#9b8ec4',
    blurb: 'Retired neighbours with time to give and long local memories.',
    interests: ['gardening', 'community', 'local history', 'charity', 'mornings'],
  },
  {
    id: 'foodies',
    label: 'Foodies',
    share: 0.16,
    color: '#e07a7a',
    blurb: 'People who follow food accounts and care where produce comes from.',
    interests: ['fresh produce', 'cooking', 'farmers markets', 'recipes', 'seasonal food'],
  },
  {
    id: 'sustainability',
    label: 'Sustainability',
    share: 0.14,
    color: '#5fae8c',
    blurb: 'Climate- and waste-conscious followers who share causes they believe in.',
    interests: ['food waste', 'climate', 'composting', 'local sourcing', 'activism'],
  },
  {
    id: 'community',
    label: 'Community orgs',
    share: 0.12,
    color: '#d9a94e',
    blurb: 'Churches, mutual aid groups and clubs that amplify local causes.',
    interests: ['mutual aid', 'volunteering', 'local events', 'donations', 'networks'],
  },
]

export function suggestedGroups(): AudienceGroup[] {
  return DEFAULT_GROUPS.map((g) => ({ ...g, interests: [...g.interests] }))
}

/**
 * Extra words that should match a group but do not appear in its own label or
 * interests. Keyed by group id.
 *
 * Kept deliberately short. This is a lookup, not an attempt at understanding
 * the sentence, and a long list would mostly add false positives — "community"
 * matching every third business, say.
 */
const SYNONYMS: Record<string, string[]> = {
  students: ['student', 'uni', 'university', 'college', 'campus', 'undergrad', 'teen', 'school'],
  families: ['family', 'families', 'parent', 'parents', 'kids', 'children', 'mums', 'dads'],
  retirees: ['retired', 'retiree', 'older', 'senior', 'seniors', 'pensioner', 'elderly'],
  foodies: ['foodie', 'food', 'cooking', 'cook', 'restaurant', 'produce', 'eat', 'chef'],
  sustainability: ['sustainable', 'climate', 'green', 'eco', 'environment', 'waste', 'recycling'],
  community: ['community', 'neighbour', 'neighbor', 'local', 'volunteer', 'charity', 'church'],
}

/** Words too common to carry a signal on their own. */
const STOPWORDS = new Set([
  'and', 'the', 'for', 'who', 'with', 'are', 'our', 'their', 'people', 'anyone',
  'everyone', 'looking', 'that', 'this', 'them', 'they', 'want', 'from', 'have',
])

/**
 * Pick audience groups from what the user typed about who they want to reach.
 *
 * The groups are no longer a pool of people to generate — the cast is a fixed
 * 50 Millbrook residents — but they still decide how those residents are
 * segmented, what interests each one is assumed to hold, and how the island is
 * divided into districts. So onboarding still has to produce them, just without
 * making the user push sliders around first.
 *
 * Returns `null` when the text matches almost nothing. The caller then turns
 * audience groups off entirely rather than falling back to the defaults: those
 * defaults describe a community garden, and handing them to an aerospace
 * supplier would dress up invented segments as inferred ones. With groups off
 * every resident is simulated on their own persona, which is the honest answer
 * when we cannot tell who the audience is.
 */
export function deriveGroups(audienceText: string, pitch: string): AudienceGroup[] | null {
  /** Builds a matcher over one piece of text. */
  const matcher = (text: string) => {
    const haystack = text.toLowerCase()
    const words = new Set(
      haystack.split(/[^a-z]+/).filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    )
    return (term: string): boolean => {
      const lower = term.toLowerCase()
      // Multi-word interests ("farmers markets") only count as a phrase; single
      // words match the tokenised set so "students" finds "student".
      if (lower.includes(' ')) return haystack.includes(lower)
      return (
        words.has(lower) ||
        [...words].some((word) => word.startsWith(lower) || lower.startsWith(word))
      )
    }
  }

  const inAudience = matcher(audienceText)
  const inPitch = matcher(pitch)

  /**
   * The audience answer selects the groups; the description only weights them.
   *
   * Letting the description select too looked reasonable and was not. Asked
   * who they wanted to reach, a user can answer "aerospace procurement
   * officers" — which matches none of these segments — and the words in "a
   * community garden that grows free produce" would still have conjured
   * retirees, foodies and community groups out of nothing. That is the exact
   * failure this function exists to avoid, so a group has to be named in the
   * audience answer to be in the result at all. The description then decides
   * how much of the town each one gets.
   */
  const scored = DEFAULT_GROUPS.map((group) => {
    const terms = [group.label, ...group.interests, ...(SYNONYMS[group.id] ?? [])]
    const named = terms.filter(inAudience).length
    const supported = terms.filter(inPitch).length
    return { group, named, score: named * 3 + supported }
  }).filter((entry) => entry.named > 0)

  if (scored.length === 0) return null

  // Drop the long tail: a group scraping one incidental word alongside a group
  // the user named outright is noise, not a segment of their audience.
  const top = Math.max(...scored.map((entry) => entry.score))
  const kept = scored.filter((entry) => entry.score * 3 >= top)

  // One match is not a segmentation, it is a coincidence.
  if (kept.length < 2) return null

  return normaliseShares(
    kept.map(({ group, score }) => ({
      ...group,
      interests: [...group.interests],
      // Weight by match strength, so the audience they actually described
      // takes up more of the town.
      share: score,
    })),
  )
}

/** Re-normalise shares to sum to exactly 1 after the user edits them. */
export function normaliseShares(groups: AudienceGroup[]): AudienceGroup[] {
  const total = groups.reduce((sum, g) => sum + g.share, 0)
  if (total <= 0) {
    const even = 1 / Math.max(groups.length, 1)
    return groups.map((g) => ({ ...g, share: even }))
  }
  return groups.map((g) => ({ ...g, share: g.share / total }))
}

export const PALETTE = [
  '#5b9bd5', '#f0a35e', '#9b8ec4', '#e07a7a',
  '#5fae8c', '#d9a94e', '#6fa8c7', '#c98fb5',
]

export function emptyProfile(): CompanyProfile {
  return {
    id: 'local-profile',
    name: '',
    pitch: '',
    objective: 'engagement',
    tone: [],
    inspirationAccounts: [],
    groups: suggestedGroups(),
    audienceVersion: 1,
  }
}
