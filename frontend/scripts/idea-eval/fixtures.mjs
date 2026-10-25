import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { buildMillbrookAudience, validateMillbrookWorld } from '../../src/data/millbrook.ts'
import { predictionProfile } from '../../src/data/predictionProfile.ts'
import { emptyProfile } from '../../src/onboarding/suggestAudience.ts'

// Authored scenarios, not observed customer outcomes. Only the price changes in a contrast.
const families = [
  ['boba', 'a boba shop', 'a freshly made bubble tea', 5, 25, 'people ages 18-21', 18, 21],
  ['cafe', 'a neighborhood café', 'a coffee and breakfast sandwich', 8, 40, 'everyone', null, null],
  ['meals', 'a meal preparation service', 'a ready-to-heat balanced dinner', 12, 60, 'adults ages 25-55', 25, 55],
  ['produce', 'a produce subscription pickup shop', 'a weekly box of seasonal vegetables', 20, 100, 'everyone', null, null],
  ['bakery', 'a bakery', 'a loaf of freshly baked sourdough bread', 7, 35, 'everyone', null, null],
  ['gym', 'a gym', 'a monthly membership including equipment and group classes', 35, 175, 'adults ages 18-65', 18, 65],
  ['coworking', 'a coworking space', 'a day pass including a desk and Wi-Fi', 15, 75, 'adults ages 22-60', 22, 60],
  ['senior-exercise', 'a gentle exercise studio', 'a one-hour instructor-led mobility class', 8, 40, 'people ages 65-100', 65, 100],
  ['childrens-art', 'a children’s art studio', 'a one-hour painting class with materials included', 10, 50, 'children ages 6-12', 6, 12],
  ['device-repair', 'a device repair shop', 'a phone battery replacement including parts and labor', 40, 200, 'everyone', null, null],
  ['thrift', 'a thrift shop', 'a cleaned secondhand jacket', 12, 60, 'everyone', null, null],
  ['dining', 'a premium restaurant', 'a three-course seasonal dinner', 60, 300, 'adults ages 21-80', 21, 80],
]

export const cases = families.flatMap(([family, business, offering, price, contrastPrice, target, minAge, maxAge], index) => {
  const facts = { business, offering, price, location: 'downtown Millbrook', target }
  const original = `I want to open ${business} in downtown Millbrook, offering ${offering} for $${price}. Would ${target} visit?`
  const variants = {
    original,
    conversational: `Would ${target} come by if I opened ${business} in downtown Millbrook? I would offer ${offering} for $${price}.`,
    reordered: `For ${target}, would ${offering} for $${price} at ${business} in downtown Millbrook be worth a visit? I am considering opening it.`,
    contrast: original.replace(`$${price}`, `$${contrastPrice}`),
  }
  const options = index % 3 === 0 ? [] : [
    { name: 'Flyers at local community venues', costUsd: 50 },
    ...(index % 3 === 2 ? [{ name: 'Local social media ads', costUsd: 200 }, { name: 'Opening-day sample event', costUsd: 450 }] : []),
  ]
  return Object.entries(variants).map(([variant, prompt]) => ({
    id: `${family}/${variant}`, family, variant, prompt, options,
    budgetUsd: options.length ? 500 : undefined,
    expectedAge: { minAge, maxAge },
    facts: { ...facts, price: variant === 'contrast' ? contrastPrice : price },
  }))
})

export function loadAudience() {
  const bytes = readFileSync(new URL('../../public/millbrook-50/millbrook.json', import.meta.url))
  const world = JSON.parse(bytes)
  validateMillbrookWorld(world)
  const profile = { ...emptyProfile(), id: 'idea-eval-v1', name: 'Millbrook Ventures', pitch: 'Exploring local businesses serving Millbrook residents.' }
  const audience = buildMillbrookAudience(world, profile)
  const members = audience.members.map((member) => ({
    ...member, memberId: member.id, profileId: profile.id, audienceVersion: profile.audienceVersion,
    profileJson: predictionProfile(member),
  }))
  return { profile, members, datasetHash: createHash('sha256').update(bytes).digest('hex'), world }
}
