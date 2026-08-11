#!/usr/bin/env node
import { run } from "../src/cli.mjs";

process.exitCode = run(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
