#!/usr/bin/env node
/** Generate and drift-check Pathfinder's committed Wonder Wagon CLI module. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderCliIdentityModule } from "wonder-wagon-ui/cli";

const product = {
  name: "Pathfinder",
  serial: "PF-047",
  tagline: "trail markers for AI-assisted work",
  accent: "#E0611F",
  ansi16: {
    accent: { name: "yellow", bright: true },
    allowSeverityCollision: true,
  },
  mark: {
    width: 9,
    nameRow: 1,
    rows: [
      { expressive: [{ text: "   ━━━", role: "accent" }], plain: "   ===" },
      { expressive: [{ text: "  ━━━━━", role: "accent" }], plain: "  =====" },
      { expressive: [{ text: " ━━━━━━━", role: "accent" }], plain: " =======" },
      { expressive: [{ text: "━━━━━━━━━", role: "accent" }], plain: "=========" },
    ],
  },
};

const target = fileURLToPath(new URL("../../src/cli-identity.mjs", import.meta.url));
const next = renderCliIdentityModule(product, { language: "mjs" });

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // A missing generated file is ordinary drift and receives the same action.
  }
  if (current !== next) {
    console.error("src/cli-identity.mjs is stale; run `npm run wonder-wagon:sync`.");
    process.exitCode = 1;
  } else {
    console.log("src/cli-identity.mjs is current against wonder-wagon-ui/cli.");
  }
} else {
  writeFileSync(target, next);
  console.log("wrote src/cli-identity.mjs from wonder-wagon-ui/cli");
}
