/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_PARTY_WS_URL?: string
  readonly VITE_SYNC_URL?: string
  readonly VITE_HTTPS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
