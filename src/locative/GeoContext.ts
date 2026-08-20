/**
 * GeoContext — Tiered locative signal acquisition
 *
 * Location as a mode, not a gate: sites work fully with zero location
 * signal, and each tier only refines presentation. The tiers:
 *
 *   none → coarse (edge hint) → city → precise
 *
 * Sources, in boot precedence: URL preset (?place=name — a shared demo
 * link always wins) > edge hint (coarse geo the hosting site injects
 * from CDN headers; this module never fetches it) > nothing. GPS enters
 * only through requestPrecise(), which must be called from an explicit
 * user gesture (the CTA) — one-shot getCurrentPosition, never
 * watchPosition. An explicit gesture expresses fresh intent, so its
 * result replaces whatever source was active.
 *
 * Privacy posture (deliberate, do not relax):
 *  - Accuracy gates the tier: ≤ preciseAccuracyMax (100 m) → "precise";
 *    ≤ cityAccuracyMax (2000 m) → "city"; anything worse — including
 *    iOS "Approximate Location", which reports km-scale accuracy — is
 *    "city" with coordinates rounded to ~1 km by construction.
 *  - Coordinates are truncated before storing on PlaceInfo: 4 decimals
 *    (~11 m) for precise, 2 decimals (~1 km) otherwise.
 *  - Nothing is persisted: no cookies, no localStorage. PlaceInfo lives
 *    in memory for this page view.
 *  - Reverse geocoding only goes through a caller-supplied proxy —
 *    never third-party geocoders directly (rate limits, CORS, keys).
 *  - Denial must not degrade the experience: requestPrecise rejects and
 *    the current place is kept; consumers are expected to swallow it.
 *
 * Geolocation requires a secure context (HTTPS or localhost). Testing
 * the CTA on a phone over LAN needs https — see the commented
 * vite-plugin-mkcert block in vite.config.ts.
 */

// ─── Types ────────────────────────────────────────────────

export type PlaceTier = "none" | "coarse" | "city" | "precise";
export type PlaceSource = "none" | "preset" | "edge" | "gps";

export interface PlaceInfo {
  tier: PlaceTier;
  source: PlaceSource;
  lat?: number;
  lon?: number;
  /** Meters, 95% confidence (Geolocation API semantics) */
  accuracy?: number;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
  /** Only present after a reverse geocode */
  neighborhood?: string;
  /** Preset name when source === "preset" */
  presetName?: string;
}

export interface GeoContextConfig {
  /**
   * Coarse hint injected by the hosting site (parsed edge headers,
   * inlined JSON, …). The toolkit never fetches this itself.
   */
  edgeHint?: Partial<PlaceInfo>;
  /** Named demo places. Merged over DEMO_PLACES. */
  presets?: Record<string, Omit<PlaceInfo, "tier" | "source">>;
  /**
   * Reverse-geocode proxy endpoint:
   * GET {url}?lat=&lon= → { neighborhood?, city?, region?, country?, timezone? }
   */
  geocodeProxyUrl?: string;
  /** Accuracy (m) at or under which tier === "precise" (default: 100) */
  preciseAccuracyMax?: number;
  /** Accuracy (m) at or under which tier === "city" (default: 2000) */
  cityAccuracyMax?: number;
  /** getCurrentPosition timeout in ms (default: 6000) */
  gpsTimeoutMs?: number;
}

// ─── Demo presets ─────────────────────────────────────────

/** Built-in demo places for ?place= links. */
export const DEMO_PLACES: Record<string, Omit<PlaceInfo, "tier" | "source">> = {
  omaha: {
    lat: 41.2565,
    lon: -95.9345,
    city: "Omaha",
    region: "Nebraska",
    country: "US",
    timezone: "America/Chicago",
  },
  tokyo: {
    lat: 35.6762,
    lon: 139.6503,
    city: "Tokyo",
    region: "Tokyo",
    country: "JP",
    timezone: "Asia/Tokyo",
  },
  oslo: {
    lat: 59.9139,
    lon: 10.7522,
    city: "Oslo",
    region: "Oslo",
    country: "NO",
    timezone: "Europe/Oslo",
  },
  reykjavik: {
    lat: 64.1466,
    lon: -21.9426,
    city: "Reykjavík",
    region: "Capital Region",
    country: "IS",
    timezone: "Atlantic/Reykjavik",
  },
};

// ─── Helpers ──────────────────────────────────────────────

function truncateCoord(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// ─── GeoContext ───────────────────────────────────────────

export class GeoContext {
  private presets: Record<string, Omit<PlaceInfo, "tier" | "source">>;
  private geocodeProxyUrl: string | null;
  private preciseAccuracyMax: number;
  private cityAccuracyMax: number;
  private gpsTimeoutMs: number;

  private _place: PlaceInfo;
  private listeners = new Set<(place: PlaceInfo) => void>();
  private disposed = false;

  constructor(config: GeoContextConfig = {}) {
    this.presets = { ...DEMO_PLACES, ...config.presets };
    this.geocodeProxyUrl = config.geocodeProxyUrl ?? null;
    this.preciseAccuracyMax = config.preciseAccuracyMax ?? 100;
    this.cityAccuracyMax = config.cityAccuracyMax ?? 2000;
    this.gpsTimeoutMs = config.gpsTimeoutMs ?? 6000;

    this._place = config.edgeHint
      ? { ...config.edgeHint, tier: "coarse", source: "edge" }
      : { tier: "none", source: "none" };
  }

  // ─── State ────────────────────────────────────────────────

  /** Current best PlaceInfo. */
  get place(): PlaceInfo {
    return this._place;
  }

  /** Subscribe to place changes; returns an unsubscribe function. */
  onChange(cb: (place: PlaceInfo) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setPlace(place: PlaceInfo): void {
    this._place = place;
    for (const cb of this.listeners) cb(place);
  }

  // ─── Presets / URL override ───────────────────────────────

  /**
   * Apply ?place=<name> from location.search. Returns true when a
   * preset matched. No permission involved — call unconditionally on
   * boot; a shared demo link always wins.
   */
  applyUrlOverride(param = "place"): boolean {
    const name = new URLSearchParams(window.location.search).get(param);
    if (!name) return false;
    const key = name.toLowerCase();
    if (!this.presets[key]) return false;
    this.setPreset(key);
    return true;
  }

  /** Activate a named preset. Throws on unknown names. */
  setPreset(name: string): void {
    const preset = this.presets[name];
    if (!preset) {
      throw new Error(
        `GeoContext: unknown preset "${name}" (known: ${Object.keys(this.presets).join(", ")})`,
      );
    }
    this.setPlace({ ...preset, tier: "city", source: "preset", presetName: name });
  }

  // ─── CTA-gated precision ──────────────────────────────────

  /**
   * One-shot precise location. Call ONLY from a user gesture handler
   * (the CTA). Resolves with the updated PlaceInfo; rejects on denial,
   * timeout, or missing secure context — the current place is kept
   * either way, so denial must not change the page.
   */
  requestPrecise(): Promise<PlaceInfo> {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("GeoContext: navigator.geolocation is unavailable in this browser"));
        return;
      }
      if (!window.isSecureContext) {
        reject(
          new Error(
            "GeoContext: geolocation requires a secure context (HTTPS or localhost). " +
              "For LAN device testing, enable the vite-plugin-mkcert block in vite.config.ts.",
          ),
        );
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (this.disposed) return;
          const { latitude, longitude, accuracy } = position.coords;
          const tier: PlaceTier = accuracy <= this.preciseAccuracyMax ? "precise" : "city";
          // Worse than cityAccuracyMax (e.g. iOS Approximate Location)
          // still lands on "city", with km-scale coordinates by
          // construction: everything non-precise is rounded to 2 decimals.
          const decimals = tier === "precise" ? 4 : 2;
          const next: PlaceInfo = {
            tier,
            source: "gps",
            lat: truncateCoord(latitude, decimals),
            lon: truncateCoord(longitude, decimals),
            accuracy: Math.round(accuracy),
          };
          this.setPlace(next);
          resolve(next);
        },
        (error) => {
          reject(new Error(`GeoContext: ${error.message || "geolocation failed"} (code ${error.code})`));
        },
        {
          enableHighAccuracy: true,
          timeout: this.gpsTimeoutMs,
          maximumAge: 60_000,
        },
      );
    });
  }

  // ─── Reverse geocoding ────────────────────────────────────

  /**
   * Enrich the current place through the configured proxy. No-op with
   * a warning when geocodeProxyUrl is unset or no coordinates exist.
   */
  async reverseGeocode(): Promise<PlaceInfo> {
    if (!this.geocodeProxyUrl) {
      console.warn("GeoContext: reverseGeocode called without a geocodeProxyUrl — skipping");
      return this._place;
    }
    const { lat, lon } = this._place;
    if (lat === undefined || lon === undefined) {
      console.warn("GeoContext: reverseGeocode called without coordinates — skipping");
      return this._place;
    }
    const url = `${this.geocodeProxyUrl}?lat=${lat}&lon=${lon}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GeoContext: geocode proxy responded ${response.status}`);
    }
    const data = (await response.json()) as Partial<
      Pick<PlaceInfo, "neighborhood" | "city" | "region" | "country" | "timezone">
    >;
    if (this.disposed) return this._place;
    this.setPlace({ ...this._place, ...data });
    return this._place;
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
