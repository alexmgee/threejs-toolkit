/**
 * AudioChannel — the audio channel, as a pure store (D31 play-audio effects)
 *
 * The counterpart to `DisplayChannel`, and deliberately its opposite in one
 * respect: the blocks channel is SUBDIVIDED (screen and world occupy
 * independently), while audio is single-occupancy. One sound plays; a second
 * play-audio effect takes the channel and the first one stops. There is no
 * mixing in v1 — "two things at once" is what the channel model exists to
 * prevent within one resource, and what it guarantees across resources.
 *
 * The state names a SOUND ID, not a URL: the id resolves against the site's
 * `audio` list, the same way the blocks channel names block ids. That is what
 * lets pre-flight reference-check a rule and what keeps the store free of
 * asset detail it has no business knowing.
 *
 * PURE module — no DOM, camera, or Spark imports, ever. Playing the actual sound
 * is the runtime's job; this module only decides what SHOULD be playing.
 *
 * Every transition RETURNS A NEW STATE, and returns the SAME state by identity
 * when nothing changed. The runtime leans on that: an identical state means "do
 * no work", which is what stops a repeat click restarting a sound mid-playback.
 */

export interface AudioChannelState {
  /** The sound currently claiming the channel, or null when nothing is playing.
   *  Cleared by the runtime when playback ends, which is what makes a sound
   *  replayable — the identity guard in `playAudio` would otherwise refuse the
   *  same id forever. */
  readonly playing: string | null;
}

/** Nothing playing. The state a visit starts in, and what a runtime resets to. */
export const EMPTY_AUDIO_CHANNEL: AudioChannelState = { playing: null };

/**
 * Claim the channel for a sound. Last-wins: whatever was playing is displaced.
 *
 * Re-claiming with the sound ALREADY playing returns the same state by
 * identity, so the runtime does nothing and playback continues undisturbed.
 * This mirrors `DisplayChannel`'s doctrine ("a repeat click must not restart a
 * fade") and is the reason the runtime must clear the channel when a sound
 * finishes: once it is no longer playing, the same id is a real change again.
 */
export function playAudio(state: AudioChannelState, audioId: string): AudioChannelState {
  if (state.playing === audioId) return state;
  return { playing: audioId };
}

/**
 * Give up the channel — playback ended, or something legitimately silenced it.
 *
 * A no-op by identity when nothing is playing, so the runtime's `ended` handler
 * can fire unconditionally without manufacturing state changes.
 */
export function stopAudio(state: AudioChannelState): AudioChannelState {
  if (state.playing === null) return state;
  return EMPTY_AUDIO_CHANNEL;
}
