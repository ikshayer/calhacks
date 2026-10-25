import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { LOBBY_EASE } from '@/lib/motion'

/**
 * The lobby's one piece of choreography.
 *
 * Everything on a screen rises and settles once, in reading order, and then
 * nothing moves again except the backdrop. That is deliberate: a page where
 * each card animates on its own schedule reads as a template demo, and this
 * one has a shader running behind it already. One sequence, then stillness.
 *
 * `motion` is the project's existing animation library — React Bits' own
 * entrance component wants gsap, which would be a second one for no gain.
 */

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  /** Index in the sequence, not seconds: `Stagger` spaces them. */
  delay?: number
}) {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return <div className={className}>{children}</div>

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: LOBBY_EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

/**
 * A list whose rows arrive in order.
 *
 * Used for the history, where the sequence carries meaning — the rows are
 * newest first, so watching them land top-down matches how they are sorted.
 */
export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return <ul className={className}>{children}</ul>

  return (
    <motion.ul
      className={className}
      initial="hidden"
      animate="shown"
      variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06 } } }}
    >
      {children}
    </motion.ul>
  )
}
