/**
 * Self-registering bundle entry — the file the embed bundle is built FROM.
 *
 * Importing the toolkit barrel stays inert (consumers call defineSplatSite()
 * when they choose, and SSR never evaluates HTMLElement); loading the BUILT
 * bundle registers <splat-site> immediately, so embedding is one script tag
 * plus one element:
 *
 *   <script type="module" src="splat-site.js"></script>
 *   <splat-site src="site.json" font-base="/assets/fonts/"></splat-site>
 *
 * Load the bundle ONCE per page: module scripts with the same URL evaluate
 * once, but distinct URLs (e.g. per-widget copies with cache busters) re-parse
 * megabytes for nothing — registration itself safely no-ops on repeats.
 */

import { defineSplatSite } from "./SplatSiteElement";

defineSplatSite();

export { defineSplatSite };
