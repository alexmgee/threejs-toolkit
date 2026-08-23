# 10 — D22 second half: CameraSystem dead fields + construction literals (micro)

**Status:** ready-for-agent
**Blocked by:** None — can start immediately (frontier-parallel micro-work).

**What to build:** the open, unassigned second half of doc 06 D22 finally gets a
named home: CameraSystem's 2 dead fields and ~10 renderer-era construction
literals are resolved, with a camera fixture proving orbit/recenter behavior
unchanged. (The typing half was done in ticket 03 of Phase 1 — the
WebGLRenderer|WebGPURenderer widen.)

Standing rules bind (spec.md). Scope discipline: doc 01:92's counted edits only —
the picking dependency stays a Phase 3 rebuild.

- [ ] The 2 dead fields and the construction literals doc 01:92 counts are
      resolved; each edit listed in Comments against the count.
- [ ] A camera fixture proves orbit/recenter behavior unchanged on both backends
      (before/after captures at pinned poses).
- [ ] Gate green at fixpoint; doc 06 D22 updated to fully RULED/done with a
      pointer to this ticket.
