/** Explicit routing provider invocation. No activation, persistence or routing policy.
 * The caller supplies only the approved projection, never local provenance.
 * Infrastructure checks are shared with Judge; its assessment contract is not.
 */
import * as jev from "./routing-providers/jev.mjs";
import { exactObject, validateRoutingAssessment } from "./routing-contract.mjs";
import { validateRoutingProjection } from "./routing-projection.mjs";
import { credentialIn, declaredTransportProblem, transportProblem } from "./judgment.mjs";
export const ROUTING_TIMEOUT_MS = 15000;
const failure = (kind) => ({ ok: false, failure: kind });
const kinds = ["configuration", "outbound", "timeout", "provider-error", "malformed"];
const freeze = (value) => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** The second argument is the narrow adapter seam, useful for transport doubles.
 * It cannot change the pinned protocol, declared transport, or expected bytes.
 * Callers remain responsible for explicit consent and current local provenance.
 */
export async function assessRouting({ projection, env = {}, fetch = globalThis.fetch, timeoutMs = ROUTING_TIMEOUT_MS } = {}, adapter = jev) {
  let timer;
  const controller = new AbortController();
  let closed = false;
  let used = false;
  let violation = false;
  try {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > ROUTING_TIMEOUT_MS || adapter?.model !== jev.model || adapter?.name !== jev.name || typeof adapter.assess !== "function") return failure("configuration");
    // Do not read ambient credentials or configuration. Only an explicit caller
    // can supply the two transport inputs. Neither one activates orchestration.
    const safeEnv = freeze({ TYPESAFE_API_KEY: env.TYPESAFE_API_KEY, TYPESAFE_BASE_URL: env.TYPESAFE_BASE_URL });
    const secrets = [safeEnv.TYPESAFE_API_KEY].filter((v) => typeof v === "string");
    const declared = freeze(jev.transport(safeEnv));
    if (declaredTransportProblem(declared, secrets)) return failure("configuration");
    // Clone before validation: never validate one read of caller-controlled
    // data and then serialize another. structuredClone refuses proxies and
    // functions; validation and transmission share only this inert snapshot.
    let view;
    try { view = freeze(structuredClone(projection)); } catch { return failure("outbound"); }
    if (!validateRoutingProjection(view, secrets).ok) return failure("outbound");
    const body = JSON.stringify(jev.buildRequest(view));
    if (credentialIn(body, secrets)) return failure("outbound");
    const guarded = (url, init = {}) => {
      // Invalid attempts consume the guard too; an adapter cannot recover by
      // hiding its first violation or sending again after timeout/completion.
      if (closed || used || controller.signal.aborted) { violation = true; throw Object.assign(new Error("Transport refused."), { kind: "outbound" }); }
      used = true;
      if (transportProblem(url, init, declared) || init.body !== body || init.signal !== controller.signal) { violation = true; throw Object.assign(new Error("Transport refused."), { kind: "outbound" }); }
      return fetch(declared.url, { method: "POST", headers: { ...declared.headers }, body, redirect: "error", signal: controller.signal });
    };
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => { closed = true; controller.abort(); resolve(failure("timeout")); }, timeoutMs);
    });
    const work = (async () => {
      try {
        const result = await adapter.assess(view, { env: safeEnv, fetch: guarded, signal: controller.signal });
        if (violation || !used) return failure("outbound");
        if (!exactObject(result, ["model", "assessment"]) || result.model !== jev.model || !validateRoutingAssessment(result.assessment, view.evidence.map(({ id }) => id)).ok) return failure("malformed");
        return { ok: true, model: jev.model, assessment: JSON.parse(JSON.stringify(result.assessment)) };
      } catch (error) { return failure(violation ? "outbound" : kinds.includes(error?.kind) ? error.kind : "provider-error"); }
    })();
    return await Promise.race([work, timeout]);
  } catch (error) { return failure(kinds.includes(error?.kind) ? error.kind : "configuration"); }
  finally { closed = true; controller.abort(); clearTimeout(timer); }
}
