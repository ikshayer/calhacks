import type { AudienceMember } from './types.ts'

/**
 * The resident details JEV and Claude reason over, as JSON for audience_member.profileJson.
 * Ids of family and friends are left out (the sharing graph carries those links);
 * the three most important memories are kept as lived context.
 */
export function predictionProfile(member: AudienceMember): string {
  const source = member.millbrook
  if (!source) return ''
  const p = source.persona
  const memories = [...p.memories].sort((a, b) => b.importance - a.importance).slice(0, 3).map((m) => m.text)
  return JSON.stringify({
    age: p.age,
    gender: p.gender,
    occupation: p.occupation,
    education: p.education,
    hometown: p.hometown,
    household: `${source.household.surname} household, ${source.household.memberIds.length} people`,
    personality: p.personality,
    values: p.values,
    quirks: p.quirks,
    goals: p.goals,
    beliefs: p.beliefs,
    mood: p.mood,
    speechStyle: p.speechStyle,
    money: p.money,
    annualIncome: p.annualIncome,
    techSavvy: p.techSavvy,
    adoptionStyle: p.adoptionStyle,
    location: p.location,
    memories,
  })
}
