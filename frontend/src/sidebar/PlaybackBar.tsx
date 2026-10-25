import { useAppStore, type RunState } from '@/store/useAppStore'

const SPEEDS = [0.5, 1, 2, 4]

/**
 * Transport controls for the cascade, floating over the island.
 *
 * The round ticks are numbered because a cascade genuinely *is* a sequence —
 * round 0 is the audience you reached directly, and everything after it was
 * reached by someone sharing. Being able to step back through that is the
 * difference between a nice animation and something you can read.
 */
export function PlaybackBar({ run }: { run: RunState }) {
  const round = useAppStore((state) => state.playback.round)
  const playing = useAppStore((state) => state.playback.playing)
  const speed = useAppStore((state) => state.playback.speed)
  const setPlaying = useAppStore((state) => state.setPlaying)
  const setSpeed = useAppStore((state) => state.setSpeed)
  const seekRound = useAppStore((state) => state.seekRound)

  const received = run.rounds.length
  const atEnd = round >= received

  if (run.status === 'failed') {
    return (
      <div className="over-canvas absolute bottom-5 left-5 max-w-[42ch] rounded-xl px-4 py-3">
        <p className="display text-[14px] text-bloom">This run did not produce a result</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{run.error}</p>
      </div>
    )
  }

  // A campaign reopened from history keeps its metrics and its report, but the
  // round log is too large to persist, so there is nothing to replay. Saying so
  // is better than offering a scrubber that cannot move.
  if (run.status === 'complete' && received === 0) {
    return (
      <div className="over-canvas absolute bottom-5 left-5 max-w-[42ch] rounded-xl px-4 py-3">
        <p className="display text-[14px] text-paper">Cascade not stored</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          This run was restored from history, so the round-by-round spread cannot be replayed. Its
          report and totals are unchanged.
        </p>
      </div>
    )
  }

  return (
    <div className="over-canvas absolute bottom-5 left-5 rounded-xl px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            // Replaying from the end restarts rather than doing nothing.
            if (atEnd && received > 0) seekRound(0)
            setPlaying(!playing)
          }}
          className="grid h-9 w-9 place-items-center rounded-full bg-sun text-ink transition-[filter] hover:brightness-105"
          aria-label={playing ? 'Pause the cascade' : atEnd ? 'Replay the cascade' : 'Play the cascade'}
        >
          {playing ? <PauseIcon /> : atEnd && received > 0 ? <ReplayIcon /> : <PlayIcon />}
        </button>

        <div>
          <p className="display text-[14px] leading-none text-paper">
            {run.status === 'scoring'
              ? 'Scoring the audience'
              : round === 0
                ? 'Before anyone has seen it'
                : `Round ${round} of ${received}`}
          </p>
          <p className="mt-1 text-[11.5px] leading-none text-muted">
            {round === 0
              ? run.label
              : round === 1
                ? 'Shown directly to the seeded audience'
                : 'Reached by someone sharing it'}
          </p>
        </div>

        <div className="ml-2 flex items-center gap-1 border-l border-line pl-3">
          {SPEEDS.map((option) => (
            <button
              key={option}
              onClick={() => setSpeed(option)}
              aria-pressed={speed === option}
              className={
                'tnum rounded px-1.5 py-0.5 text-[11.5px] transition-colors ' +
                (speed === option ? 'bg-raised text-sun' : 'text-faint hover:text-paper')
              }
            >
              {option}×
            </button>
          ))}
        </div>
      </div>

      {received > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          {Array.from({ length: received + 1 }, (_, index) => {
            const reached = index <= round
            return (
              <button
                key={index}
                onClick={() => {
                  setPlaying(false)
                  seekRound(index)
                }}
                title={index === 0 ? 'Before anyone has seen it' : `Round ${index}`}
                aria-label={index === 0 ? 'Before anyone has seen it' : `Jump to round ${index}`}
                className="group flex w-7 flex-col items-center gap-1"
              >
                <span
                  className={
                    'h-1 w-full rounded-full transition-colors ' +
                    (reached ? 'bg-sun' : 'bg-line group-hover:bg-faint')
                  }
                />
                <span
                  className={
                    'tnum text-[10px] leading-none transition-colors ' +
                    (reached ? 'text-sun' : 'text-faint')
                  }
                >
                  {index}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PlayIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 13 14" aria-hidden>
      <path d="M1 1.2 12 7 1 12.8Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg width="12" height="13" viewBox="0 0 12 13" aria-hidden>
      <rect x="0.5" y="0.5" width="4" height="12" rx="1" fill="currentColor" />
      <rect x="7.5" y="0.5" width="4" height="12" rx="1" fill="currentColor" />
    </svg>
  )
}

function ReplayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden fill="none">
      <path
        d="M7.5 3V0.6L4 3.4 7.5 6.2V3.8a3.7 3.7 0 1 1-3.7 3.7H2.2a5.3 5.3 0 1 0 5.3-4.5Z"
        fill="currentColor"
      />
    </svg>
  )
}
