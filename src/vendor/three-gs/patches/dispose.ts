/**
 * Fork patch: dispose GaussianSplatMesh GPU storage.
 *
 * Reaches private internals of a PINNED three version; FORK.md's [dispose]
 * entry inventories every field; the re-diff procedure re-verifies them.
 * Do not soften the assertions.
 *
 * TWO-PHASE by contract (adversarial-review blocker, 2026-08-29): phase 1
 * validates and COLLECTS every surface — throwing before anything has been
 * freed, so a reshaped three can never leave a half-disposed mesh; phase 2
 * frees. Nothing in phase 2 throws on the inventoried shapes.
 */

export class ForkPatchError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = "ForkPatchError";
    this.reason = reason;
  }
}

interface StorageNode {
  value: object;
}

interface ComputeDisposable {
  dispose(): void;
}

function forkInternalsMissing(what: string): never {
  throw new ForkPatchError(
    "fork-internals-missing",
    `${what} not found — vendored three internals changed; re-verify the [dispose] patch (FORK.md)`,
  );
}

function requireStorageAttribute(node: unknown, label: string): object {
  if (node === null || typeof node !== "object") {
    forkInternalsMissing(label);
  }
  const value = (node as StorageNode).value;
  if (value === null || typeof value !== "object") {
    forkInternalsMissing(`${label}.value`);
  }
  return value;
}

/** REQUIRED disposable (compute node, texture, geometry, material): absence
 *  or a missing dispose() is a reshape — optional-chaining here would
 *  silently skip freeing (loud-coupling rule). One shape definition so a
 *  re-diff fix lands once, not in four hand-rolled copies (review). */
function requireDisposable(node: unknown, label: string): ComputeDisposable {
  if (
    node === null ||
    typeof node !== "object" ||
    typeof (node as ComputeDisposable).dispose !== "function"
  ) {
    forkInternalsMissing(label);
  }
  return node as ComputeDisposable;
}

export function disposeGaussianSplatMesh(mesh: unknown, renderer: unknown): void {
  // ── Phase 1: validate + collect (no mutations) ──
  if (renderer === null || typeof renderer !== "object") {
    forkInternalsMissing("renderer");
  }
  // renderer._attributes is EXACTLY null until renderer.init() runs
  // (Renderer.js:319 vs :812) — a pre-init dispose is a legitimate
  // lifecycle state with nothing uploaded, NOT a reshape (review finding:
  // the first cut misdiagnosed it as fork-internals-missing). undefined or
  // any other shape IS a reshape.
  const attributesMap = (renderer as Record<string, unknown>)._attributes;
  let attributesDelete: { delete(a: object): unknown } | null = null;
  if (attributesMap !== null) {
    if (
      typeof attributesMap !== "object" ||
      typeof (attributesMap as { delete?: unknown }).delete !== "function"
    ) {
      forkInternalsMissing("renderer._attributes.delete");
    }
    attributesDelete = attributesMap as { delete(a: object): unknown };
  }

  if (mesh === null || typeof mesh !== "object") {
    forkInternalsMissing("mesh");
  }
  const meshRecord = mesh as Record<string, unknown>;
  const buffers = meshRecord._buffers;
  const sort = meshRecord._sort;
  if (buffers === null || typeof buffers !== "object") {
    forkInternalsMissing("mesh._buffers");
  }
  if (sort === null || typeof sort !== "object") {
    forkInternalsMissing("mesh._sort");
  }
  const bufferRecord = buffers as Record<string, unknown>;
  const sortRecord = sort as Record<string, unknown>;

  const storageAttributes: object[] = [
    requireStorageAttribute(bufferRecord.centerRead, "mesh._buffers.centerRead"),
    requireStorageAttribute(bufferRecord.covarianceARead, "mesh._buffers.covarianceARead"),
    requireStorageAttribute(bufferRecord.covarianceBRead, "mesh._buffers.covarianceBRead"),
    requireStorageAttribute(bufferRecord.colorRead, "mesh._buffers.colorRead"),
  ];

  const degree = bufferRecord.sphericalHarmonicsDegree;
  if (typeof degree !== "number") {
    forkInternalsMissing("mesh._buffers.sphericalHarmonicsDegree");
  }
  for (let d = 1; d <= degree; d++) {
    const key = `sphericalHarmonics${d}Attribute`;
    const attribute = bufferRecord[key];
    if (attribute === null || typeof attribute !== "object") {
      forkInternalsMissing(`mesh._buffers.${key}`);
    }
    storageAttributes.push(attribute as object);
  }

  // Lazy — absent is a legitimate state (created on first WebGPU SH pass).
  if (bufferRecord.sphericalHarmonicsContributionRead !== undefined) {
    storageAttributes.push(
      requireStorageAttribute(
        bufferRecord.sphericalHarmonicsContributionRead,
        "mesh._buffers.sphericalHarmonicsContributionRead",
      ),
    );
  }

  const orderAttribute = sortRecord.orderAttribute;
  if (orderAttribute === null || typeof orderAttribute !== "object") {
    forkInternalsMissing("mesh._sort.orderAttribute");
  }
  storageAttributes.push(
    orderAttribute as object,
    requireStorageAttribute(sortRecord.binRead, "mesh._sort.binRead"),
    requireStorageAttribute(sortRecord.histogramAtomic, "mesh._sort.histogramAtomic"),
    requireStorageAttribute(sortRecord.offsetAtomic, "mesh._sort.offsetAtomic"),
  );

  // WebGL2 fallback: the GLSL node builder backs each PBO-read storage
  // attribute with a DataTexture stashed at attribute.pbo
  // (GLSLNodeBuilder.js:396-404) — deleting the buffer alone leaks it
  // (caught live by the H-LIFE union gate: +7 textures per cycle). A pbo
  // slot that exists but has no dispose() is a reshape, not a skip.
  const pboTextures: ComputeDisposable[] = [];
  for (const attribute of storageAttributes) {
    const pbo = (attribute as { pbo?: unknown }).pbo;
    if (pbo === undefined) continue;
    pboTextures.push(requireDisposable(pbo, "storage attribute .pbo.dispose"));
  }

  // Sort compute nodes are constructed unconditionally (setBinNode runs in
  // the mesh constructor) — REQUIRED. The SH compute node is null for
  // degree 0 — null allowed, anything else must be disposable.
  const computeNodes: ComputeDisposable[] = [
    requireDisposable(sortRecord._resetNode, "mesh._sort._resetNode"),
    requireDisposable(sortRecord._histogramNode, "mesh._sort._histogramNode"),
    requireDisposable(sortRecord._prefixNode, "mesh._sort._prefixNode"),
    requireDisposable(sortRecord._scatterNode, "mesh._sort._scatterNode"),
  ];
  const shComputeNode = meshRecord._sphericalHarmonicsComputeNode;
  if (shComputeNode !== null) {
    computeNodes.push(
      requireDisposable(shComputeNode, "mesh._sphericalHarmonicsComputeNode"),
    );
  }

  // WebGL2 fallback: every StorageBufferAttribute gets a DualAttributeData
  // holding TWO GL buffers (WebGLAttributeUtils.js:16-41, created
  // unconditionally at :175-179 for transform-feedback use) — but
  // destroyAttribute deletes only the ACTIVE one (:249), so the twin leaks
  // per dispose, invisibly to info.memory (the counter decrements either
  // way; review finding). Collect the inactive twins in phase 1, free them
  // in phase 2. WebGPU data has no `buffers` array — skipped by shape.
  const dualBufferFrees: Array<() => void> = [];
  {
    const backendRecord = (renderer as { backend?: unknown }).backend as
      | Record<string, unknown>
      | undefined;
    const backendGet = backendRecord?.get;
    const gl = backendRecord?.gl as { deleteBuffer?: (b: unknown) => void } | undefined;
    if (
      typeof backendGet === "function" &&
      gl !== undefined &&
      typeof gl.deleteBuffer === "function"
    ) {
      for (const attribute of storageAttributes) {
        const data = (backendGet as (a: object) => unknown).call(
          backendRecord,
          attribute,
        ) as { buffers?: unknown[]; bufferGPU?: unknown } | undefined;
        if (data === undefined || !Array.isArray(data.buffers)) continue;
        const active = data.bufferGPU;
        for (const buffer of data.buffers) {
          if (buffer !== active && buffer !== undefined && buffer !== null) {
            dualBufferFrees.push(() => gl.deleteBuffer!(buffer));
          }
        }
      }
    }
  }

  const geometry = requireDisposable(meshRecord.geometry, "mesh.geometry.dispose");
  const material = requireDisposable(meshRecord.material, "mesh.material.dispose");

  // ── Phase 2: free (validated shapes only — nothing here throws) ──
  for (const node of computeNodes) node.dispose();
  for (const pbo of pboTextures) pbo.dispose();
  for (const free of dualBufferFrees) free();
  if (attributesDelete !== null) {
    for (const attribute of storageAttributes) attributesDelete.delete(attribute);
  }
  geometry.dispose();
  material.dispose();
}
