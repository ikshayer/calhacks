import { AUDIENCE_SIZE } from '@/store/useAppStore'

export function ViewOptions({ shadows, onShadowsChange, sourceLabel, playing }: {
  shadows: boolean; onShadowsChange(value: boolean): void; sourceLabel: string; playing: boolean
}) {
  return <div className="flex items-center justify-between gap-3 border-t border-ui-border px-4 py-3 text-[10.5px] text-ui-faint">
    <span>{AUDIENCE_SIZE.total} residents · {sourceLabel.startsWith('Live') ? 'Live' : 'Demo'} · {playing ? 'Playing' : 'Paused'}</span>
    <label className="flex items-center gap-1.5">Shadows<input type="checkbox" checked={shadows} onChange={(event) => onShadowsChange(event.target.checked)} className="h-3.5 w-3.5" /></label>
  </div>
}
