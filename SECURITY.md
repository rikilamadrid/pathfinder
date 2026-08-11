# Security Policy

## Scope — read this first

Pathfinder ships **Markdown instruction files only**. There is no runtime, no package manager, no build step, no dependencies, and no executable code in this repository. Cloning it and copying its folders executes nothing.

That makes the realistic risk surface narrow and unusual:

- **Prompt content.** The files in `skills/`, `prompts/`, `context/`, `templates/`, `AGENTS.md`, and `CLAUDE.md` are read by AI coding agents and shape what those agents do. Instructions that could cause an agent to exfiltrate secrets, run destructive commands, disable safeguards, or take actions outside the user's intent are in scope — whether introduced maliciously or by accident.
- **Instructions that weaken a human checkpoint.** Pathfinder's safety model depends on the human approving dependency additions, destructive commands, migrations, commits, merges, and releases. A change that quietly removes or bypasses one of those checkpoints is a security issue here, not just a workflow regression.

Out of scope: vulnerabilities in the AI agents themselves (Claude Code, Codex, or any other), in your editor, or in the stack your destination project chooses. Report those to their respective maintainers.

## Reporting

Report privately. Do not open a public issue for a security problem.

- **Preferred:** GitHub's private vulnerability reporting — the **Report a vulnerability** button under this repository's Security tab.
- **Email:** riki.lamadrid@gmail.com

Useful details: the file involved, what an agent could be induced to do, and the sequence that triggers it. A concrete reproduction against a real agent is far more actionable than a theoretical concern.

## What to expect

This is a small project maintained by one person. Reports are taken seriously and read, but there is no guaranteed response time and no bug bounty. If a report is valid, the fix and its reasoning will be recorded in `CHANGELOG.md`, and credit will be given unless you ask otherwise.

## Supported versions

Only the latest release is supported. Fixes land on `main` and go out in the next release; older versions are not patched.
