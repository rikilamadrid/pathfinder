#!/usr/bin/env node
/**
 * `ledger` — the improvement ledger's four operations, as commands.
 *
 *   node bin/ledger.mjs record   --observed <date> --source <v> --scope <v>
 *                                --category <v> --intervention <v> --impact <v>
 *                                --evidence <ref>... --title <line> --note <text>
 *                                [--candidate <line>] [--repeats <id>] [--json]
 *   node bin/ledger.mjs resolve  <id> <status> [--in <ref>...] [--why <line>]
 *                                [--on <date>] [--json]
 *   node bin/ledger.mjs harvest  [--json]
 *   node bin/ledger.mjs validate [--json]
 *
 * Every command takes `--root <dir>`, the project whose ledger is meant; it
 * defaults to the working directory. The ledger is always
 * `context/improvement-ledger.md` beneath that root, and it is the only path
 * this program ever writes. There is no flag to point it somewhere else,
 * because a write surface with an override is not a write surface.
 *
 * Exit codes are the contract, the same three `orchestrate` uses:
 *
 *   0  the command did what it says
 *   1  a refusal, stated on stderr — an unknown value, an illegal transition,
 *      a missing reference — or a `validate` that found problems
 *   2  the command line was wrong
 *
 * What this program does not do is as much the point as what it does. It reads
 * no clock: every date in the ledger was given to it by a person, which is why
 * `harvest` produces the same bytes today and next year. It reads no Git, no
 * ticket store and no network, so nothing it writes can be an inference about
 * work it went and looked up. It holds no state between runs. And no command
 * moves a status except `resolve`, under an explicit instruction naming the
 * entry and the status. The ledger's authority is zero, deliberately, and every
 * one of these refusals is what keeps it there.
 *
 * Node 18 or newer. No dependencies. The evidence grammar comes from
 * `lib/evidence-references.mjs`, the kit's one statement of it.
 */

import { harvest } from '../harvest.mjs';
import { record } from '../record.mjs';
import { resolve as resolveEntry } from '../resolve.mjs';
import { validate } from '../validate.mjs';

const USAGE = `improvement ledger

  record   --observed <YYYY-MM-DD> --source <v> --scope <v> --category <v>
           --intervention <v> --impact <v> --title <line> --note <text>
           --evidence <type:locator> [--evidence <type:locator>]...
           [--candidate <line>] [--repeats <id>]
      Append one observation, or one dated occurrence of the entry <id> names.

  resolve  <id> <status> [--in <type:locator>]... [--why <line>] [--on <date>]
      Record a human decision: Open -> Proposed -> Approved -> Applied, with
      Rejected and Deferred reachable from Proposed and Approved, and
      Deferred -> Open. Approved and Applied require --in; Rejected and
      Deferred require --why and --on.

  harvest
      A deterministic report of what the ledger says. Changes nothing.

  validate
      Parse the whole file and name every problem by id and line.

Options:
  --root <dir>   the project whose ledger to use (default: this directory)
  --json         machine-readable output
  -h, --help
`;

/** Flags that may be given more than once, collecting their values. */
const REPEATABLE = new Set(['evidence', 'in']);

/** Flags that take no value. */
const BOOLEAN = new Set(['json', 'help']);

function parse(argv) {
  const flags = { evidence: [], in: [] };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '-h' || argument === '--help') {
      flags.help = true;
      continue;
    }
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }

    const name = argument.slice(2);
    if (BOOLEAN.has(name)) {
      flags[name] = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      return { error: `--${name} needs a value` };
    }
    index += 1;

    if (REPEATABLE.has(name)) flags[name].push(value);
    else if (name in flags && !REPEATABLE.has(name)) return { error: `--${name} was given twice` };
    else flags[name] = value;
  }

  return { flags, positional };
}

function emit(json, payload, text) {
  process.stdout.write(json ? `${JSON.stringify(payload, null, 2)}\n` : text);
}

function refuse(json, command, message, code) {
  if (json) process.stdout.write(`${JSON.stringify({ ok: false, command, message }, null, 2)}\n`);
  else process.stderr.write(`ledger: ${message}\n`);
  return code;
}

function main(argv) {
  const [command, ...rest] = argv;

  if (!command || command === '-h' || command === '--help') {
    process.stdout.write(USAGE);
    return command ? 0 : 2;
  }

  const parsed = parse(rest);
  if (parsed.error) return refuse(false, command, parsed.error, 2);

  const { flags, positional } = parsed;
  if (flags.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const json = Boolean(flags.json);
  const root = flags.root ?? process.cwd();

  if (command === 'record') {
    const result = record({
      root,
      observed: flags.observed,
      source: flags.source,
      scope: flags.scope,
      category: flags.category,
      intervention: flags.intervention,
      impact: flags.impact,
      title: flags.title,
      candidate: flags.candidate,
      note: flags.note ?? '',
      evidence: flags.evidence,
      repeats: flags.repeats ?? null,
    });
    if (!result.ok) return refuse(json, command, result.message, result.usage ? 2 : 1);

    emit(json, { ok: true, command, ...result },
      result.repeated
        ? `recorded occurrence ${result.occurrences} of ${result.id}\n`
        : `recorded ${result.id}${result.created ? ' (ledger created from the template)' : ''}\n`);
    return 0;
  }

  if (command === 'resolve') {
    const result = resolveEntry({
      root,
      id: positional[0],
      status: positional[1],
      in: flags.in,
      why: flags.why ?? null,
      on: flags.on ?? null,
    });
    if (!result.ok) return refuse(json, command, result.message, result.usage ? 2 : 1);

    emit(json, { ok: true, command, ...result },
      `${result.id}: ${result.from} -> ${result.to}\n`);
    return 0;
  }

  if (command === 'harvest') {
    const result = harvest({ root });
    emit(json, { ok: true, command, path: result.path, empty: result.empty, report: result.report }, result.text);
    return 0;
  }

  if (command === 'validate') {
    const result = validate({ root });
    emit(json, {
      ok: result.ok, command, path: result.path,
      entries: result.entries ?? 0, problems: result.problems,
    }, result.text);
    return result.ok ? 0 : 1;
  }

  process.stderr.write(`ledger: unknown command \`${command}\`\n\n`);
  process.stdout.write(USAGE);
  return 2;
}

process.exit(main(process.argv.slice(2)));
