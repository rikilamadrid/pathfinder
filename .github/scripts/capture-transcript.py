#!/usr/bin/env python3
"""Re-capture the installer transcript in the getting-started guide, from a real run.

    python3 .github/scripts/capture-transcript.py            # write it
    python3 .github/scripts/capture-transcript.py --check    # report only

The installer prints its own version, so the captured transcript on the
getting-started page goes stale the moment `set-release-version.py` lands. This
drives the local release source under a pty, answers its questions, renders what
the terminal is left showing, and writes that into the page.

Never edit a captured transcript by hand. The point of a transcript is that a
run actually produced it, and a search-and-replace turns evidence into an
illustration that agrees with itself. That is why this exists as a script: the
only supported way to change those bytes is to produce them again.

**Verification must not touch the machine it runs on.** Two of the installer's
questions have side effects outside the temp directory — one replaces the
system clipboard, one launches an editor — and a capture run must decline both.
Three defences, because a capture that quietly opened three editor windows is
what prompted them:

1. *Answers are chosen, never defaulted.* Every keystroke is sent only after
   rendering the live frame and confirming the cursor sits on the intended
   option. A bare Enter accepts whatever the cursor happens to be on, and the
   cursor defaults to Yes on both of the questions that matter.
2. *The launchable commands are shadowed.* A shim directory goes on the front of
   PATH holding a no-op for every editor and clipboard command that already
   resolves there. Only commands that already resolve are shadowed, so what the
   installer detects — and therefore what the transcript says it detected — is
   exactly what it would detect without the shim.
3. *The capture is refused if either side effect appears.* The installer prints
   `Copied.` and `Opening <editor>.` when it acts, so their absence is checked
   before anything is written. A transcript that shows either one is a failed
   capture, not a new transcript.

The counts and the install path are replaced with the placeholders the page
already documents (`N`, `/path/to/my-project`). The version is not: it is the
one thing this is here to prove.

Dependency-free, like the other scripts here, and for the same reason.
"""

from __future__ import annotations

import argparse
import fcntl
import os
import pty
import re
import select
import shutil
import struct
import sys
import tempfile
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "packages/create-pathfinder/bin/create-pathfinder.mjs"
GUIDE = ROOT / "site/src/content/docs/guides/getting-started.md"

# The terminal the run is captured in. Wide enough that no row wraps; the
# rendered frame is only faithful if the program never had to fold a line.
ROWS, COLUMNS = 40, 100

TIMEOUT_SECONDS = 120

# Every command the installer can *launch* — editors from src/editor.mjs,
# clipboard writers from src/clipboard.mjs. Shadowed, never added.
LAUNCHABLE = ("code", "cursor", "pbcopy", "clip", "clip.exe", "wl-copy", "xclip", "xsel")

# Proof that the run declined both side effects. src/clipboard.mjs and
# src/editor.mjs print these only after acting.
SIDE_EFFECT_MARKERS = ("Copied.", "Opening ")

CURSOR = "❯"          # the selected-row marker
CHECKED, UNCHECKED = "◉", "○"
DOWN, UP, SPACE, ENTER = b"\x1b[B", b"\x1b[A", b" ", b"\r"

# What to answer, in the order the installer asks. `choose` names the option the
# cursor must be confirmed on before Enter; `checked` names the complete set of
# boxes that must be ticked before Enter.
ANSWERS = (
    {"question": "Initialize a Git repository here?", "choose": "Yes"},
    {"question": "Configure Pathfinder for which tools?", "checked": ("Claude Code",)},
    {"question": "Copy that prompt to your clipboard?", "choose": "No"},
    {"question": "Open this project in", "choose": "No"},
)


class CaptureError(RuntimeError):
    """A capture that cannot be trusted. Never written, always explained."""


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def render(stream: str) -> str:
    """The text a terminal is left showing after `stream`.

    A deliberately small emulator: the installer's questions redraw in place
    using carriage returns, erase-line, and cursor-up, and those are the only
    sequences interpreted here. Anything else is dropped, which is right for
    colour and wrong for cursor addressing — so if the prompter ever grows a
    `ESC[<row>;<col>H`, this needs to grow with it rather than quietly lie.
    """
    lines, row, col = [""], 0, 0

    index = 0
    while index < len(stream):
        char = stream[index]

        if char == "\x1b" and stream[index + 1: index + 2] == "[":
            match = re.match(r"\[(\d*)([A-Za-z])", stream[index + 1:])
            if match:
                count = int(match.group(1) or 1)
                command = match.group(2)
                if command == "A":
                    row = max(0, row - count)
                    col = min(col, len(lines[row]))
                elif command == "B":
                    row += count
                    while len(lines) <= row:
                        lines.append("")
                elif command == "K":
                    lines[row] = "" if match.group(1) == "2" else lines[row][:col]
                index += 1 + match.end()
                continue

        if char == "\r":
            col = 0
        elif char == "\n":
            row += 1
            col = 0
            while len(lines) <= row:
                lines.append("")
        else:
            padded = lines[row].ljust(col)
            lines[row] = padded[:col] + char + padded[col + 1:]
            col += 1

        index += 1

    return "\n".join(line.rstrip() for line in lines)


def current_options(frame: str, question: str) -> list[tuple[bool, str, str]]:
    """The option rows of the question being asked now, newest occurrence.

    Returns `(cursor_here, mark, label)` per row, where `mark` is the checkbox
    glyph for a multi-select and "" for a single-select.
    """
    start = frame.rfind("? " + question)
    if start == -1:
        return []

    rows: list[tuple[bool, str, str]] = []
    for line in frame[start:].split("\n")[1:]:
        if line.strip() == "":
            continue
        if "move" in line and ("confirm" in line or "toggle" in line):
            break  # the hint line closes the list

        here = line.startswith(CURSOR)
        body = line[1:].strip() if here else line.strip()
        if body == "":
            continue

        mark = ""
        if body[0] in (CHECKED, UNCHECKED):
            mark, body = body[0], body[1:].strip()

        # Trim the trailing "-> path (detected)" annotation to leave the label.
        label = re.split(r"\s{2,}|\s->\s", body)[0].strip()
        rows.append((here, mark, label))

    return rows


# --------------------------------------------------------------------------
# Driving the run
# --------------------------------------------------------------------------

class Session:
    """One pty-hosted installer run, answered by looking before pressing."""

    def __init__(self, fd: int, pid: int):
        self.fd, self.pid = fd, pid
        self.raw = bytearray()
        self.deadline = time.time() + TIMEOUT_SECONDS

    def pump(self, seconds: float = 0.3) -> None:
        ready, _, _ = select.select([self.fd], [], [], seconds)
        if not ready:
            return
        try:
            chunk = os.read(self.fd, 65536)
        except OSError:
            return
        self.raw.extend(chunk)

    @property
    def frame(self) -> str:
        return render(bytes(self.raw).decode("utf-8", "replace"))

    def send(self, keys: bytes) -> None:
        os.write(self.fd, keys)
        time.sleep(0.25)
        self.pump()

    def await_question(self, question: str) -> None:
        while time.time() < self.deadline:
            if current_options(self.frame, question):
                return
            self.pump()
        raise CaptureError(f"the installer never asked: {question!r}")

    def move_cursor_to(self, question: str, label: str) -> None:
        """Put the cursor on `label`, confirming from the frame at every step.

        The budget is the list length, so a mis-parsed row runs out of moves
        instead of walking the list forever.
        """
        rows = current_options(self.frame, question)
        for _ in range(len(rows) + 1):
            rows = current_options(self.frame, question)
            here = next((index for index, row in enumerate(rows) if row[0]), None)
            want = next((index for index, row in enumerate(rows) if row[2] == label), None)
            if want is None:
                raise CaptureError(f"{question!r} has no option {label!r}")
            if here is None:
                raise CaptureError(f"{question!r} shows no cursor")
            if here == want:
                return
            self.send(DOWN if want > here else UP)

        raise CaptureError(f"could not put the cursor on {label!r} in {question!r}")

    def answer_single(self, question: str, choose: str) -> None:
        self.move_cursor_to(question, choose)

        confirmed = next((row for row in current_options(self.frame, question) if row[0]), None)
        if confirmed is None or confirmed[2] != choose:
            raise CaptureError(f"refusing to confirm {question!r}: cursor is not on {choose!r}")

        self.send(ENTER)

    def answer_multi(self, question: str, checked: tuple[str, ...]) -> None:
        for label in [row[2] for row in current_options(self.frame, question)]:
            wanted = label in checked
            row = next(row for row in current_options(self.frame, question) if row[2] == label)
            if (row[1] == CHECKED) != wanted:
                self.move_cursor_to(question, label)
                self.send(SPACE)

        for _, mark, label in current_options(self.frame, question):
            if (mark == CHECKED) != (label in checked):
                raise CaptureError(f"refusing to confirm {question!r}: {label!r} is not as asked")

        self.send(ENTER)

    def drain(self) -> None:
        while time.time() < self.deadline:
            before = len(self.raw)
            self.pump(0.4)
            if len(self.raw) == before:
                try:
                    if os.waitpid(self.pid, os.WNOHANG)[0] == self.pid:
                        return
                except ChildProcessError:
                    return


def shim_directory(parent: Path) -> Path:
    """No-ops for the launchable commands that already resolve on PATH.

    Only those. Shimming a command the machine does not have would add it to
    what the installer detects, and the transcript would then claim a tool the
    reader's machine — and this one — does not actually have.
    """
    shims = parent / "shims"
    shims.mkdir()

    for command in LAUNCHABLE:
        if shutil.which(command) is None:
            continue
        stub = shims / command
        stub.write_text("#!/bin/sh\nexit 0\n")
        stub.chmod(0o755)

    return shims


def capture() -> tuple[str, Path]:
    """Run the installer to completion in a scratch repository. Return the frame."""
    if not INSTALLER.exists():
        raise CaptureError(f"no installer at {INSTALLER}")

    scratch = Path(tempfile.mkdtemp(prefix="pathfinder-transcript-"))
    target = scratch / "my-project"
    target.mkdir()

    environment = dict(os.environ)
    environment["NO_COLOR"] = "1"
    environment["TERM"] = "xterm-256color"
    environment.pop("PATHFINDER_PROMPT", None)  # the captured page shows the selection UI
    environment["PATH"] = f"{shim_directory(scratch)}{os.pathsep}{environment.get('PATH', '')}"

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(target)
        os.execvpe("node", ["node", str(INSTALLER)], environment)
        os._exit(127)

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLUMNS, 0, 0))

    session = Session(fd, pid)
    try:
        for answer in ANSWERS:
            question = answer["question"]
            session.await_question(question)
            if "choose" in answer:
                session.answer_single(question, answer["choose"])
            else:
                session.answer_multi(question, answer["checked"])
        session.drain()
    finally:
        os.close(fd)

    return session.frame, target


def verify(frame: str) -> None:
    """Refuse a capture that shows a side effect, or that answered by default."""
    for marker in SIDE_EFFECT_MARKERS:
        if marker in frame:
            raise CaptureError(
                f"the run performed a side effect ({marker.strip()!r}) — "
                "the clipboard or editor question was not answered No"
            )

    for answer in ANSWERS:
        if answer.get("choose") != "No":
            continue
        rows = current_options(frame, answer["question"])
        confirmed = next((row for row in rows if row[0]), None)
        if confirmed is None or confirmed[2] != "No":
            raise CaptureError(f"{answer['question']!r} does not show No selected")


def redact(frame: str, target: Path) -> str:
    """Swap in the placeholders the page documents. The version is left alone."""
    text = frame.replace(str(target.resolve()), "/path/to/my-project")
    text = text.replace(str(target), "/path/to/my-project")

    text = re.sub(r"(— )\d+( copied)", r"\1N\2", text)
    text = re.sub(r"(— )\d+( adapters)", r"\1N\2", text)
    text = re.sub(r"\b\d+( files written)", r"N\1", text)
    text = re.sub(r"\b\d+( \S+(?: \S+)? skill adapters generated)", r"N\1", text)
    text = re.sub(r"\b\d+ files, \d+ adapters,", "N files, N adapters,", text)

    return text.strip("\n") + "\n"


def replace_block(page: str, transcript: str) -> str:
    """Swap the guide's first ```text block for the freshly captured one."""
    pattern = re.compile(r"```text\n.*?\n```", re.DOTALL)
    if pattern.search(page) is None:
        raise CaptureError(f"no ```text block in {GUIDE}")
    return pattern.sub(lambda _: "```text\n" + transcript.rstrip("\n") + "\n```", page, count=1)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="capture and compare, but write nothing")
    options = parser.parse_args()

    scratch = None
    try:
        frame, target = capture()
        scratch = target.parent
        verify(frame)
        transcript = redact(frame, target)
    except CaptureError as error:
        print(f"capture-transcript: {error}", file=sys.stderr)
        return 1
    finally:
        if scratch is not None:
            shutil.rmtree(scratch, ignore_errors=True)

    page = GUIDE.read_text()
    updated = replace_block(page, transcript)

    version = re.search(r"P A T H F I N D E R\s+v(\S+)", transcript)
    print(f"capture-transcript: captured a run of v{version.group(1) if version else '?'}")

    if updated == page:
        print("capture-transcript: the guide already matches this run")
        return 0

    if options.check:
        print(f"capture-transcript: {GUIDE.relative_to(ROOT)} does not match this run", file=sys.stderr)
        return 1

    GUIDE.write_text(updated)
    print(f"capture-transcript: rewrote {GUIDE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
