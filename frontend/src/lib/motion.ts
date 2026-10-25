/** One easing for every transition on the lobby screens. */
export const LOBBY_EASE = [0.22, 1, 0.36, 1] as const

/** Variants for a row inside `Stagger`. */
export const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.4, ease: LOBBY_EASE } },
}
