/** Model choices and prices in one place, so they are easy to change. */
export const models = {
  videoAnalysis: {
    id: 'claude-haiku-5-5',
    effort: 'medium',
    maxTokens: 16000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  /** Local Whisper via transformers.js (ONNX); no API key. */
  transcription: { id: 'Xenova/whisper-base.en' },
} as const;
