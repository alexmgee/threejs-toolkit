// threejs-toolkit — API-parity barrel, honest Phase 1 (TRIMMED) form.
// Mirrors sparkjs-toolkit src/index.ts at pin fd67153: every landed module
// exports under the SAME name; the deferred sources are listed below so the
// trim is visible, not silent. Each later phase restores its names.
//
// ─── DEFERRED SOURCES (13 — the graph makes a full same-names barrel
//     impossible until Phase 4; doc 04 / ticket 11) ───
// Phase 2: embed/SiteRuntime (createSiteRuntime, engagementSwitches, …)
//          embed/diagWiring (wireLoadTelemetry, LOAD_TELEMETRY_MARKER, …)
//          embed/SplatSiteElement (defineSplatSite + event/bridge types)
//          embed/FragmentRouter (parseFragment, connectSiteRouting, …)
//          core/StatsHUD (StatsHUD)
//          core/SplatBounds (computeSplatBounds)
//          core/SplatLoader (loadSplat, loadSplatAsync)
// Phase 3: core/CropTool (CropTool, evaluateSdf)
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
// DisplayChannel is deliberately at ticket 04's vintage (D21 third note) —
// its landed surface is exported; the pin's endOnTravel / dismissAll /
// endStaleWhile / endOrphanedClaims return with Phase 2's DisplayChannel
// re-sync (which the note orders FIRST, closing the lifetime split).
export { showBlocks, shownBlockIds, EMPTY_DISPLAY_CHANNEL, type DisplayChannelState, type DisplayClaim } from "./rules/DisplayChannel";
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

// ─── Diagnostics (runtime surface only — dev tooling stays off the barrel,
//     matching the sparkjs doctrine) ───
export { LoadCoordinator, type SceneRegistration } from "./diag/LoadCoordinator";
export type { ConsentDecisions, LoadProbeAttachResult } from "./diag/LoadProbe";
export type { LoadRecordRevision } from "./diag/LoadRecord";
