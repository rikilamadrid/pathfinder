#!/usr/bin/env node
import { run } from "../src/cli.mjs";
import { createPrompter } from "../src/prompt.mjs";
import { createTheme } from "../src/theme.mjs";

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

// One theme for the whole run, built here because this is the only file allowed
// to read the process, and threaded into both consumers rather than built twice.
// Two themes over the same terminal would be two opinions about it, and they
// would differ in exactly the value that decides how a question is asked: `run`
// is handed no stdin, so a theme it built for itself would answer no to
// `selection` while the prompter's answered yes.
//
// Note what the capability is told about stdin and what it is not. Whether
// `setRawMode` exists is asked of the stream; it is never called, here or
// anywhere in this package — readline owns raw mode for the whole run.
const theme = createTheme({
  env: process.env,
  platform: process.platform,
  isTTY: Boolean(process.stdout.isTTY),
  inputIsTTY: Boolean(process.stdin.isTTY),
  setRawMode: typeof process.stdin.setRawMode === "function",
  columns: process.stdout.columns,
});

const prompter = createPrompter({
  input: process.stdin,
  output: process.stdout,
  interactive,
  theme,
});

try {
  process.exitCode = await run(process.argv.slice(2), {
    cwd: process.cwd(),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    env: process.env,
    platform: process.platform,
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    theme,
    prompter,
  });
} finally {
  // An open reader holds stdin open, and a process with an open stdin does not
  // exit. Closed on every path, including the ones that refused.
  prompter.close();
}
