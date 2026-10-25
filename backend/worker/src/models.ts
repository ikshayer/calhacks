/** Model choices and prices in one place, so they are easy to change. */
export const models = {
  videoAnalysis: {
    id: 'claude-haiku-5-5',
    effort: 'medium',
    maxTokens: 16000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  report: {
    id: 'claude-haiku-5-5',
    effort: 'medium',
    maxTokens: 16000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  chat: {
    id: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 4000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  explanation: {
    id: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 1000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  comparison: {
    id: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 1000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  ideaParse: {
    id: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 2000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  ideaAnalysis: {
    id: 'claude-haiku-5-5',
    effort: 'medium',
    maxTokens: 8000,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  ideaReason: {
    id: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 600,
    usdPerInputToken: 0.1 / 1_000_000,
    usdPerOutputToken: 0.5 / 1_000_000,
  },
  /** Local Whisper via transformers.js (ONNX); no API key. */
  transcription: { id: 'Xenova/whisper-base.en' },
} as const;
