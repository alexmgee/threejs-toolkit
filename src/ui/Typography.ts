import type { SiteTypographySettings } from "../site/SiteConfig";
import { DEFAULT_FONT_STACK } from "./TextLayout";

export interface ResolvedTypography {
  fontFamily: string;
  baseSizePx: number;
  scaleRatio: number;
  lineHeight: number;
  measureCh: number;
}

/** Resolve the global typography tier. Keep defaults in sync with normalizeSiteConfig. */
export function resolveTypography(t?: SiteTypographySettings): ResolvedTypography {
  return {
    fontFamily: t?.fontFamily ?? DEFAULT_FONT_STACK,
    baseSizePx: t?.baseSizePx ?? 16,
    scaleRatio: t?.scaleRatio ?? 1.25,
    lineHeight: t?.lineHeight ?? 1.5,
    measureCh: t?.measureCh ?? 66,
  };
}

export function bodyFontString(rt: ResolvedTypography): string {
  return `${rt.baseSizePx}px ${rt.fontFamily}`;
}

export function titleFontString(rt: ResolvedTypography): string {
  return `600 ${Math.round(rt.baseSizePx * rt.scaleRatio)}px ${rt.fontFamily}`;
}

export function typographyCssVars(rt: ResolvedTypography): Record<string, string> {
  return {
    "--sjt-font-family": rt.fontFamily,
    "--sjt-base-size": `${rt.baseSizePx}px`,
    "--sjt-line-height": String(rt.lineHeight),
    "--sjt-measure": `${rt.measureCh}ch`,
  };
}
