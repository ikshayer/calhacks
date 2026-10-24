import { useEffect, useMemo, useState } from 'react'
import {
  AUDIENCE_SIZE,
  closeAllRunSubscriptions,
  selectActiveRun,
  useAppStore,
} from '@/store/useAppStore'
import { assignHomeTiles, buildIsland } from '@/island/scene/island'
import { IslandSim } from '@/island/scene/IslandSim'
import { IslandCanvas } from '@/island/IslandCanvas'
import { useCascadePlayback } from '@/island/useCascadePlayback'
import { hashSeed } from '@/lib/rng'
import { Sidebar } from '@/sidebar/Sidebar'
import { PlaybackBar } from '@/sidebar/PlaybackBar'
import { VillagerCard } from '@/island/VillagerCard'

/**
 * The workspace: the island on the left, the instrument panel on the right.
 *
 * This component owns the one piece of glue that matters — building the
 * `IslandSim` from the loaded audience and keeping it alive across runs. The
 * sim is memoised on the audience, not on the run, so starting a second run
 * does not rebuild 120 characters.
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

  useEffect(() => {
    void loadAudience()
  }, [loadAudience, profile])

  useEffect(() => closeAllRunSubscriptions, [])

  // The island is generated once and never regenerated: its shape is the set
  // the town is built on, and moving the coastline mid-session would relocate
  // every resident.
  const island = useMemo(() => buildIsland(hashSeed('giving-garden-island')), [])

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
    )
  }, [audience, island, homesByGroup])

  useCascadePlayback(sim, run?.rounds ?? [], run?.id ?? null)

  // The island indexes villagers densely; the rest of the app speaks member ids.
  const selectedIndex = useMemo(() => {
    if (!sim || selectedMemberId === null) return null
    return sim.indexOfMember(selectedMemberId) ?? null
  }, [sim, selectedMemberId])

  const selectedMember = useMemo(
    () => audience?.members.find((member) => member.id === selectedMemberId) ?? null,
    [audience, selectedMemberId],
  )

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <main className="relative min-h-[52vh] flex-1 lg:min-h-0">
        {audienceError ? (
          <IslandFallback title="The audience could not be built">{audienceError}</IslandFallback>
        ) : !sim || !audience ? (
          <IslandFallback title="Building the town…">
            Laying out streets and the social graph between {AUDIENCE_SIZE.total} residents.
          </IslandFallback>
        ) : (
          <IslandCanvas
            sim={sim}
            island={island}
            members={audience.members}
            selectedIndex={selectedIndex}
            onSelect={(index) =>
              selectMember(index === null ? null : sim.memberOfIndex(index))
            }
            highlightGroupId={highlightedGroupId}
            highlightColor={highlightColor}
            shadows={shadows}
            paused={false}
          />
        )}

        {sim && run && <PlaybackBar run={run} />}

        {selectedMember && (
          <VillagerCard
            member={selectedMember}
            decision={run?.decisions?.find((entry) => entry.memberId === selectedMember.id)}
            group={profile?.groups.find((entry) => entry.id === selectedMember.groupId)}
            onClose={() => selectMember(null)}
          />
        )}
      </main>

      <Sidebar
        shadows={shadows}
        onShadowsChange={setShadows}
        playing={playing}
      />
    </div>
  )
}

function IslandFallback({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center bg-[#16211c] px-6 text-center">
      <div className="max-w-[34ch]">
        <p className="display text-lg text-paper">{title}</p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{children}</p>
      </div>
    </div>
  )
}
