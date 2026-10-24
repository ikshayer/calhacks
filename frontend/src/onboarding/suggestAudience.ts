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

export const TONE_OPTIONS = [
  'warm', 'playful', 'sincere', 'urgent', 'practical', 'hopeful', 'plain-spoken', 'proud',
]
