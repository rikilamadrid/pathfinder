"""Repository-only changelog assembly: real script, scratch checkouts."""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / ".github/scripts/assemble-changelog.py"
NOTES = ROOT / ".github/scripts/changelog-notes.py"

HEADER = """# Changelog

Intro.

"""
RELEASED = """## [1.0.0] - 2026-01-01

### Added

- First release.
"""
UNRELEASED = """## [Unreleased]

- **Existing entry.** Wrapped over
  two lines.
- Second existing entry.

### Added

- An added entry.

"""
CHANGELOG = HEADER + UNRELEASED + RELEASED
README = "# Changelog fragments\n\n- Not a release note.\n"


class AssembleTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.fragments = self.root / "changelog.d"
        self.fragments.mkdir()
        (self.fragments / "README.md").write_text(README, encoding="utf-8")
        self.changelog = self.root / "CHANGELOG.md"
        self.changelog.write_text(CHANGELOG, encoding="utf-8")

    def add(self, name, text):
        (self.fragments / name).write_text(text, encoding="utf-8")

    def assemble(self):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root)],
            capture_output=True, text=True, check=False)

    def snapshot(self):
        return {
            path.relative_to(self.root).as_posix(): path.read_bytes()
            for path in sorted(self.root.rglob("*")) if path.is_file()
        }

    def assert_refused(self, *names):
        before = self.snapshot()
        result = self.assemble()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        for name in names:
            self.assertIn(f"changelog.d/{name}", result.stderr)
        self.assertIn("nothing was changed", result.stderr)
        self.assertEqual(self.snapshot(), before)
        return result

    def test_appends_in_filename_order_in_the_existing_format(self):
        self.add("59.2.md", "- Second fragment.\n")
        self.add("59.1.md", "- First fragment, wrapped\n  onto a continuation.\n")
        self.add("fix-notes.md", "- Third fragment.\n- And its second bullet.\n")
        result = self.assemble()
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = HEADER + """## [Unreleased]

- **Existing entry.** Wrapped over
  two lines.
- Second existing entry.
- First fragment, wrapped
  onto a continuation.
- Second fragment.
- Third fragment.
- And its second bullet.

### Added

- An added entry.

""" + RELEASED
        self.assertEqual(self.changelog.read_text(encoding="utf-8"), expected)
        self.assertEqual(sorted(p.name for p in self.fragments.iterdir()),
                         ["README.md"])

    def test_same_fragments_give_the_same_bytes_whatever_order_they_were_written(self):
        outputs = []
        for order in (("b.md", "a.md", "10.1.md", "9.1.md"),
                      ("9.1.md", "10.1.md", "a.md", "b.md")):
            self.changelog.write_text(CHANGELOG, encoding="utf-8")
            for name in order:
                self.add(name, f"- From {name}.\n")
            self.assertEqual(self.assemble().returncode, 0)
            outputs.append(self.changelog.read_bytes())
        self.assertEqual(outputs[0], outputs[1])
        text = outputs[0].decode()
        positions = [text.index(f"- From {n}.") for n in
                     ("10.1.md", "9.1.md", "a.md", "b.md")]
        self.assertEqual(positions, sorted(positions))

    def test_fresh_unreleased_section(self):
        self.changelog.write_text(HEADER + "## [Unreleased]\n\n" + RELEASED,
                                  encoding="utf-8")
        self.add("59.1.md", "\n- Only fragment.  \n\n")
        self.assertEqual(self.assemble().returncode, 0)
        self.assertEqual(self.changelog.read_text(encoding="utf-8"),
                         HEADER + "## [Unreleased]\n\n- Only fragment.  \n\n" + RELEASED)

    def test_unreleased_at_end_of_file(self):
        self.changelog.write_text(HEADER + "## [Unreleased]\n", encoding="utf-8")
        self.add("59.1.md", "- Only fragment.\n")
        self.assertEqual(self.assemble().returncode, 0)
        self.assertEqual(self.changelog.read_text(encoding="utf-8"),
                         HEADER + "## [Unreleased]\n\n- Only fragment.\n")

    def test_second_run_is_a_no_op(self):
        self.add("59.1.md", "- A fragment.\n")
        self.assertEqual(self.assemble().returncode, 0)
        after_first = self.snapshot()
        result = self.assemble()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.snapshot(), after_first)

    def test_no_fragment_is_a_no_op(self):
        before = self.snapshot()
        result = self.assemble()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("nothing to assemble", result.stdout)
        self.assertEqual(self.snapshot(), before)

    def test_empty_directory_is_a_no_op(self):
        (self.fragments / "README.md").unlink()
        before = self.snapshot()
        self.assertEqual(self.assemble().returncode, 0)
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(self.fragments.is_dir())

    def test_readme_is_never_assembled(self):
        self.add("59.1.md", "- A fragment.\n")
        self.assertEqual(self.assemble().returncode, 0)
        self.assertNotIn("Not a release note", self.changelog.read_text(encoding="utf-8"))
        self.assertEqual((self.fragments / "README.md").read_text(encoding="utf-8"), README)

    def test_keeps_the_changelog_file_mode(self):
        self.changelog.chmod(0o644)
        self.add("59.1.md", "- A fragment.\n")
        self.assertEqual(self.assemble().returncode, 0)
        self.assertEqual(self.changelog.stat().st_mode & 0o777, 0o644)

    def test_refuses_two_fragments_with_the_same_text(self):
        self.add("59.1.md", "- Same note.\n")
        self.add("59.2.md", "- Same note.\n\n")
        result = self.assert_refused("59.2.md")
        self.assertIn("changelog.d/59.1.md", result.stderr)

    def test_refuses_text_already_in_unreleased(self):
        self.add("59.1.md", "- **Existing entry.** Wrapped over\n  two lines.\n")
        self.assert_refused("59.1.md")

    def test_refuses_text_already_under_an_unreleased_subsection(self):
        self.add("59.1.md", "- An added entry.\n")
        self.assert_refused("59.1.md")

    def test_a_bullet_that_only_begins_like_an_existing_one_is_not_a_duplicate(self):
        self.add("59.1.md", "- **Existing entry.** Wrapped over\n")
        self.assertEqual(self.assemble().returncode, 0)

    def test_refuses_invalid_names(self):
        for name in ("Upper.md", "59_1.md", "-lead.md", "trail-.md",
                     "two..dots.md", ".hidden.md"):
            with self.subTest(name=name):
                self.add(name, "- A fragment.\n")
                self.assert_refused(name)
                (self.fragments / name).unlink()

    def test_refuses_a_non_markdown_file(self):
        for name in ("59.1.txt", "59.1", ".DS_Store"):
            with self.subTest(name=name):
                self.add(name, "- A fragment.\n")
                self.assert_refused(name)
                (self.fragments / name).unlink()

    def test_refuses_a_directory(self):
        (self.fragments / "nested.md").mkdir()
        self.assert_refused("nested.md")

    def test_refuses_empty_and_whitespace_only_fragments(self):
        for text in ("", " \n\t\n\n"):
            with self.subTest(text=text):
                self.add("59.1.md", text)
                result = self.assert_refused("59.1.md")
                self.assertIn("empty", result.stderr)

    def test_refuses_fragments_that_are_not_bullets(self):
        for text in ("Prose, not a bullet.\n", "* Star bullet.\n",
                     "### Added\n\n- A bullet under a heading.\n",
                     "- A bullet.\nUnindented prose.\n", "-No space.\n", "- \n"):
            with self.subTest(text=text):
                self.add("59.1.md", text)
                self.assert_refused("59.1.md")

    def test_refusal_names_every_offending_file_and_writes_nothing(self):
        self.add("59.1.md", "- Good fragment.\n")
        self.add("Bad.md", "- Badly named.\n")
        self.add("59.2.md", "not a bullet\n")
        result = self.assert_refused("Bad.md", "59.2.md")
        self.assertNotIn("changelog.d/59.1.md", result.stderr)

    def test_refuses_without_an_unreleased_section(self):
        self.changelog.write_text(HEADER + RELEASED, encoding="utf-8")
        self.add("59.1.md", "- A fragment.\n")
        before = self.snapshot()
        result = self.assemble()
        self.assertEqual(result.returncode, 1)
        self.assertIn("[Unreleased]", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_release_notes_carry_the_fragment_verbatim(self):
        fragment = "- A fragment with `code`, **emphasis** and a\n  [link](https://example.com).\n"
        self.add("59.1.md", fragment)
        self.assertEqual(self.assemble().returncode, 0)
        # CONTRIBUTING.md §Releasing, "Write the changelog entry".
        text = self.changelog.read_text(encoding="utf-8")
        self.changelog.write_text(text.replace(
            "## [Unreleased]\n", "## [Unreleased]\n\n## [1.1.0] - 2026-02-01\n", 1),
            encoding="utf-8")
        scripts = self.root / ".github" / "scripts"
        scripts.mkdir(parents=True)
        (scripts / "changelog-notes.py").write_bytes(NOTES.read_bytes())
        notes = subprocess.run(
            [sys.executable, str(scripts / "changelog-notes.py"), "1.1.0"],
            capture_output=True, text=True, check=False)
        self.assertEqual(notes.returncode, 0, notes.stderr)
        self.assertIn(fragment.rstrip("\n"), notes.stdout)


if __name__ == "__main__":
    unittest.main()
