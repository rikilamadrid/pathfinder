#!/usr/bin/env python3
"""Confirm registry metadata and a complete tarball GET before tagging a release."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

DEADLINE_SECONDS = 15 * 60
POLL_SECONDS = 10
CONNECT_SECONDS = 10
TRANSFER_SECONDS = 60


def download(url, destination, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return False
    limit = min(TRANSFER_SECONDS, remaining)
    try:
        result = subprocess.run(
            ["curl", "--fail", "--silent", "--show-error", "--location",
             "--connect-timeout", str(min(CONNECT_SECONDS, limit)),
             "--max-time", str(limit), "--write-out", "%{http_code}",
             "--output", str(destination), url],
            timeout=remaining, check=False, stdout=subprocess.PIPE, text=True,
        )
    except subprocess.TimeoutExpired:
        return False
    # curl rejects incomplete transfers (including a short Content-Length body).
    # A successful 206 is still only a range, not the complete requested file.
    # Never infer success from a file left by a failed or interrupted request.
    return (result.returncode == 0 and result.stdout == "200"
            and time.monotonic() < deadline
            and destination.is_file() and destination.stat().st_size > 0)


def confirm(version, commit, metadata_url):
    started = time.monotonic()
    deadline = started + DEADLINE_SECONDS
    pending = "metadata"

    def progress(reason):
        now = time.monotonic()
        print(f"{pending} pending: {reason}; elapsed {now - started:.1f}s, "
              f"remaining {max(0, deadline - now):.1f}s", flush=True)

    with tempfile.TemporaryDirectory(prefix="pathfinder-confirm-") as scratch:
        metadata = Path(scratch) / "packument.json"
        tarball = Path(scratch) / "package.tgz"
        tarball_url = None
        while time.monotonic() < deadline:
            if tarball_url is None:
                pending = "metadata"
                progress("retrieving version packument")
                packument = None
                if download(metadata_url, metadata, deadline):
                    try:
                        packument = json.loads(metadata.read_text(encoding="utf-8"))
                    except (ValueError, UnicodeError):
                        progress("packument did not parse")
                if isinstance(packument, dict):
                    head = packument.get("gitHead") or ""
                    print(f"registry gitHead: {head or '<absent>'}", flush=True)
                    if not head:
                        print("::warning::the registry recorded no gitHead, so the published "
                              "tree cannot be tied to a commit from here", flush=True)
                    elif head != commit:
                        print(f"::error::published gitHead {head} is not the release commit {commit}. "
                              "Do not tag this. A wrong version can only be superseded.", flush=True)
                        return 1
                    dist = packument.get("dist")
                    candidate = dist.get("tarball") if isinstance(dist, dict) else None
                    pending = "tarball"
                    if isinstance(candidate, str) and candidate.strip():
                        tarball_url = candidate
                    else:
                        progress("dist.tarball is missing")
            if tarball_url is not None:
                pending = "tarball"
                progress("downloading package")
                if download(tarball_url, tarball, deadline):
                    print(f"create-pathfinder@{version} is live and matches {commit}.", flush=True)
                    return 0
            remaining = deadline - time.monotonic()
            if remaining > 0:
                progress("not available yet, waiting")
                time.sleep(min(POLL_SECONDS, remaining))
        progress("confirmation deadline exhausted")
    print(f"::error::create-pathfinder@{version} never appeared on the registry. "
          "Nothing was tagged or released. Investigate, then re-dispatch.", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(confirm(os.environ["VERSION"], os.environ["GITHUB_SHA"], sys.argv[1]))
