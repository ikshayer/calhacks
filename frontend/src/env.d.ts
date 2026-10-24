/// <reference types="vite/client" />

/** Build-time settings. Put local values in frontend/.env.local (gitignored). */
interface ImportMetaEnv {
  /** 'spacetime' for the live backend; anything else uses the local mock. */
  readonly VITE_DATA_SOURCE?: string
  /** e.g. wss://maincloud.spacetimedb.com */
  readonly VITE_SPACETIME_HOST?: string
  /** e.g. calhacks-wwif0 */
  readonly VITE_SPACETIME_DB?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
