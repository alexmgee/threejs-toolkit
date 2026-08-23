# 04 — Fork patch 1: dispose() + capacity guard

**Status:** ready-for-agent
**Blocked by:** 03 — seam + monolithic path.

**What to build:** loading and unloading a scene repeatedly leaves no growing
memory, and an over-capacity asset is refused with a named toolkit error instead of
a silent allocation failure. This is the FIRST real fork delta, so it also proves
the D20 patches-authored-in-.ts mechanism end to end.

Standing rules bind (spec.md). Fork governance: every delta is a titled FORK.md
patch entry landing in the same change.

- [ ] H-LIFE at this scope: load→dispose→load ×10 on the ticket-03 fixture, JS heap
      returns to baseline each cycle, both backends; numbers in Comments, not
      adjectives.
- [ ] An asset exceeding the storage-buffer binding limit produces a named toolkit
      error and a still-usable page (no crash, no blank canvas), both backends.
- [ ] H-FORK: with the new features unused, rendered output is pixel-identical to
      the unmodified vendored addon on the fixture set.
- [ ] FORK.md gains a titled patch entry in the same change; the patch source is
      authored in .ts (D20) and type-checked by the gate.
