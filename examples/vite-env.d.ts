/// <reference types="vite/client" />
// Vite injects import.meta.env at build/serve time. NOTE: a triple-slash
// types reference is PROGRAM-GLOBAL once this file is in the tsconfig
// program — src/ gains these ambient types too. It lives in examples/ as an
// intent signal only: src/ is the lib surface and should stay
// bundler-agnostic (zero import.meta uses there today — keep it that way).
// AMENDED 2026-09-17 (Phase 2 ticket 09, owner ruling Stop 9): the ban NARROWS
// to Vite-specific surfaces — import.meta.env and import.meta.hot stay out of
// src/. Standard import.meta.url is allowed: it typechecks with "types": [],
// so it does not lean on these ambient Vite types (src/ already depends on
// Vite at decode.ts's ?worker&inline import). First use: the decode-worker
// URL factory SiteRuntime imports.

// ?url asset import used by splat-lab (ticket 03); same media-page pattern.
declare module "*.ply?url" {
  const src: string;
  export default src;
}
