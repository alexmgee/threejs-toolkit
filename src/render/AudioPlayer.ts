/**
 * AudioPlayer — the audio channel's one output device (D31 `play-audio`)
 *
 * ONE `HTMLAudioElement`, reused for every sound. That is not an optimisation:
 * it is how single-occupancy is enforced in the DOM rather than merely tracked
 * beside it. A second sound swaps this element's `src`, so "the previous sound
 * stops" is a property of the browser, not of bookkeeping that could drift from
 * `AudioChannel`'s state.
 *
 * Playback always begins inside a marker activation — a real user gesture — so
 * autoplay policy is satisfied by construction. The play promise is still
 * observed: a browser that refuses anyway (a muted-tab policy, an unsupported
 * codec) would otherwise surface as an unhandled rejection with no clue in it.
 *
 * This module owns no policy. What SHOULD be playing is `AudioChannel`'s pure
 * decision; this only makes it audible, and reports back when a sound lets the
 * channel go — because it finished, or because it failed and never will.
 */

export interface AudioPlayerOptions {
  /** The channel is free again: playback finished, OR it failed and never will.
   *  Carries the id that let go.
   *
   *  Both cases are one notification on purpose. The channel's only question is
   *  "is this sound still claiming me", and a sound that could not start answers
   *  it exactly as a sound that finished does. Splitting them would give the
   *  runtime two callbacks to wire identically — and forgetting either one is
   *  how a claim leaks and silences a marker for the rest of the visit. */
  onReleased?: (audioId: string) => void;
}

export class AudioPlayer {
  private element: HTMLAudioElement | null = null;
  private currentId: string | null = null;
  private currentUrl: string | null = null;
  private disposed = false;
  private readonly onReleased?: (audioId: string) => void;

  constructor(options: AudioPlayerOptions = {}) {
    this.onReleased = options.onReleased;
  }

  /**
   * Play a sound, displacing whatever was playing.
   *
   * Created on first use rather than at construction: a site with no audio
   * should not carry a media element it never feeds.
   */
  play(audioId: string, url: string, volume: number): void {
    if (this.disposed) return;
    const element = this.ensureElement();
    // Changing `src` implicitly reloads and rewinds; an unchanged src needs the
    // rewind stated, or replaying a finished sound would resume from its end and
    // play nothing at all.
    if (url !== this.currentUrl) {
      element.src = url;
      this.currentUrl = url;
    } else {
      element.currentTime = 0;
    }
    element.volume = Math.min(1, Math.max(0, volume));
    this.currentId = audioId;
    // Observed, never ignored: the rejection carries the real reason (codec,
    // policy, a 404 on the authored url) and is the only place it appears.
    void element.play().catch((error: unknown) => {
      // A play() interrupted by the NEXT sound's play() rejects with AbortError.
      // That is the channel working, not a failure — reporting it would cry wolf
      // every time a visitor activates two audio markers in a row.
      if (error instanceof DOMException && error.name === "AbortError") return;
      // The `error` listener may have reached this first (a 404 fires both); it
      // released and reported already, so say nothing twice.
      if (this.currentId !== audioId) return;
      console.warn(`[splat-site] could not play audio "${audioId}" (${url})`, error);
      // THE release. A sound that never starts never ends, so without this
      // nothing would ever free the channel: `playAudio`'s identity guard would
      // refuse this same id for the rest of the visit, silently, and the visitor
      // who blocked sound and then unblocked it could never get it back.
      this.release(audioId);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.currentId = null;
    this.currentUrl = null;
    if (this.element === null) return;
    this.element.pause();
    // Emptying the source releases the decoder and cancels an in-flight fetch —
    // a disposed runtime must not keep streaming a sound nobody can hear.
    this.element.removeAttribute("src");
    this.element.load();
    this.element = null;
  }

  private ensureElement(): HTMLAudioElement {
    if (this.element !== null) return this.element;
    const element = new Audio();
    element.preload = "auto";
    element.addEventListener("ended", () => {
      // The event can be STALE. Two sounds may share one url, and `play` takes
      // the rewind branch for an unchanged url — which seeks without running the
      // media element load algorithm, so an `ended` already queued by the
      // DISPLACED sound survives and would be reported as the sound now playing.
      // Assigning `src` would have purged it; a seek does not. The element
      // settles it: one that has been rewound and restarted is not ended.
      if (!element.ended) return;
      const ended = this.currentId;
      if (ended === null) return;
      this.release(ended);
    });
    // A resource that dies — a 404, an unsupported codec, a stream cut
    // mid-playback — fires `error` and never fires `ended`. Without this the
    // channel stays claimed by a sound that stopped being audible.
    element.addEventListener("error", () => {
      // Ask the element, for the same reason `ended` does: an event is evidence
      // that something happened, never proof of the state it implies. A resource
      // that is not actually in an error state must not release the claim.
      if (element.error === null) return;
      const failed = this.currentId;
      if (failed === null) return;
      console.warn(`[splat-site] audio "${failed}" stopped: media error`, element.error);
      this.release(failed);
    });
    this.element = element;
    return element;
  }

  /** Give the channel back. Guarded by id so a late event belonging to a sound
   *  that has already been displaced cannot free the one that displaced it. */
  private release(audioId: string): void {
    if (this.currentId !== audioId) return;
    this.currentId = null;
    this.onReleased?.(audioId);
  }
}
