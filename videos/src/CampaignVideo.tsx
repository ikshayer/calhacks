import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export type Scene = { id: string; seconds: number; onScreen: string; voice: string };
export type CampaignProps = { scenes: Scene[] };

// Every animation is derived from the frame number, so the render is deterministic.
const SceneCard = ({ scene }: { scene: Scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const exit = interpolate(frame, [scene.seconds * fps - 8, scene.seconds * fps], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
      <div
        style={{
          opacity: enter * exit,
          transform: `translateY(${(1 - enter) * 60}px)`,
          color: "#fdfbf3",
          fontFamily: "Georgia, serif",
          fontSize: 110,
          fontWeight: 700,
          lineHeight: 1.1,
          textAlign: "center",
        }}
      >
        {scene.onScreen}
      </div>
      <Audio src={staticFile(`voice/${scene.id}.wav`)} />
    </AbsoluteFill>
  );
};

export const CampaignVideo = ({ scenes }: CampaignProps) => {
  const { fps } = useVideoConfig();
  let start = 0;
  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #2f5d3a, #6b8f3a)" }}>
      {scenes.map((scene) => {
        const from = start;
        start += scene.seconds * fps;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={scene.seconds * fps}>
            <SceneCard scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const totalFrames = (scenes: Scene[], fps: number) =>
  scenes.reduce((sum, s) => sum + s.seconds * fps, 0);
