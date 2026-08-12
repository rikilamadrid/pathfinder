#!/usr/bin/env node
import { run } from "../src/cli.mjs";
import { createPrompter } from "../src/prompt.mjs";

// Everything the CLI learns about the outside world arrives through this call.
// `run` reads no globals of its own, so a test can hand it a synthesized
// environment — a Windows PATH, an absent $HOME, a terminal that is not one —
// without touching the process it runs in.
//
// The TTY guard is decided here, once, and both ends must be terminals: a
// question needs somewhere to be printed *and* someone able to answer it.
// `create-pathfinder < /dev/null` in a terminal is not interactive, and neither
// is a run whose stdout is a pipe.
const interactive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

const prompter = createPrompter({
  input: process.stdin,
  output: process.stdout,
  interactive,
});

try {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    env: process.env,
    platform: process.platform,
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    prompter,
  });
} finally {
  // An open reader holds stdin open, and a process with an open stdin does not
  // exit. Closed on every path, including the ones that refused.
  prompter.close();
}
