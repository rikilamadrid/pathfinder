/**
 * Evidence Judge providers, found by file name exactly as routing policies are.
 *
 * A provider is `<name>.mjs` in this directory exporting `name` (equal to the
 * file name), a pinned `model`, `environment` (the variable names it may read)
 * and `secrets` (those of them that must never leave in evidence or messages),
 * and `assess(bundle, { env, fetch, signal })`, which resolves to
 * `{ model, assessment }` in `../judgment.mjs`'s contract or throws. A provider
 * is handed only the variables it declared, only the outbound view of the
 * bundle (`ticket`, `criteria`, `evidence`), and must send only through the
 * `fetch` it is given. A provider that sends anything exports
 * `transport(env)`, the exact `{ url, headers }` it uses; the fetch it is
 * given refuses any request whose URL, method, redirect mode, headers or body
 * differ from that declaration and the outbound contract, and sends the
 * validated values itself.
 *
 * Nothing outside this directory names a provider: the project's
 * `<!-- pathfinder:evidence-judge <name> -->` marker selects one, and adding a
 * provider is adding one file. The registry checks only that the module has
 * the shape; `judgment.mjs` treats everything it returns as untrusted.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = /^[a-z][a-z0-9-]*$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV = /^[A-Z][A-Z0-9_]*$/;

const isProviderFile = (file) => file.endsWith(".mjs") && file !== "registry.mjs" && !file.startsWith("_") && !file.endsWith(".test.mjs");

/** Every provider this engine ships, by name, sorted. */
export function shippedJudges() {
  return readdirSync(HERE).filter(isProviderFile).map((file) => file.slice(0, -".mjs".length)).filter((name) => NAME.test(name)).sort();
}

/**
 * @returns {Promise<{ok: true, judge: {name: string, model: string, assess: Function}} | {ok: false, message: string}>}
 */
export async function loadJudge(name) {
  const shipped = shippedJudges();
  if (!shipped.includes(name)) {
    return { ok: false, message: `evidence judge \`${name}\` is not shipped with this engine. Shipped: ${shipped.join(", ") || "none"}` };
  }
  const module = await import(pathToFileURL(join(HERE, `${name}.mjs`)).href);
  const names = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string" && ENV.test(entry));
  if (module.name !== name || typeof module.model !== "string" || !MODEL.test(module.model) || typeof module.assess !== "function"
    || !names(module.environment) || !names(module.secrets) || !module.secrets.every((entry) => module.environment.includes(entry))
    || (module.transport !== undefined && typeof module.transport !== "function")) {
    return { ok: false, message: `evidence judge \`${name}\` must export its own name, a pinned model, environment, secrets, assess(), and transport() if it sends anything` };
  }
  return { ok: true, judge: Object.freeze({ name, model: module.model, environment: Object.freeze([...module.environment]), secrets: Object.freeze([...module.secrets]), assess: module.assess, ...(module.transport ? { transport: module.transport } : {}) }) };
}
