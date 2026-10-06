"""Repository-only release checks: fake clock/network, real confirmation logic."""

from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("confirm_release", ROOT / ".github/scripts/confirm-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
METADATA = "https://registry.npmjs.org/create-pathfinder/1.2.3"
TARBALL = "https://registry.npmjs.org/create-pathfinder/-/create-pathfinder-1.2.3.tgz"
PACKUMENT = json.dumps({"gitHead": "abc", "dist": {"tarball": TARBALL}})


class ConfirmationTests(unittest.TestCase):
    def run_confirmation(self, responses):
        self.now = 0
        self.calls = []
        self.sleeps = []
        responses = iter(responses)

        def sleep(seconds):
            self.sleeps.append(seconds)
            self.now += seconds

        def run(args, *, timeout, check, stdout, text):
            self.calls.append(args)
            remaining = 900 - self.now
            self.assertGreater(timeout, 0)
            self.assertLessEqual(timeout, remaining)
            transfer = float(args[args.index("--max-time") + 1])
            connect = float(args[args.index("--connect-timeout") + 1])
            self.assertEqual(transfer, min(60, remaining))
            self.assertEqual(connect, min(10, transfer))
            self.assertIn("--location", args)
            self.assertIn("--fail", args)
            self.assertNotIn("--head", args)
            self.assertNotIn("-I", args)
            response = next(responses, (22, "", 0))
            code, body, duration = response[:3]
            status = response[3] if len(response) == 4 else "200"
            Path(args[args.index("--output") + 1]).write_text(body)
            self.now += duration
            if code == "timeout":
                self.now += timeout
                raise subprocess.TimeoutExpired(args, timeout)
            return subprocess.CompletedProcess(args, code, stdout=status)

        output = io.StringIO()
        with patch.object(release.time, "monotonic", lambda: self.now), \
             patch.object(release.time, "sleep", sleep), \
             patch.object(release.subprocess, "run", run), redirect_stdout(output):
            result = release.confirm("1.2.3", "abc", METADATA)
        self.output = output.getvalue()
        return result

    def test_immediate_success(self):
        self.assertEqual(self.run_confirmation([(0, PACKUMENT, 0), (0, "tarball", 0)]), 0)
        self.assertEqual([c[-1] for c in self.calls], [METADATA, TARBALL])
        self.assertEqual(self.sleeps, [])
        self.assertIn("is live and matches abc", self.output)

    def test_metadata_delayed_then_tarball_later_available(self):
        # Reproduce an asynchronous publish taking nearly nine minutes.
        responses = [(22, "", 0)] * 26 + [(0, PACKUMENT, 0)]
        responses += [(22, "", 0)] * 27 + [(0, "tarball", 0)]
        self.assertEqual(self.run_confirmation(responses), 0)
        self.assertEqual(self.now, 530)
        self.assertIn("metadata pending", self.output)
        self.assertIn("tarball pending", self.output)
        self.assertIn("elapsed 530.0s, remaining 370.0s", self.output)
        self.assertEqual(set(self.sleeps), {10})

    def test_deadline_exhaustion(self):
        self.assertEqual(self.run_confirmation([]), 1)
        self.assertEqual(self.now, 900)
        self.assertEqual(len(self.calls), 90)
        self.assertIn("Nothing was tagged or released. Investigate, then re-dispatch.", self.output)
        self.assertNotIn("is live", self.output)

    def test_partial_failed_download_cannot_count_as_live(self):
        for code in (18, 22, 28):
            with self.subTest(code=code):
                self.assertEqual(self.run_confirmation([(0, PACKUMENT, 0), (code, "partial", 0)]), 1)
                self.assertNotIn("is live", self.output)
                self.assertEqual(self.now, 900)

    def test_partial_http_status_cannot_count_as_live(self):
        self.assertEqual(self.run_confirmation([
            (0, PACKUMENT, 0), (0, "partial", 0, "206"),
        ]), 1)
        self.assertNotIn("is live", self.output)

    def test_metadata_retry_resets_pending_stage(self):
        self.assertEqual(self.run_confirmation([
            (0, '{"gitHead":"abc"}', 0), (0, '{broken', 0),
            (0, PACKUMENT, 0), (0, "tarball", 0),
        ]), 0)
        self.assertIn("metadata pending: packument did not parse", self.output)
        self.assertNotIn("tarball pending: retrieving version packument", self.output)

    def test_partial_download_can_recover(self):
        self.assertEqual(self.run_confirmation([
            (0, PACKUMENT, 0), (18, "partial", 0), (0, "complete", 0),
        ]), 0)
        self.assertEqual(self.now, 10)

    def test_empty_success_response_is_not_live(self):
        self.assertEqual(self.run_confirmation([(0, PACKUMENT, 0), (0, "", 0)]), 1)

    def test_malformed_metadata_retries(self):
        self.assertEqual(self.run_confirmation([
            (0, "{broken", 0), (0, PACKUMENT, 0), (0, "tarball", 0),
        ]), 0)
        self.assertIn("packument did not parse", self.output)
        self.assertEqual(self.now, 10)

    def test_malformed_metadata_exhausts_deadline(self):
        self.assertEqual(self.run_confirmation([(0, "not json", 0)] * 90), 1)
        self.assertEqual(self.now, 900)
        self.assertNotIn(TARBALL, [c[-1] for c in self.calls])

    def test_failed_metadata_body_is_not_parsed(self):
        self.assertEqual(self.run_confirmation([(18, PACKUMENT, 0)]), 1)
        self.assertNotIn(TARBALL, [c[-1] for c in self.calls])

    def test_mismatched_githead_fails_immediately(self):
        self.assertEqual(self.run_confirmation([(0, PACKUMENT.replace('abc', 'wrong'), 0)]), 1)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.sleeps, [])
        self.assertIn("Do not tag this. A wrong version can only be superseded.", self.output)

    def test_absent_githead_keeps_warning(self):
        metadata = json.dumps({"dist": {"tarball": TARBALL}})
        self.assertEqual(self.run_confirmation([(0, metadata, 0), (0, "tarball", 0)]), 0)
        self.assertIn("::warning::the registry recorded no gitHead", self.output)

    def test_missing_tarball_and_non_object_metadata_retry(self):
        for metadata in ('null', '[]', '{}', '{"dist": null}', '{"dist":{"tarball":""}}'):
            with self.subTest(metadata=metadata):
                self.assertEqual(self.run_confirmation([
                    (0, metadata, 0), (0, PACKUMENT, 0), (0, "tarball", 0),
                ]), 0)
                self.assertEqual(self.now, 10)

    def test_last_network_operation_is_capped_by_remaining_deadline(self):
        responses = [(22, "", 0)] * 89 + [(0, PACKUMENT, 7), (28, "partial", 3)]
        self.assertEqual(self.run_confirmation(responses), 1)
        self.assertEqual(self.now, 900)
        self.assertEqual(float(self.calls[-1][self.calls[-1].index("--max-time") + 1]), 3)

    def test_outer_process_timeout_is_failure(self):
        self.assertEqual(self.run_confirmation([(0, PACKUMENT, 0), ("timeout", "partial", 0)]), 1)
        self.assertEqual(self.now, 900)

    def test_success_at_deadline_is_too_late(self):
        responses = [(22, "", 0)] * 89 + [(0, PACKUMENT, 0), (0, "complete", 10)]
        self.assertEqual(self.run_confirmation(responses), 1)
        self.assertNotIn("is live", self.output)

    def test_redispatch_plan_skips_existing_publication_then_confirms(self):
        workflow = (ROOT / ".github/workflows/release.yml").read_text()
        plan = workflow.split("      - name: Plan the release\n", 1)[1].split("      - name:", 1)[0]
        script = plan.split("        run: |\n", 1)[1]
        script = "\n".join(line[10:] for line in script.splitlines())
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "packages/create-pathfinder").mkdir(parents=True)
            (root / "packages/create-pathfinder/package.json").write_text('{"version":"1.2.3"}')
            (root / "CHANGELOG.md").write_text('## [1.2.3]\n')
            bin_dir = root / "bin"
            bin_dir.mkdir()
            commands = {
                'git': 'case "$1" in fetch) exit 0;; rev-parse) echo abc;; ls-remote) exit 2;; *) exit 99;; esac',
                'gh': 'exit 1',
                'curl': 'echo \'{"versions":{"1.2.3":{}}}\'',
                'npm': 'exit 99',
            }
            for name, body in commands.items():
                file = bin_dir / name
                file.write_text('#!/bin/sh\n' + body + '\n')
                file.chmod(0o755)
            output = root / "outputs"
            result = subprocess.run(['bash', '-c', script], cwd=root, capture_output=True, text=True,
                                    env={**os.environ, 'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                                         'VERSION': '1.2.3', 'GITHUB_SHA': 'abc', 'GITHUB_OUTPUT': str(output)})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('published=yes', output.read_text())
            self.assertIn('tagged=no', output.read_text())
            self.assertIn('released=no', output.read_text())
        publish = workflow.split('      - name: Publish to npm\n')[1].split('      - name:')[0]
        self.assertIn("if: steps.plan.outputs.published == 'no'", publish)
        confirmation = workflow.split('      - name: Confirm the registry serves this version\n')[1].split('      - name:')[0]
        self.assertNotRegex(confirmation, re.compile(r'^\s*if:', re.MULTILINE))
        self.assertIn('python3 .github/scripts/confirm-release.py', confirmation)
        self.assertEqual(self.run_confirmation([(0, PACKUMENT, 0), (0, 'tarball', 0)]), 0)


class RealHttpTests(unittest.TestCase):
    def test_complete_partial_truncated_and_redirected_gets(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append((self.command, self.path, self.headers.get("Range")))
                if self.path == '/redirect':
                    self.send_response(302)
                    self.send_header('Location', '/complete')
                    self.end_headers()
                    return
                self.send_response(206 if self.path == '/partial' else 200)
                self.send_header('Content-Length', '100' if self.path == '/truncated' else '7')
                if self.path == '/partial':
                    self.send_header('Content-Range', 'bytes 0-6/100')
                self.end_headers()
                self.wfile.write(b'payload')

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / 'download'
                for path, expected in [('/complete', True), ('/partial', False),
                                       ('/truncated', False), ('/redirect', True)]:
                    with self.subTest(path=path):
                        url = f'http://127.0.0.1:{server.server_port}{path}'
                        self.assertEqual(release.download(url, target, time.monotonic() + 5), expected)
                self.assertEqual([p for _, p, _ in requests],
                                 ['/complete', '/partial', '/truncated', '/redirect', '/complete'])
                self.assertTrue(all(method == 'GET' and byte_range is None
                                    for method, _, byte_range in requests))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
