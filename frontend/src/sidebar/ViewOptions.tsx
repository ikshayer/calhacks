import { AUDIENCE_SIZE } from '@/store/useAppStore'

export function ViewOptions({ sourceLabel, playing, complete = false }: {
  sourceLabel: string; playing: boolean; complete?: boolean
}) {
  return <div className="flex items-center justify-between gap-3 border-t border-ui-border px-4 py-3 text-[10.5px] text-ui-faint">
    <span>{AUDIENCE_SIZE.total} residents · {sourceLabel.startsWith('Live') ? 'Live' : 'Demo'} · {complete ? 'Final results' : playing ? 'Playing' : 'Paused'}</span>
  </div>
}
