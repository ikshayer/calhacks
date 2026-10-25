import { createHash } from 'node:crypto'

export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Per-run cache. Never reads or writes the production worker cache. */
export function memoryCache(disabled = false) {
  const entries = new Map()
  const events = []
  const key = (kind, parts) => `${kind}/${hash(parts)}`
  return {
    entries, events,
    async lookup(kind, parts, validate) {
      const id = key(kind, parts)
      const entry = disabled ? undefined : entries.get(id)
      if (entry === undefined) { events.push({ kind, key: id, hit: false }); return undefined }
      try {
        const result = validate(structuredClone(entry))
        events.push({ kind, key: id, hit: true })
        return result
      } catch {
        events.push({ kind, key: id, hit: false, invalid: true })
        return undefined
      }
    },
    async store(kind, parts, value) {
      if (!disabled) entries.set(key(kind, parts), structuredClone(value))
    },
  }
}
