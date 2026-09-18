// threejs-toolkit — API-parity barrel, honest Phase 1 (TRIMMED) form.
// Mirrors sparkjs-toolkit src/index.ts at pin fd67153: every landed module
// exports under the SAME name; the deferred sources are listed below so the
// trim is visible, not silent. Each later phase restores its names.
//
// ─── DEFERRED SOURCES (9 of the original 13 — the graph makes a full
//     same-names barrel impossible until Phase 4; doc 04 / ticket 11. The four
//     embed sources returned with Phase 2 ticket 09: embed/diagWiring (ruling
//     Stop 1), embed/SiteRuntime, embed/SplatSiteElement and
//     embed/FragmentRouter (ruling Stop 13, verbatim from the pin)) ───
// Phase 2 (ticket 11): core/StatsHUD (StatsHUD)
//          core/SplatBounds (computeSplatBounds — a D30 stub exists in-tree so
//          SiteRuntime compiles; per the D19 precedent its BARREL name returns
//          with ticket 11's rebuild, not as a stub)
// Phase 3: core/SplatLoader (loadSplatAsync only — loadSplat returned with
//          ticket 08; loadSplatAsync is a named refusal until SceneComposer's
//          ticket settles it (ruling 08-S4), and per the D19 precedent a
//          barrel name returns with its real implementation, not as a
//          throwing export)
//          core/CropTool (CropTool, evaluateSdf)
//          core/SceneComposer (SceneComposer)
//          interact/SplatHighlight (SplatHighlight)
//          core/DebugPanel (DebugPanel)
// Phase 4: core/SplatExporter (collectSplatData, exportToSpz, …)
//          ui/SplatTextMesh (SplatTextMesh — the D19 stub exists in-tree
//          for text/SplatLane's compile; its BARREL name returns with the
//          Phase 4 rebuild, not as a throwing export)
//
// ─── Scene export: OWNER RULED (2026-08-23, doc 06 D24) ───
// ThreeSplatScene exports under its OWN name — no SparkScene alias. Zero
// sparkjs consumers import the name from the barrel (all use the module
// path, which Phase 2 re-types regardless); an alias would misrepresent
// 14 config keys, 4 members, and the sync-vs-`ready` execution model to
// exactly the external consumers H-API protects. Recorded as a doc 06
// divergence entry per H-API's own mechanism.

// FIRST import: the sRGB working-space opt-in is a side-effect module — a
// consumer deep-importing only cells/ or text/ through this barrel must
// still get it before any THREE.Color construction (owner-reviewed AC,
// ticket 03 close).
import "./core/colorSpace";

// ─── Core ───
export { loadSplat, type SplatLoadOptions } from "./core/SplatLoader";
export { ThreeSplatScene, type ThreeSplatSceneConfig } from "./core/ThreeSplatScene";
export { createOrbitControls, type OrbitControlsConfig } from "./core/Controls";
export { LoadingUI, type LoadingUIConfig } from "./core/LoadingUI";
export { CameraSystem, type CameraSystemConfig, type CameraState, type RecenterConfig, type DynamicPitchConfig, type OrbitLimits, type InputSpeeds, type KeyboardFlyConfig } from "./core/CameraSystem";
export { type ColmapCamera, type ColmapImage, type ColmapData, type ColmapLoadOptions, type CameraPose, parseColmapText, parseColmapBinary, loadColmapData, colmapPoseToThreeJS, colmapPoseRaw, getFocalLengths, getPrincipalPoint } from "./core/ColmapData";
export { FrustumRenderer, type FrustumRendererConfig } from "./core/FrustumRenderer";
export { CameraPath, type CameraPathConfig, type CameraKeyframe, type EasingFn } from "./core/CameraPath";
export { CameraRail, type CameraRailConfig, type RailStop } from "./core/CameraRail";
export { ScrollRail, type ScrollRailConfig, type ScrollRailState } from "./core/ScrollRail";
export { EnvironmentLoader, type EnvironmentConfig, type EnvironmentOptions } from "./core/EnvironmentLoader";

// ─── Render ───
export { PropLayer, type PropLayerAttachTarget, type PropLayerLightingConfig } from "./render/PropLayer";
export { MediaLayer, isMediaBindingPresent } from "./render/MediaLayer";
export { SceneGrade } from "./render/SceneGrade";

// ─── Text / UI (Pretext) ───
export { DEFAULT_FONT_STACK, parseFontShorthand, toFontString, fontHeightPx, measureCharWidthPx, lineHeightMultiplier, getPrepared, wrapLines, measureTextHeight, whenFontsReady, clearTextLayoutCache, type ParsedFont } from "./ui/TextLayout";
export { resolveTypography, bodyFontString, titleFontString, typographyCssVars, type ResolvedTypography } from "./ui/Typography";
export { CaptionOverlay, type CaptionOverlayConfig, type CaptionCopy, type CaptionTypographyStyle } from "./ui/CaptionOverlay";
export { EditorialRegionEditor, type EditorialRegionEditorConfig } from "./ui/EditorialRegionEditor";
export { publishReservedRegion, reservedRegions, subscribeReservedRegions, choosePanelBox, type Rect, type PanelCandidate, type PanelChoice } from "./ui/ReservedRegions";
export { projectCornersToScreen, projectBox3ToScreen, rectIntervalsForBand, subtractIntervals, layoutObstacleColumn, LinePool, START_CURSOR, type ScreenRect, type Interval, type ColumnRegion, type PositionedLine, type ObstacleColumnOptions, type LinePoolOptions } from "./ui/ObstacleLayout";
export { Annotations, type AnnotationsConfig, type AnnotationItem } from "./ui/Annotations";

// ─── Text style engine ───
export type { ScreenRectNorm, TypeStyleLayer, InlineRun, TextStyle, StyleVariant, EaseName, VariantCondition, TextBlock, BlockBinding, PanelPlacement, FreePlacement, ColumnsPlacement, WorldPlacement, BlockPlacement, SiteFontFace, ResolveContext, CapabilitySet, ControlTier, Resolved } from "./text/TextModel";
export { PANEL_SLOTS, placementIsAuthorChosen, isScreenPresentation } from "./text/TextModel";
export { tokensToLayer, matchesCondition, flattenBasedOn, resolve } from "./text/StyleResolver";
export { FontRegistry, parseSfntTables, type FontFamilyMeta, type ParsedSfntTables } from "./text/FontRegistry";
export { applyLayer } from "./text/StyleToCss";
export { applyCapabilities, domLaneCaps, type BlockRenderer, type TextHost } from "./text/BlockRenderer";
export { FreeLane } from "./text/FreeLane";
export { PanelLane } from "./text/PanelLane";
export { ColumnsLane } from "./text/ColumnsLane";
export { SplatLane } from "./text/SplatLane";
export { PlaneLane } from "./text/PlaneLane";
export { TextSystem, type TextSystemOptions } from "./text/TextSystem";

// ─── Annotation rules (D31 live markers) ───
export { validateAnnotationRules, validateModeLocks, displayTemplatePrefix, KNOWN_MODES, DEFAULT_LIFETIME, type EffectLifetime, type LifetimeUntil, type AnnotationRule, type RuleTrigger, type RuleEffect, type ShowBlocksEffect, type SetFlagEffect, type PlayAudioEffect, type CameraSequenceEffect, type SequenceWaypoint, type SequenceTerminal, type EngageEffect, type AllowEffect, type DenyEffect, type ModeEffect, type CustomEffect, type DisplayTemplate, type RuleBlockRef, type RuleWhen, type RuleEngagementState, type SceneMode } from "./rules/RuleModel";
export { resolveRule, matchesWhen, NO_MATCH, type RuleContext, type WhenContext } from "./rules/RuleResolver";
export { SceneMemory, visitedFlag, VISITED_PREFIX, type SceneMemoryOptions } from "./rules/SceneMemory";
// DisplayChannel re-synced to fd67153 (Phase 2 ticket 01, 2026-08-23) —
// the D21-third-note vintage split is CLOSED and the four trimmed names
// are restored below; authored `lifetime` now runs for real.
export { showBlocks, shownBlockIds, endOnTravel, dismissAll, endStaleWhile, endOrphanedClaims, EMPTY_DISPLAY_CHANNEL, type DisplayChannelState, type DisplayClaim } from "./rules/DisplayChannel";
export { playAudio, stopAudio, EMPTY_AUDIO_CHANNEL, type AudioChannelState } from "./rules/AudioChannel";
export { resolveSequence, resolveWaypoint, DEFAULT_FRAME_RADIUS, MIN_FRAME_RADIUS, type FlightPlan, type ResolvedWaypoint, type SequencePose, type SequenceRefs } from "./rules/CameraChannel";
export { applyModeEffect, entryMode, initialOffered, offeredModes, type ModeState, type ModeTransition } from "./rules/ModeLocks";
export { channelsOf, KNOWN_CHANNELS, type EffectChannel } from "./rules/Channels";
export { HandlerRegistry, type CustomHandler, type CustomHandlerDetail } from "./rules/HandlerRegistry";
export { AudioPlayer, type AudioPlayerOptions } from "./render/AudioPlayer";

// ─── Site templates ───
export { normalizeSiteConfig, serializeSiteConfig, downloadSiteConfig, conjuredCopyBlock, conjuredCopyId, type SiteConfig, type SiteScene, type SiteProp, type SiteStop, type SiteCopy, type SiteMedia, type SiteAudio, type SiteSplatText, type SiteObstacleBox, type SiteAnnotation, type SiteSettings, type SiteScrollSettings, type SiteGradeSettings, type SiteTypographySettings, type SiteEditorialSettings, type SiteTextSettings, type SiteBlocksSettings } from "./site/SiteConfig";
export { AuthorPanel } from "./site/AuthorPanel";
export type { SiteAuthorPanelConfig, SiteChangeKind } from "./site/authorPanelTypes";
export { clusterLifted, type LiftedDetection, type SeederKnobs, type SeedWorldTransform } from "./site/HotspotSeeder";
export { interactionsToAnnotations, type InteractionsJson, type InteractionsObject, type ImportOptions, type ImportedAnnotations } from "./site/InteractionsImport";
export { AuthorGizmo, type AuthorGizmoConfig, type AuthorGizmoMode, type AuthorGizmoTarget } from "./site/AuthorGizmo";

// ─── Locative ───
export { geodeticToScene, sceneToGeodetic, bearingDistance, type GeoAnchor } from "./locative/GeoAnchor";
export { GeoContext, DEMO_PLACES, type PlaceInfo, type PlaceTier, type PlaceSource, type GeoContextConfig } from "./locative/GeoContext";

// ─── Embed: the <splat-site> element, the runtime it boots and the host-side
//     router ─── verbatim from the pin (ticket 09 ruling Stop 13); the
//     re-typed members of SiteRuntimeHandle / LoadedScene are doc 06 D28.
export { defineSplatSite } from "./embed/SplatSiteElement";
export type {
  SplatSiteElement,
  SplatSiteEventMap,
  SplatSiteReadyState,
  SplatSiteReadyDetail,
  SplatSiteStopDetail,
  SplatSiteHotspotDetail,
  SplatSiteSelectionDetail,
  SplatSiteEngagementDetail,
  SplatSiteMemoryDetail,
  SplatSiteLinkActivateDetail,
  SplatSiteRuleHandler,
  SplatSiteLoadStartDetail,
  SplatSiteLoadErrorDetail,
  SplatSiteLoadProgressDetail,
  SplatSiteBridgeCommand,
  SplatSiteBridgeMessage,
  SplatSiteBridgeState,
} from "./embed/SplatSiteElement";
export { createSiteRuntime, engagementSwitches, type EngagementState, type EngagementSwitches, type SiteRuntimeOptions, type SiteRuntimeHandle, type LoadedScene, type SiteReadyDetail, type SiteStopDetail, type SiteHotspotDetail, type SiteSelectionDetail, type SiteMemoryDetail, type SiteLinkActivateDetail } from "./embed/SiteRuntime";
// Host-side URL routing. `location` stays host-owned (spec §5.2), so the router
// is an exported helper that talks to the element through its typed command API
// and typed events — the embed itself never reads or writes global state.
export {
  parseFragment,
  formatFragment,
  connectSiteRouting,
  ROUTED_KINDS,
  type RouteTarget,
  type SiteRoutingOptions,
  type SiteRoutingHandle,
  type SiteRoutingResult,
} from "./embed/FragmentRouter";

// ─── Diagnostics (runtime surface only — dev tooling stays off the barrel,
//     matching the sparkjs doctrine) ───
// Load-telemetry runtime surface (spec §3): status/config types and the wiring
// entry only. Development tooling is deliberately NOT in this barrel — it
// ships behind the diagnostics/dev subpath.
export {
  wireLoadTelemetry,
  LOAD_TELEMETRY_MARKER,
  type SiteTelemetryOptions,
  type TelemetryCameraSample,
  type TelemetryWiringStatus,
  type TelemetrySceneStatus,
  type LoadTelemetryHandle,
  type WireLoadTelemetryInput,
  type RegisterPagedSceneInput,
} from "./embed/diagWiring";
export { LoadCoordinator, type SceneRegistration } from "./diag/LoadCoordinator";
export type { ConsentDecisions, LoadProbeAttachResult } from "./diag/LoadProbe";
export type { LoadRecordRevision } from "./diag/LoadRecord";
