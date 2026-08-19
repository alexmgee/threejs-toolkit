# Re-verify the Phase 1 cluster cut against sparkjs-toolkit's real import graph.
# Run: python graph-check.py   (reads sparkjs-toolkit READ-ONLY)
# Exit 0 = every ticket compiles given only its predecessors; exit 1 = violations.
# If the cut changes, edit the assign() calls to match the tickets.
import os, re, sys

SRC = "D:/Projects/sparkjs-toolkit/src"
FROM_RE = re.compile(r"(?ms)^\s*(import|export)\s+(type\s+)?[^;]*?from\s*['\"]([^'\"]+)['\"]")
BARE_RE = re.compile(r"(?m)^\s*import\s*['\"]([^'\"]+)['\"]")
DYN_RE = re.compile(r"import\(\s*['\"]([^'\"]+)['\"]\s*\)")
ASSET_EXT = (".css", ".svg", ".png", ".glsl", ".wgsl", ".json", ".jpg", ".woff", ".woff2")

files = {}
for root, dirs, fs in os.walk(SRC):
    dirs[:] = [d for d in dirs if d != "node_modules"]
    for f in fs:
        if f.endswith((".ts", ".tsx")):
            rel = os.path.relpath(os.path.join(root, f), SRC).replace("\\", "/")
            files[rel] = open(os.path.join(root, f), encoding="utf8", errors="replace").read()

def resolve(fromfile, spec):
    base = os.path.normpath(os.path.join(os.path.dirname(os.path.join(SRC, fromfile)), spec))
    if spec.endswith(".js"):
        cands = [base[:-3] + ".ts", base[:-3] + ".tsx"]
    elif spec.endswith((".ts", ".tsx")):
        cands = [base]
    else:
        cands = [base + ".ts", base + ".tsx", os.path.join(base, "index.ts")]
    for c in cands:
        r = os.path.relpath(c, SRC).replace("\\", "/")
        if r in files:
            return r
    return None

graph = {}
for rel, txt in files.items():
    edges = set()
    specs = [m.group(3) for m in FROM_RE.finditer(txt)]
    specs += [m.group(1) for m in BARE_RE.finditer(txt)]
    specs += [m.group(1) for m in DYN_RE.finditer(txt)]
    for spec in specs:
        if spec.startswith(".") and not spec.endswith(ASSET_EXT):
            r = resolve(rel, spec)
            if r:
                edges.add(r)
    graph[rel] = sorted(edges)

A = {}
def assign(t, *paths):
    for p in paths:
        A[p] = t

assign("T04", *[f for f in graph if f.startswith(("cells/", "rules/", "locative/"))],
       "site/AnnotationMeta.ts", "text/TextModel.ts", "text/FontRegistry.ts",
       "core/LoadingUI.ts", "render/AudioPlayer.ts", "core/CameraSystem.ts",
       "core/CameraPath.ts", "core/CameraRail.ts", "core/ScrollRail.ts",
       "site/SiteConfig.ts", "site/HotspotSeeder.ts", "site/InteractionsImport.ts")
assign("T05", "text/BlockRenderer.ts", "text/PlaneLane.ts", "text/SplatLane.ts",
       "text/TextSystem.ts", "text/ColumnsLane.ts", "text/FreeLane.ts",
       "text/PanelLane.ts", "text/StyleResolver.ts", "text/StyleToCss.ts",
       "ui/ObstacleLayout.ts", "ui/TextLayout.ts", "ui/billboard.ts",
       "ui/Annotations.ts", "ui/CaptionOverlay.ts", "ui/EditorialRegionEditor.ts",
       "ui/ReservedRegions.ts", "ui/Typography.ts")
assign("T06", *[f for f in graph if f.startswith("site/authorui/")],
       "site/AuthorPanel.ts", "site/AuthorGizmo.ts", "site/authorPanelTypes.ts")
assign("T07", *[f for f in graph if f.startswith("diag/")])
assign("T08", "core/EnvironmentLoader.ts", "core/ColmapData.ts",
       "core/FrustumRenderer.ts", "core/Controls.ts", "render/PropLayer.ts")
assign("T09", "render/MediaLayer.ts")
assign("T10", "render/SceneGrade.ts")
assign("T11", "index.ts")
assign("P2", "embed/SiteRuntime.ts", "embed/diagWiring.ts", "embed/diagWiring.stub.ts",
       "embed/SplatSiteElement.ts", "embed/FragmentRouter.ts", "embed/register.ts",
       "core/StatsHUD.ts", "core/SplatBounds.ts", "core/SplatLoader.ts")
assign("P3", "core/CropTool.ts", "core/SceneComposer.ts",
       "interact/SplatHighlight.ts", "core/DebugPanel.ts")
assign("P4", "core/SplatExporter.ts", "ui/SplatTextMesh.ts")
assign("T03-provides", "core/SparkScene.ts")

ORDER = {"T04": 4, "T05": 5, "T06": 6, "T07": 7, "T08": 8, "T09": 9, "T10": 10, "T11": 11}
HANDLED = {("text/SplatLane.ts", "ui/SplatTextMesh.ts")}  # D19 typed stub lands in T05

bad = [f for f in graph if f not in A]
violations = []
for f, es in sorted(graph.items()):
    t = A.get(f)
    if t not in ORDER:
        continue
    for e in es:
        te = A.get(e)
        if te == "T03-provides" or (f, e) in HANDLED:
            continue
        if f == "index.ts" and te in ("P2", "P3", "P4"):
            continue  # trimmed barrel: deferred names documented in ticket 11
        if te in ("P2", "P3", "P4") or (te in ORDER and ORDER[te] > ORDER[t]):
            violations.append((f, t, e, te))

if bad:
    print("UNASSIGNED:", bad)
for v in violations:
    print("VIOLATION:", v)
print("files:", len(graph), "| violations:", len(violations), "| unassigned:", len(bad))
sys.exit(1 if (violations or bad) else 0)
