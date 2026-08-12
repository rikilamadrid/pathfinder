#!/usr/bin/env node
import { run } from "../src/cli.mjs";

// Everything the CLI learns about the outside world arrives through this call.
// `run` reads no globals of its own, so a test can hand it a synthesized
// environment — a Windows PATH, an absent $HOME, a terminal that is not one —
// without touching the process it runs in.
process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  env: process.env,
  platform: process.platform,
  stdoutIsTTY: Boolean(process.stdout.isTTY),
});
