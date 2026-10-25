import { motion, useReducedMotion } from 'motion/react'
import { useAppStore, selectActiveRun, selectActiveVideo } from '@/store/useAppStore'
import { formatTime } from '@/data/mock/report'
import { EmptyState, Pill, Section } from '@/components/ui'
import type { TimestampedNote } from '@/data/types'

const SEVERITY: Record<TimestampedNote['severity'], { label: string; tone: 'leaf' | 'bloom' | 'sun' }> = {
  strength: { label: 'working', tone: 'leaf' },
  risk: { label: 'risk', tone: 'bloom' },
  fix: { label: 'fix', tone: 'sun' },
}

// Short and shallow: this is a dense reading surface, so the entrance only
// needs to show that notes arrive in order, not to perform.
const NOTES_LIST = { hidden: {}, shown: { transition: { staggerChildren: 0.06 } } }
const NOTE_ITEM = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' as const } },
}

/**
 * The structured report.
 *
 * Every note carries a timestamp that scrubs the player to that moment, because
 * feedback you cannot check against the footage is just an opinion. Clicking a
 * note moves the video.
 */
export function ReportPanel() {
  const run = useAppStore(selectActiveRun)
  const video = useAppStore(selectActiveVideo)
  const reduceMotion = useReducedMotion()

  if (!run) {
    return (
      <Section title="Report">
        <EmptyState title="No report yet">
          Run a simulation and the report appears here with timestamped notes.
        </EmptyState>
      </Section>
    )
  }

  if (run.status === 'failed') {
    return (
      <Section title="Report">
        <EmptyState title="The run failed">{run.error}</EmptyState>
      </Section>
    )
  }

  if (!run.report) {
    return (
      <Section title="Report">
        <EmptyState title="Still working">
          The report is written once the cascade finishes.
        </EmptyState>
      </Section>
    )
  }

  const { report } = run

  const scrubTo = (seconds: number) => {
    // The player is a plain <video>; seeking it directly keeps the report and
    // the footage in step without threading a ref through the whole sidebar.
    const element = document.querySelector<HTMLVideoElement>('video')
    if (!element) return
    element.currentTime = Math.min(seconds, element.duration || seconds)
    void element.play().catch(() => {
      // Autoplay can be blocked; the seek still happened, which is the point.
    })
  }

  return (
    <>
      <Section title="What happened">
        <p className="text-[12.5px] leading-relaxed text-ui-muted">{report.summary}</p>
      </Section>

      <Section title="Notes on the cut">
        <motion.ul
          className="space-y-3"
          variants={NOTES_LIST}
          initial={reduceMotion ? false : 'hidden'}
          animate="shown"
        >
          {report.notes.map((note, index) => {
            const severity = SEVERITY[note.severity]
            return (
              <motion.li key={`${note.at}-${index}`} variants={reduceMotion ? undefined : NOTE_ITEM}>
                <button
                  onClick={() => scrubTo(note.at)}
                  disabled={!video?.objectUrl}
                  className="group block w-full text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="tnum rounded bg-ui-raised px-1.5 py-0.5 text-[11px] text-ui-accent transition-colors group-enabled:group-hover:bg-ui-accent group-enabled:group-hover:text-ui-on-accent">
                      {formatTime(note.at)}
                    </span>
                    <Pill tone={severity.tone}>{severity.label}</Pill>
                  </div>
                  <p className="display mt-1.5 text-[13.5px] leading-snug text-ui-text">
                    {note.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-ui-muted">{note.detail}</p>
                </button>
              </motion.li>
            )
          })}
        </motion.ul>
        {video?.objectUrl && (
          <p className="mt-3 text-[11px] text-ui-faint">Tap a timestamp to jump the video there.</p>
        )}
      </Section>

      <Section title="Lines to try">
        <ul className="space-y-3.5">
          {report.hooks.map((hook) => (
            <li key={hook.label}>
              <p className="text-[11.5px] text-ui-faint">{hook.label}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-ui-muted line-through decoration-ui-faint/60">
                {hook.original}
              </p>
              <p className="display mt-1.5 text-[13.5px] leading-snug text-ui-text">
                {hook.suggestion}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ui-faint">{hook.rationale}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Videos worth a look">
        <ul className="space-y-3">
          {report.references.map((reference) => (
            <li key={reference.title}>
              <p className="display text-[13px] leading-snug text-ui-text">{reference.title}</p>
              <p className="mt-0.5 text-[11.5px] text-ui-accent">@{reference.account.replace(/^@/, '')}</p>
              <p className="tnum mt-1 text-[11.5px] text-ui-muted">
                {[
                  reference.observed.plays !== undefined &&
                    `${reference.observed.plays.toLocaleString()} plays`,
                  reference.observed.likes !== undefined &&
                    `${reference.observed.likes.toLocaleString()} likes`,
                  reference.observed.comments !== undefined &&
                    `${reference.observed.comments.toLocaleString()} comments`,
                ]
                  .filter(Boolean)
                  .join(', ') || 'No metrics available'}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ui-faint">
                {reference.whyRelevant}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-ui-faint">
          Observed numbers from the public scrape, shown as found. A metric the scrape did not
          return is left out rather than shown as zero.
        </p>
      </Section>
    </>
  )
}
