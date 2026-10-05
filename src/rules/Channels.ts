/**
 * Channels — which resource each effect kind occupies (D31)
 *
 * A channel is the resource an effect holds while it runs: camera, blocks,
 * audio, or memory/modes. Different channels run concurrently; a new effect on
 * an occupied channel takes it over (last legitimate claimant wins). Per-moment
 * exceptions are authored as conditions, never as scheduler settings — there is
 * no scheduler here to settle, and that is the point.
 *
 * Until this module the occupancy was implicit: `DisplayChannel` was a store,
 * and "audio does not disturb a panel" was a property of how the runtime
 * happened to be written rather than something the system could be asked. The
 * declaration below is what makes concurrency assertable at seam 1, and what
 * gives a future rule-fire debugger (v2 ledger item 4) something to read.
 *
 * PURE module — no DOM, camera, or Spark imports, ever.
 */

import { EFFECT_KINDS, type RuleEffect } from "./RuleModel";

/** The channel vocabulary (GLOSSARY.md, Channel). The single source for both the
 *  type and any membership check, so a declaration can never name a resource
 *  the system does not have. */
export const KNOWN_CHANNELS = ["camera", "blocks", "audio", "memory"] as const;

export type EffectChannel = (typeof KNOWN_CHANNELS)[number];

/**
 * Which channels this effect occupies.
 *
 * Reads the effect-kind registry rather than keeping a second switch beside it.
 * That registry is typed as a total record over the effect union, so adding a
 * kind without declaring its channels is a COMPILE error there — which is
 * strictly better than the switch this used to be: a switch catches a missing
 * case only while every branch returns, and says nothing about the three other
 * places that also had to learn the new kind.
 *
 * The blocks channel has no subdivision to express. It used to be split into a
 * screen half and a world half, each holding one thing; ticket 17 replaced that
 * with occupancy keyed by OWNER, and whether one marker's content removes
 * another's is the author's `takeover` setting rather than a property of the
 * channel. This function answers "which resource" — and for blocks that is the
 * whole answer now.
 */
export function channelsOf(effect: RuleEffect): readonly EffectChannel[] {
  return EFFECT_KINDS[effect.kind].channels;
}
