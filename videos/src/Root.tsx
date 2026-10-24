import { Composition } from "remotion";
import { CampaignVideo, totalFrames, type Scene } from "./CampaignVideo";
import campaigns from "./campaigns.json";

const FPS = 30;
const variants = campaigns as Record<string, Scene[]>;

export const RemotionRoot = () => (
  <>
    {Object.entries(variants).map(([id, scenes]) => (
      <Composition
        key={id}
        id={id}
        component={CampaignVideo}
        durationInFrames={totalFrames(scenes, FPS)}
        fps={FPS}
        width={1080}
        height={1920}
        defaultProps={{ scenes }}
      />
    ))}
  </>
);
