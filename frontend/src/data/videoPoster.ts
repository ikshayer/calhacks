/**
 * Everything that decodes an uploaded video file in the browser.
 *
 * Both helpers load the file into a detached `<video>` element through a
 * short-lived object URL. That URL is separate from the long-lived one the
 * analysis keeps for playback, so these can be revoked the moment decoding is
 * done without pulling the file out from under the player.
 */

const POSTER_WIDTH = 320
const POSTER_QUALITY = 0.7
/** Some codecs never fire `seeked`; a poster is cosmetic and must not hang an upload. */
const POSTER_TIMEOUT_MS = 8000

/** Reads a video's duration by letting the browser decode its metadata. */
export function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const element = document.createElement('video')
    element.preload = 'metadata'

    const cleanup = () => {
      URL.revokeObjectURL(url)
      element.removeAttribute('src')
    }

    element.onloadedmetadata = () => {
      const { duration } = element
      cleanup()
      // A stream with no known duration still deserves a usable default.
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 30)
    }
    element.onerror = () => {
      cleanup()
      reject(new Error('The browser could not read that video. Try an mp4.'))
    }
    element.src = url
  })
}

/**
 * Captures one frame of a video as a small JPEG data URL.
 *
 * Resolves `undefined` instead of rejecting: the poster only decorates the
 * history list, so failing to make one must never fail the upload it belongs
 * to. Failures are logged so a codec that never yields a frame is diagnosable.
 */
export function capturePoster(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const element = document.createElement('video')
    element.preload = 'auto'
    // Muted and inline so no browser autoplay policy or fullscreen takeover applies.
    element.muted = true
    element.playsInline = true

    let settled = false
    const finish = (poster: string | undefined, problem?: unknown) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      URL.revokeObjectURL(url)
      element.removeAttribute('src')
      if (problem !== undefined) console.warn('Could not capture a poster frame.', problem)
      resolve(poster)
    }
    const timer = window.setTimeout(
      () => finish(undefined, new Error('Timed out waiting for a video frame.')),
      POSTER_TIMEOUT_MS,
    )

    element.onloadedmetadata = () => {
      const { duration } = element
      // Frame 0 is often black or a fade-in; a second in is usually the hook.
      element.currentTime =
        Number.isFinite(duration) && duration > 0 ? Math.min(1, duration / 2) : 0
    }
    element.onseeked = () => {
      try {
        const { videoWidth, videoHeight } = element
        if (videoWidth === 0 || videoHeight === 0) {
          finish(undefined, new Error('The video has no decodable picture.'))
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = POSTER_WIDTH
        canvas.height = Math.round((POSTER_WIDTH * videoHeight) / videoWidth)
        const context = canvas.getContext('2d')
        if (!context) {
          finish(undefined, new Error('Canvas 2D is unavailable.'))
          return
        }
        context.drawImage(element, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', POSTER_QUALITY))
      } catch (cause: unknown) {
        finish(undefined, cause)
      }
    }
    element.onerror = () =>
      finish(undefined, element.error ?? new Error('The video failed to load.'))
    element.src = url
  })
}
