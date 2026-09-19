/**
 * The redactor speaks the kit's grammar, not a dialect of it.
 *
 * `sources.mjs` re-exports the four grammar members from
 * `lib/evidence-references.mjs` and adds resolution against a collected
 * evidence bundle. This runs the shared conformance fixture through the
 * redactor's own entry point, so the re-export is proven transparent rather
 * than assumed — a wrapper that normalized, filtered or extended a reference on
 * its way through would fail here, by the reference it changed.
 *
 * The fixture and the runner are the primitive's, deliberately. A copy kept
 * here would agree with that one only until the day it did not.
 */

import { runConformance } from '../../evidence-references/conformance.mjs';

import * as sources from '../../../skills/blog-post-redactor/engine/sources.mjs';

runConformance(sources, 'skills/blog-post-redactor/engine/sources.mjs');
