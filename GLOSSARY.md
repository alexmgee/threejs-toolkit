# threejs-toolkit

The sibling of sparkjs-toolkit, rebuilt on three.js native splat rendering. One
context: the splat-site runtime and its paged streaming backend. Written at the
Phase 2 boundary (2026-10-05); every term below earned its entry by causing a
real confusion during Phase 2's tickets.

## Language

### The paged asset

**Chunk**:
A unit of the asset's data as stored in the `.rad` file — a fixed, indexed set
decided when the asset was built (the hero has 122; chunk 0 is the tree root).
_Avoid_: block, segment, tile

**Page**:
A fixed-size cell of GPU residency, sized to hold exactly one decoded chunk.
The budget counts pages; chunks compete for them when the budget is smaller
than the chunk count.
_Avoid_: using "page" for the data itself — a page is the container, a chunk
is the contents

**Slot**:
A page's position number in the pool — which cell, not whether. Which chunk
lands in which slot follows decode-completion order and carries no meaning.
_Avoid_: treating slot order as significant

**Resident**:
The state of a chunk that currently occupies a page (and therefore renders).
_Avoid_: loaded, in-memory — both blur resident with cached

### The four moments of "visible"

These are genuinely different instants; Phase 2 measured them diverging.
**Reveal is the canonical term** for "the visitor now sees the scene."

**Reveal**:
The moment the loader lifts the loading cover and the scene becomes the
visitor's view. The product's own definition of visible.
_Avoid_: ready, shown, visible (as a moment)

**Ready**:
The backend's internal signal: the first paint after the first page upload.
It can fire with nothing actually drawn (finding F1), so it is never the word
for what a visitor experiences.
_Avoid_: using ready to mean reveal

**First-splat mark**:
The telemetry record's timestamp for a scene's first visible splats, taken at
reveal.
_Avoid_: first paint

**First-pixel**:
A measurement convention from the Phase 0 spike: the first frame whose
traversal selects at least one splat. Used only when comparing against the
spike's baselines.
_Avoid_: using first-pixel outside measurement contexts

### The chunk lifecycle

The camera wants chunks; wanted chunks get admitted; admitted chunks become
resident in pages; crowded-out ones are deferred or evicted, their bytes
cached; hopeless ones are refused.

**Wanted**:
The set of chunks the current view is asking for, produced by the traversal
each frame.
_Avoid_: requested, needed

**Admission**:
The act of accepting a chunk for decode-and-upload into a page. A chunk the
traversal would currently accept is admissible.
_Avoid_: loading (too broad)

**Cached**:
The state of a chunk whose raw bytes are held in memory awaiting a later
admission — not resident, not lost; re-admission costs a decode but no
network.
_Avoid_: buffered, downloaded

**Deferred**:
The state of a chunk that arrived but is currently held back from admission;
it will be reconsidered. Warning: the diagnostics field named `deferred` is a
historical log that only grows — a chunk stays on it after later admission —
so the field is not this state (the mismatch behind ticket 12's false-stable
bug).
_Avoid_: reading the `deferred` field as a live state

**Evicted**:
A resident chunk pushed out of its page to make room; its bytes may remain
cached.
_Avoid_: dropped, unloaded

**Refused**:
A chunk (or scene) the backend rejected permanently, with a named reason;
never retried. Refusals are answers, not errors.
_Avoid_: failed, errored

### The settling words

There is no catch-all for "loading is finished" — the speaker must pick the
word for which finishing they mean. The gap between them is real (on the
hero: first paint ~1.6 s, full quality ~17 s).

**Settled**:
The pager's finish: every chunk fetched or given up, every admitted decode
done. Says nothing about what is on screen.
_Avoid_: done, loaded, finished (bare)

**Full quality**:
The view's finish: the render shows everything the current view wants at
target detail. Can arrive before or after settled.
_Avoid_: complete, fully loaded

**Steady**:
A measurement convention (like first-pixel): settled, nothing being admitted,
held for N renders. Belongs to harnesses, never to product behavior.
_Avoid_: stable (the product's convergence sense)

**Converged / abandoned**:
The telemetry record's verdict on whether it proved convergence before the
scene went away. "Abandoned" describes the record (usually: the trial ended
too soon), never the scene.
_Avoid_: reading abandoned as a product failure

### Budget

**Budget**:
The chosen number of pages — derived from device limits and the asset, or
overridden in tests. The decision.
_Avoid_: limit, quota

**Capacity**:
What the budget buys: budget × page size, in splats. The consequence.
_Avoid_: using capacity and budget interchangeably

**Capped site**:
A site whose budget is smaller than its asset's chunk count, so chunks
compete for pages. A real-device regime (a 4,096-texture WebGL2 device caps
the hero at 85 of 122 pages), not a test artifact.
_Avoid_: constrained (the harness's ?pages=32 regime specifically)
