/// <reference types="vite/client" />
// Vite injects import.meta.env at build/serve time. NOTE: a triple-slash
// types reference is PROGRAM-GLOBAL once this file is in the tsconfig
// program — src/ gains these ambient types too. It lives in examples/ as an
// intent signal only: src/ is the lib surface and should stay
// bundler-agnostic (zero import.meta uses there today — keep it that way).
