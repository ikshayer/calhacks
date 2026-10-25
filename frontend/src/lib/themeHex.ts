/**
 * DotGrid parses plain hex only and cannot see CSS variables, so the garden
 * tokens are read off the root once, with the index.css values as fallback.
 */
export function themeHex(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : fallback
}
