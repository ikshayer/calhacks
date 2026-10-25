import { useEffect, useMemo, useState } from 'react'
import {
  AUDIENCE_SIZE,
  closeAllRunSubscriptions,
  selectActiveRun,
  useAppStore,
} from '@/store/useAppStore'
import { assignHomeTiles } from '@/island/scene/island'
import { buildElevatedIsland } from '@/island/scene/ground'
import { IslandSim } from '@/island/scene/IslandSim'
import { IslandCanvas } from '@/island/IslandCanvas'
import { useCascadePlayback } from '@/island/useCascadePlayback'
import { hashSeed } from '@/lib/rng'
import { Sidebar } from '@/sidebar/Sidebar'
import { PlaybackBar } from '@/sidebar/PlaybackBar'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/**
 * The workspace: the island on the left, the instrument panel on the right.
 *
 * This component owns the one piece of glue that matters — building the
 * `IslandSim` from the loaded audience and keeping it alive across runs. The
 * sim is memoised on the audience, not on the run, so starting a second run
 * does not rebuild the 50 resident characters.
 */
export function WorkspaceRoute() {
  const profile = useAppStore((state) => state.profile)
  const audience = useAppStore((state) => state.audience)
  const audienceError = useAppStore((state) => state.audienceError)
  const loadAudience = useAppStore((state) => state.loadAudience)
  const run = useAppStore(selectActiveRun)
  const selectedMemberId = useAppStore((state) => state.selectedMemberId)
  const selectMember = useAppStore((state) => state.selectMember)
  const playing = useAppStore((state) => state.playback.playing)
  const highlightedGroupId = useAppStore((state) => state.highlightedGroupId)
  const highlightColor =
    profile?.groups.find((group) => group.id === highlightedGroupId)?.color ?? '#f2b53c'

  const [shadows, setShadows] = useState(true)
  // The town degrades to an empty island rather than failing the whole scene, so
  // the loss has to be stated somewhere the user will actually see it.
  const [townError, setTownError] = useState<string | null>(null)

  useEffect(() => {
    void loadAudience()
  }, [loadAudience, profile])

  useEffect(() => closeAllRunSubscriptions, [])

  // The island is generated once and never regenerated: its shape is the set
  // the town is built on, and moving the coastline mid-session would relocate
  // every resident.
  const island = useMemo(() => buildElevatedIsland(hashSeed('giving-garden-island')), [])

  const homesByGroup = useMemo(() => {
    const groups = profile?.groups ?? []
    return assignHomeTiles(island, groups.map((g) => g.id), groups.map((g) => g.share))
  }, [island, profile?.groups])

  const sim = useMemo(() => {
    if (!audience) return null
    return new IslandSim(
      audience.members,
      island,
      homesByGroup,
      hashSeed(`town-${audience.version}`),
      import.meta.env.DEV && new URLSearchParams(location.search).get('residents') === 'kenney'
        ? undefined : { min: 0.50, max: 0.75 },
    )
  }, [audience, island, homesByGroup])

  const currentRun = run?.options.audienceKey === audience?.key ? run : undefined
  useCascadePlayback(sim, currentRun?.rounds ?? [], currentRun?.id ?? null)

  // The island indexes villagers densely; the rest of the app speaks member ids.
  const selectedIndex = useMemo(() => {
    if (!sim || selectedMemberId === null) return null
    return sim.indexOfMember(selectedMemberId) ?? null
  }, [sim, selectedMemberId])

  // Escape leaves a member's report the same way the back row does. Keyed on
  // the selection so an idle workspace does not hold a document listener.
  useEffect(() => {
    if (selectedMemberId === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') selectMember(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedMemberId, selectMember])

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <main className="relative min-h-[52vh] flex-1 lg:min-h-0">
        {audienceError ? (
          <IslandFallback title="The audience could not be built" action={
            <button onClick={() => void loadAudience()} className="mt-4 rounded-md bg-raised px-3 py-1.5 text-[13px] text-paper hover:text-sun">
              Try again
            </button>
          }>{audienceError}</IslandFallback>
        ) : !sim || !audience ? (
          <IslandFallback title="Building the town…">
            Laying out streets and the social graph between {AUDIENCE_SIZE.total} residents.
          </IslandFallback>
        ) : (
          <ErrorBoundary
            fallback={(error, retry) => (
              <IslandFallback
                title="The island could not be drawn"
                action={
                  <button
                    onClick={retry}
                    className="mt-4 rounded-md bg-raised px-3 py-1.5 text-[13px] text-paper transition-colors hover:text-sun"
                  >
                    Try again
                  </button>
                }
              >
                {error.message} The report and run controls are still usable.
              </IslandFallback>
            )}
          >
            <IslandCanvas
              sim={sim}
              island={island}
              members={audience.members}
              appearanceContext={`${profile?.id ?? 'audience'}:${audience.version}`}
              selectedIndex={selectedIndex}
              selectionWithoutBody={selectedMemberId !== null && selectedIndex === null}
              onSelect={(index) =>
                selectMember(index === null ? null : sim.memberOfIndex(index))
              }
              highlightGroupId={highlightedGroupId}
              highlightColor={highlightColor}
              shadows={shadows}
              paused={false}
              onTownError={(error) =>
                setTownError(error instanceof Error ? error.message : String(error))
              }
            />
          </ErrorBoundary>
        )}

        {townError && (
          <div className="over-canvas absolute inset-x-3 top-3 rounded-lg px-3.5 py-2.5 lg:inset-x-auto lg:left-3 lg:max-w-[46ch]">
            <p className="text-[12.5px] font-medium text-sun">Showing the island without buildings</p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted">{townError}</p>
          </div>
        )}

        {sim && currentRun && <PlaybackBar run={currentRun} />}
      </main>

      <Sidebar
        shadows={shadows}
        onShadowsChange={setShadows}
        playing={playing}
      />
    </div>
  )
}

function IslandFallback({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="grid h-full place-items-center bg-[#16211c] px-6 text-center">
      <div className="max-w-[34ch]">
        <p className="display text-lg text-paper">{title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{children}</p>
        {action}
      </div>
    </div>
  )
}
