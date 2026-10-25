/** Browser-only contracts for the supplied Millbrook snapshot; no generator imports. */
export type FamilyRelation = 'spouse' | 'parent' | 'child' | 'sibling'
export type PersonaMood = 'neutral' | 'happy' | 'stressed' | 'sad' | 'excited' | 'angry' | 'calm'

export interface PersonaMemory {
  readonly id: string
  readonly tick: number
  readonly text: string
  readonly importance: number
  readonly tags: readonly string[]
}

export interface MillbrookPersona {
  readonly id: string
  readonly householdId: string
  readonly name: string
  readonly age: number
  readonly gender: string
  readonly occupation: string
  readonly education: string
  readonly hometown: string
  readonly personality: Readonly<Record<
    'openness' | 'conscientiousness' | 'extraversion' | 'agreeableness' | 'neuroticism', number
  >>
  readonly values: readonly string[]
  readonly quirks: readonly string[]
  readonly backstory: string
  readonly speechStyle: string
  /** Describes this resident's role: parent means "parent of the referenced resident". */
  readonly family: Readonly<Record<string, FamilyRelation>>
  readonly friends: Readonly<Record<string, number>>
  readonly mood: PersonaMood
  readonly goals: readonly string[]
  readonly money: number
  readonly location: string
  readonly memories: readonly PersonaMemory[]
  readonly beliefs: readonly string[]
}

export interface MillbrookHousehold {
  readonly id: string
  readonly surname: string
  readonly address: string
  readonly memberIds: readonly string[]
}

export interface MillbrookWorld {
  readonly schemaVersion: 1
  readonly seed: number
  readonly town: string
  readonly tick: number
  readonly households: readonly MillbrookHousehold[]
  readonly personas: readonly MillbrookPersona[]
}
