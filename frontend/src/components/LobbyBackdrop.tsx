import { useReducedMotion } from 'motion/react'
import Dither from '@/components/reactbits/Dither'

/**
 * The dithered field behind the lobby screens.
 *
 * A slow wave posterised to five steps of the brand ramp and rendered through
 * an ordered Bayer matrix, so it reads as coarse printed dots rather than a
 * smooth gradient. That choice is the point: the product's own world is a
 * low-poly toy town of fifty residents, and a crisp modern mesh gradient
 * behind it would belong to a different, slicker product. Dithering is the
 * same idea as the island — something deliberately made of visible pieces.
 *
 * On paper it stays quiet on purpose — printed tone, not wallpaper. The one
 * saturated thing in the lobby is still the gradient panel beside the
 * onboarding questions; this sits under everything and is only noticed when
 * you stop reading.
 */

/**
 * Paper to a faint burgundy blush. Posterisation walks these five steps.
 *
 * Deliberately a narrow range: on a light ground the dots read as printed
 * tone, and any more contrast turns the page into wallpaper that the cards
 * have to shout over.
 */
const RAMP = ['#f6f5f4', '#ece6e4', '#e0d0d1', '#cfb2b7', '#b98f98']

export function LobbyBackdrop() {
  const reduceMotion = Boolean(useReducedMotion())

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <Dither
        palette={RAMP}
        backgroundColor="#f4f3f2"
        colorNum={5}
        pixelSize={4}
        ditherMode="bayer"
        // Slow enough to be weather rather than animation: at a glance the
        // page looks still, and the movement only registers if you rest on it.
        waveSpeed={0.016}
        waveFrequency={2.2}
        waveAmplitude={0.28}
        contrast={1.04}
        brightness={0.02}
        // The shader fills the viewport, so uncapped DPR on a retina laptop
        // quadruples the fragment count for an effect nobody is looking at.
        dpr={1}
        // Interaction belongs to the content here, not the wallpaper; the
        // pointer is busy with a dropzone and a form.
        enableMouseInteraction={false}
        clickRipple={false}
        intro={!reduceMotion}
        disableAnimation={reduceMotion}
      />
      {/*
        Three washes over the shader, all doing real work rather than styling.

        The dither is only allowed to be vivid where nothing has to be read.
        Left unchecked it sits at the same value as the cards and they dissolve
        into it, so the field is pushed back hard across the centre column and
        the foot of the page, and kept bright only in the top-right corner
        where there is nothing but air.
      */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(135% 100% at 80% -8%, rgba(244,243,242,0.02) 0%, rgba(244,243,242,0.48) 36%, rgba(244,243,242,0.84) 68%, rgba(244,243,242,0.96) 100%)',
        }}
      />
      {/* A vertical scrim so headings at the top never land on a dense cell. */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-canvas to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-b from-transparent to-canvas" />
    </div>
  )
}
