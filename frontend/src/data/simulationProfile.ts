import type { AudienceGroup, CompanyProfile } from './types.ts'

/** The single neutral group used when the user switches audience groups off. */
export const EVERYONE_GROUP: AudienceGroup = {
  id: 'everyone',
  label: 'Everyone',
  share: 1,
  color: '#93a09a',
  blurb: '',
  interests: [],
}

/**
 * The profile the simulation actually uses.
 *
 * With audience groups switched off (`useAudienceGroups === false`) every
 * resident goes into one neutral group with no assumed interests, so the
 * prediction rests only on each resident's own profile. Groups the user typed
 * are kept on the saved profile, so switching back on restores them.
 */
export function simulationProfile(profile: CompanyProfile): CompanyProfile {
  if (profile.useAudienceGroups !== false) return profile
  return { ...profile, groups: [EVERYONE_GROUP] }
}
