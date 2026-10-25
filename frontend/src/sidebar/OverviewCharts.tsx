import { VERDICT_STYLE, type IdeaVerdict } from '@/data/ideaVerdict'
import { nonnegative, type ideaResponse } from '@/data/overviewStats'

export const VERDICTS: IdeaVerdict[] = ['going', 'maybe', 'not']
export const chartNumber = (value: number | undefined, digits = 0) =>
  nonnegative(value) === undefined ? '—' : value!.toLocaleString(undefined, { maximumFractionDigits: digits })

export function ChartBar({ label, value, max, color = 'var(--color-ui-accent)', detail }: {
  label: string; value?: number; max?: number; color?: string; detail?: string
}) {
  const valid = nonnegative(value)
  const ceiling = nonnegative(max)
  const width = valid !== undefined && ceiling && ceiling > 0 ? Math.min(100, valid / ceiling * 100) : 0
  return (
    <div role="img" aria-label={`${label}: ${detail ?? chartNumber(valid, 1)}${valid === undefined ? ', unavailable' : ''}`}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[11.5px]">
        <span className="min-w-0 truncate text-ui-muted" title={label}>{label}</span>
        <span className="tnum shrink-0 text-ui-text">{detail ?? chartNumber(valid, 1)}</span>
      </div>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-ui-raised">
        <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  )
}

export function ResponseDonut({ response }: { response: ReturnType<typeof ideaResponse> }) {
  let offset = 0
  const label = VERDICTS.map((verdict) => `${VERDICT_STYLE[verdict].label}: ${response.counts[verdict]} of ${response.scored} scored`).join('; ')
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 96 96" className="h-28 w-28 shrink-0" role="img" aria-label={`${label}; ${response.missing} unscored`}>
        <circle cx="48" cy="48" r="35" fill="none" stroke="var(--color-ui-raised)" strokeWidth="12" />
        {VERDICTS.map((verdict) => {
          const size = response.scored ? response.counts[verdict] / response.scored * 100 : 0
          const start = offset
          offset += size
          return <circle key={verdict} cx="48" cy="48" r="35" fill="none" stroke={VERDICT_STYLE[verdict].color}
            strokeWidth="12" pathLength="100" strokeDasharray={`${size} ${100 - size}`} strokeDashoffset={-start} transform="rotate(-90 48 48)" />
        })}
        <text x="48" y="47" textAnchor="middle" className="fill-ui-text text-[21px] font-semibold">{response.counts.going}</text>
        <text x="48" y="61" textAnchor="middle" className="fill-ui-faint text-[9px]">would go</text>
      </svg>
      <dl className="min-w-0 flex-1 space-y-2">
        {VERDICTS.map((verdict) => <div key={verdict} className="flex items-center justify-between gap-2 text-[12px]">
          <dt className="flex min-w-0 items-center gap-2 text-ui-muted"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: VERDICT_STYLE[verdict].color }} />{VERDICT_STYLE[verdict].label}</dt>
          <dd className="tnum font-medium text-ui-text">{response.counts[verdict]}</dd>
        </div>)}
      </dl>
    </div>
  )
}
