import React from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from 'remotion';

// ---------- Design tokens ----------
const CREAM = '#fdfbf3';
const SUN = '#f2b53c';
const GREEN = '#2f5d3a';
const DISPLAY = 'Georgia, serif';
const SANS = 'system-ui, sans-serif';
const FPS = 30;
const SIDE = 90;
const SAFE_BOTTOM = 340;
const SAFE_TOP = 230;

const CLAMP = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
} as const;

const TEXT_SHADOW = '0 4px 24px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.45)';

// ---------- Helpers ----------
const enter = (
  frame: number,
  delay: number,
  duration: number,
  distance = 40
): React.CSSProperties => {
  const s = spring({
    frame: Math.max(0, frame - delay),
    fps: FPS,
    config: { damping: 200, stiffness: 120 },
  });
  const appear = frame < delay ? 0 : interpolate(s, [0, 1], [0, 1], CLAMP);
  const out = interpolate(frame, [duration - 6, duration], [1, 0], CLAMP);
  return {
    opacity: appear * out,
    transform: `translateY(${(1 - s) * distance}px)`,
  };
};

// ---------- Photos ----------
type PhotoSpec = {
  src: string;
  start: number;
  end: number;
  position: string;
  origin: string;
  driftX: number;
  driftY: number;
};

const PHOTOS: PhotoSpec[] = [
  { src: 'photos/p8.jpg', start: 0, end: 90, position: '50% 28%', origin: '50% 30%', driftX: 0, driftY: -30 },
  { src: 'photos/p1.jpg', start: 90, end: 165, position: '40% 50%', origin: '45% 50%', driftX: -30, driftY: 0 },
  { src: 'photos/p2.jpg', start: 165, end: 240, position: '62% 50%', origin: '60% 55%', driftX: 30, driftY: -20 },
  { src: 'photos/p4.jpg', start: 240, end: 315, position: '50% 65%', origin: '50% 70%', driftX: 0, driftY: -35 },
  { src: 'photos/p6.jpg', start: 315, end: 390, position: '45% 55%', origin: '45% 60%', driftX: -25, driftY: 0 },
  { src: 'photos/p5.jpg', start: 390, end: 510, position: '50% 40%', origin: '50% 35%', driftX: 20, driftY: 30 },
  { src: 'photos/p7.jpg', start: 510, end: 600, position: '18% 45%', origin: '30% 35%', driftX: 25, driftY: 0 },
];

const PhotoLayer: React.FC<{ spec: PhotoSpec; frame: number; first: boolean }> = ({
  spec,
  frame,
  first,
}) => {
  const visibleFrom = spec.start - 5;
  const visibleTo = spec.end + 5;
  if (frame < visibleFrom || frame >= visibleTo) {
    return null;
  }
  const opacity = first
    ? 1
    : interpolate(frame, [spec.start - 5, spec.start + 5], [0, 1], {
        ...CLAMP,
        easing: Easing.inOut(Easing.quad),
      });
  const progress = interpolate(frame, [visibleFrom, visibleTo], [0, 1], CLAMP);
  const scale = 1 + 0.12 * progress;
  const dx = spec.driftX * progress;
  const dy = spec.driftY * progress;
  return (
    <AbsoluteFill style={{ opacity, overflow: 'hidden' }}>
      <Img
        src={staticFile(spec.src)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: spec.position,
          transformOrigin: spec.origin,
          transform: `scale(${scale}) translate(${dx}px, ${dy}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ---------- Scrims & grade ----------
const Scrims: React.FC<{ frame: number }> = ({ frame }) => {
  const top = interpolate(
    frame,
    [0, 235, 245, 385, 395, 505, 515, 600],
    [0.3, 0.3, 1, 1, 1, 1, 0.35, 0.35],
    CLAMP
  );
  const bottom = interpolate(frame, [0, 235, 245, 385, 395, 600], [1, 1, 0.4, 0.4, 1, 1], CLAMP);
  const mid = interpolate(frame, [0, 385, 395, 505, 515, 600], [0, 0, 1, 1, 0, 0], CLAMP);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill
        style={{
          backgroundColor: 'rgba(242,181,60,0.07)',
          mixBlendMode: 'soft-light',
        }}
      />
      <AbsoluteFill style={{ backgroundColor: 'rgba(10,20,12,0.3)', opacity: mid }} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 950,
          opacity: top,
          background:
            'linear-gradient(to bottom, rgba(12,18,10,0.78) 0%, rgba(12,18,10,0.5) 45%, rgba(12,18,10,0) 100%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 1300,
          opacity: bottom,
          background:
            'linear-gradient(to top, rgba(12,18,10,0.85) 0%, rgba(12,18,10,0.6) 45%, rgba(12,18,10,0) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)',
        }}
      />
    </AbsoluteFill>
  );
};

// ---------- Beat 1: Hook ----------
const Hook: React.FC = () => {
  const f = useCurrentFrame();
  const D = 90;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          bottom: SAFE_BOTTOM,
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <div
          style={{
            ...enter(f, 3, D),
            fontFamily: DISPLAY,
            fontSize: 96,
            lineHeight: 1.05,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          He came out to the farm.
        </div>
        <div
          style={{
            ...enter(f, 33, D),
            fontFamily: DISPLAY,
            fontSize: 118,
            lineHeight: 1.05,
            fontStyle: 'italic',
            color: SUN,
            textShadow: TEXT_SHADOW,
          }}
        >
          You can too.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Beat 2: Intro ----------
const Sprout: React.FC<{ f: number; duration: number }> = ({ f, duration }) => {
  const ease = Easing.inOut(Easing.cubic);
  const ground = interpolate(f, [4, 18], [0, 1], { ...CLAMP, easing: ease });
  const stem = interpolate(f, [10, 32], [0, 1], { ...CLAMP, easing: ease });
  const leftLeaf = interpolate(f, [26, 46], [0, 1], { ...CLAMP, easing: ease });
  const rightLeaf = interpolate(f, [34, 54], [0, 1], { ...CLAMP, easing: ease });
  const leftFill = interpolate(f, [44, 56], [0, 0.95], CLAMP);
  const rightFill = interpolate(f, [52, 64], [0, 0.95], CLAMP);
  const out = interpolate(f, [duration - 6, duration], [1, 0], CLAMP);
  const sway = Math.sin(f / 14) * 2 * interpolate(f, [54, 70], [0, 1], CLAMP);
  return (
    <svg
      width={150}
      height={170}
      viewBox="0 0 120 140"
      style={{ opacity: out, overflow: 'visible' }}
    >
      <path
        d="M20 136 L100 136"
        pathLength={1}
        stroke={SUN}
        strokeWidth={4}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={1}
        strokeDashoffset={1 - ground}
      />
      <g style={{ transformOrigin: '60px 136px', transform: `rotate(${sway}deg)` }}>
        <path
          d="M60 136 C60 112 57 86 60 56"
          pathLength={1}
          stroke={CREAM}
          strokeWidth={5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={1}
          strokeDashoffset={1 - stem}
        />
        <path
          d="M60 92 C40 90 22 74 18 52 C40 54 56 70 60 92 Z"
          pathLength={1}
          stroke={CREAM}
          strokeWidth={4}
          strokeLinejoin="round"
          fill={GREEN}
          fillOpacity={leftFill}
          strokeDasharray={1}
          strokeDashoffset={1 - leftLeaf}
        />
        <path
          d="M60 66 C68 44 88 30 108 30 C104 52 84 66 60 66 Z"
          pathLength={1}
          stroke={CREAM}
          strokeWidth={4}
          strokeLinejoin="round"
          fill={GREEN}
          fillOpacity={rightFill}
          strokeDasharray={1}
          strokeDashoffset={1 - rightLeaf}
        />
      </g>
    </svg>
  );
};

const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const D = 150;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          bottom: SAFE_BOTTOM,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 18,
        }}
      >
        <Sprout f={f} duration={D} />
        <div
          style={{
            ...enter(f, 10, D, 24),
            fontFamily: SANS,
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: 8,
            color: SUN,
            textShadow: TEXT_SHADOW,
          }}
        >
          THE GIVING GARDEN
        </div>
        <div
          style={{
            ...enter(f, 17, D),
            fontFamily: DISPLAY,
            fontSize: 92,
            lineHeight: 1.06,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          A nonprofit farm in Parker, TX
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Beat 3: What's here ----------
const WhatsHere: React.FC = () => {
  const f = useCurrentFrame();
  const D = 150;
  const bar = interpolate(f, [4, 22], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const barOut = interpolate(f, [D - 6, D], [1, 0], CLAMP);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: SAFE_TOP,
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        <div
          style={{
            width: 140 * bar,
            height: 8,
            borderRadius: 4,
            backgroundColor: SUN,
            opacity: barOut,
          }}
        />
        <div
          style={{
            ...enter(f, 8, D),
            fontFamily: DISPLAY,
            fontSize: 90,
            lineHeight: 1.08,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          We grow <span style={{ color: SUN, fontStyle: 'italic' }}>sustainable food</span> for our
          community.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Beat 4: The ask ----------
const Calendar: React.FC<{ f: number; duration: number }> = ({ f, duration }) => {
  const inS = spring({
    frame: Math.max(0, f - 6),
    fps: FPS,
    config: { damping: 14, stiffness: 120 },
  });
  const appear = f < 6 ? 0 : interpolate(inS, [0, 1], [0, 1], CLAMP);
  const out = interpolate(f, [duration - 6, duration], [1, 0], CLAMP);
  const popS = spring({
    frame: Math.max(0, f - 34),
    fps: FPS,
    config: { damping: 9, stiffness: 160 },
  });
  const numberScale = f < 34 ? 0.7 : interpolate(popS, [0, 1], [0.7, 1]);
  const pageStarts = [26, 16];
  const W = 340;
  const H = 360;
  const HEADER = 84;
  return (
    <div
      style={{
        position: 'relative',
        width: W,
        height: H,
        perspective: 1200,
        opacity: appear * out,
        transform: `translateY(${(1 - inS) * 80}px) scale(${0.85 + 0.15 * inS})`,
        filter: 'drop-shadow(0 18px 30px rgba(0,0,0,0.45))',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: HEADER,
          backgroundColor: GREEN,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
        }}
      />
      {[0.28, 0.72].map((x) => (
        <div
          key={x}
          style={{
            position: 'absolute',
            left: W * x - 13,
            top: -16,
            width: 26,
            height: 44,
            borderRadius: 13,
            backgroundColor: SUN,
            border: `4px solid ${CREAM}`,
            zIndex: 5,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: HEADER,
          bottom: 0,
          backgroundColor: CREAM,
          borderBottomLeftRadius: 26,
          borderBottomRightRadius: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: DISPLAY,
            fontSize: 200,
            lineHeight: 1,
            color: GREEN,
            transform: `scale(${numberScale})`,
          }}
        >
          30
        </div>
      </div>
      {pageStarts.map((start) => {
        const angle = interpolate(f, [start, start + 12], [0, 110], {
          ...CLAMP,
          easing: Easing.in(Easing.quad),
        });
        const pageOpacity = interpolate(angle, [0, 80, 95], [1, 1, 0], CLAMP);
        const shade = interpolate(angle, [0, 90], [1, 0.72], CLAMP);
        return (
          <div
            key={start}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: HEADER,
              bottom: 0,
              backgroundColor: CREAM,
              borderBottomLeftRadius: 26,
              borderBottomRightRadius: 26,
              transformOrigin: 'top center',
              transform: `rotateX(${angle}deg)`,
              backfaceVisibility: 'hidden',
              opacity: pageOpacity,
              filter: `brightness(${shade})`,
              boxShadow: '0 6px 10px rgba(0,0,0,0.12)',
              borderTop: '2px solid rgba(47,93,58,0.25)',
            }}
          >
            {[0.3, 0.5, 0.7].map((y) => (
              <div
                key={y}
                style={{
                  position: 'absolute',
                  left: 50,
                  right: 50,
                  top: `${y * 100}%`,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: 'rgba(47,93,58,0.12)',
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

const Ask: React.FC = () => {
  const f = useCurrentFrame();
  const D = 120;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: SAFE_TOP,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            ...enter(f, 2, D),
            fontFamily: DISPLAY,
            fontSize: 112,
            lineHeight: 1.05,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          Harvest day
        </div>
        <div style={{ height: 90 }} />
        <Calendar f={f} duration={D} />
        <div style={{ height: 70 }} />
        <div
          style={{
            ...enter(f, 40, D),
            fontFamily: DISPLAY,
            fontSize: 96,
            lineHeight: 1.05,
            color: SUN,
            textShadow: TEXT_SHADOW,
          }}
        >
          Friday, Oct 30
        </div>
        <div style={{ height: 40 }} />
        <div
          style={{
            ...enter(f, 48, D),
            fontFamily: SANS,
            fontSize: 54,
            fontWeight: 700,
            color: CREAM,
            backgroundColor: GREEN,
            padding: '18px 44px',
            borderRadius: 999,
            border: `3px solid ${SUN}`,
            boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
          }}
        >
          Volunteers needed
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Beat 5: Call to action ----------
const MapPin: React.FC<{ f: number; duration: number }> = ({ f, duration }) => {
  const pinS = spring({
    frame: Math.max(0, f - 2),
    fps: FPS,
    config: { damping: 9, stiffness: 110, mass: 0.8 },
  });
  const y = f < 2 ? -500 : interpolate(pinS, [0, 1], [-500, 0]);
  const pinOpacity = interpolate(f, [2, 6], [0, 1], CLAMP);
  const out = interpolate(f, [duration - 6, duration], [1, 0], CLAMP);
  const shadowScale = interpolate(y, [-500, 0], [0.3, 1], CLAMP);
  const BOX_W = 320;
  const TIP_Y = 236;
  return (
    <div style={{ position: 'relative', width: BOX_W, height: 260, opacity: out }}>
      {[0, 1].map((i) => {
        const t = f - 18 - i * 15;
        if (t < 0) {
          return null;
        }
        const phase = (t % 36) / 36;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: BOX_W / 2 - 80,
              top: TIP_Y - 26,
              width: 160,
              height: 52,
              borderRadius: '50%',
              border: `5px solid ${SUN}`,
              opacity: (1 - phase) * 0.9,
              transform: `scale(${0.3 + phase * 2.1})`,
            }}
          />
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: BOX_W / 2 - 40,
          top: TIP_Y - 10,
          width: 80,
          height: 20,
          borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.4)',
          opacity: pinOpacity,
          transform: `scale(${shadowScale})`,
        }}
      />
      <svg
        width={130}
        height={160}
        viewBox="-6 -6 112 136"
        style={{
          position: 'absolute',
          left: BOX_W / 2 - 65,
          top: TIP_Y - 160,
          opacity: pinOpacity,
          transform: `translateY(${y}px)`,
          overflow: 'visible',
        }}
      >
        <path
          d="M50 0 C22 0 0 22 0 50 C0 85 50 124 50 124 C50 124 100 85 100 50 C100 22 78 0 50 0 Z"
          fill={SUN}
          stroke={GREEN}
          strokeWidth={6}
          strokeLinejoin="round"
        />
        <circle cx={50} cy={48} r={18} fill={CREAM} stroke={GREEN} strokeWidth={5} />
      </svg>
    </div>
  );
};

const CallToAction: React.FC = () => {
  const f = useCurrentFrame();
  const D = 90;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 820,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <MapPin f={f} duration={D} />
      </div>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 1100,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            ...enter(f, 10, D, 24),
            fontFamily: SANS,
            fontSize: 50,
            fontWeight: 600,
            letterSpacing: 2,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          Come to
        </div>
        <div style={{ height: 8 }} />
        <div
          style={{
            ...enter(f, 17, D),
            fontFamily: DISPLAY,
            fontSize: 96,
            lineHeight: 1.05,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          4308 Church Lane
        </div>
        <div
          style={{
            ...enter(f, 24, D, 30),
            fontFamily: DISPLAY,
            fontSize: 60,
            lineHeight: 1.2,
            color: CREAM,
            textShadow: TEXT_SHADOW,
          }}
        >
          Parker, TX 75002
        </div>
        <div style={{ height: 30 }} />
        <div
          style={{
            ...enter(f, 34, D),
            fontFamily: DISPLAY,
            fontSize: 70,
            fontStyle: 'italic',
            lineHeight: 1.1,
            color: SUN,
            textShadow: TEXT_SHADOW,
          }}
        >
          Bring a friend.
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- Root ----------
export const GivingGardenReworked: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: '#10160f' }}>
      {PHOTOS.map((spec, i) => (
        <PhotoLayer key={spec.src + spec.start} spec={spec} frame={frame} first={i === 0} />
      ))}
      <Scrims frame={frame} />
      <Sequence from={0} durationInFrames={90} name="Hook">
        <Hook />
      </Sequence>
      <Sequence from={90} durationInFrames={150} name="Intro">
        <Intro />
      </Sequence>
      <Sequence from={240} durationInFrames={150} name="WhatsHere">
        <WhatsHere />
      </Sequence>
      <Sequence from={390} durationInFrames={120} name="Ask">
        <Ask />
      </Sequence>
      <Sequence from={510} durationInFrames={90} name="CallToAction">
        <CallToAction />
      </Sequence>
    </AbsoluteFill>
  );
};
