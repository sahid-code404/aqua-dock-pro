#!/usr/bin/env python3
"""Static checks for common extensions.gnome.org / Shexli review failures.

This script analyzes only JavaScript that is shipped by scripts/package.sh.
It is intentionally conservative: it fails on known EGO-invalid process-boundary
imports and reviewer-hostile synchronous APIs while allowing the one declared,
user-triggered folder-stack clipboard helper plus the preferences GTK clipboard path.
It also guards the GNOME Shell 50/51 compatibility boundary against APIs removed
or signature-changed in GNOME Shell 51.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DIRS = (
    "animation", "autohide", "compat", "core", "dock", "downloads", "effects",
    "interactions", "menus", "prefs", "services", "ui",
)
ROOTS = (Path("extension.js"), Path("prefs.js"))
CLIPBOARD_RUNTIME_ALLOWLIST = {Path("downloads/fileClipboard.js")}
SHELL_50_COMPAT_ALLOWLIST = {Path("compat/shell.js")}

IMPORT_RE = re.compile(
    r"(?m)^\s*(?:import|export)\s+(?:[^'\";]+?\s+from\s+)?['\"]([^'\"]+)['\"]\s*;?"
)
CLIPBOARD_RE = re.compile(r"\bSt\.Clipboard\b|\bClipboard\.get_default\s*\(")


def shipped_js() -> set[Path]:
    files = {Path("extension.js"), Path("prefs.js")}
    for directory in PACKAGE_DIRS:
        base = ROOT / directory
        if base.is_dir():
            files.update(path.relative_to(ROOT) for path in base.rglob("*.js"))
    return files


def local_imports(path: Path) -> set[Path]:
    text = (ROOT / path).read_text(encoding="utf-8")
    result: set[Path] = set()
    for spec in IMPORT_RE.findall(text):
        if not spec.startswith("."):
            continue
        candidate = (path.parent / spec).resolve()
        try:
            relative = candidate.relative_to(ROOT.resolve())
        except ValueError:
            raise SystemExit(f"Local import escapes extension root: {path}: {spec}")
        if relative.suffix == "":
            relative = relative.with_suffix(".js")
        result.add(relative)
    return result


def closure(root: Path, allowed: set[Path]) -> set[Path]:
    seen: set[Path] = set()
    pending = [root]
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        if current not in allowed:
            raise SystemExit(f"Imported JavaScript is not packaged: {current}")
        seen.add(current)
        for imported in local_imports(current):
            if not (ROOT / imported).is_file():
                raise SystemExit(f"Missing local import: {current} -> {imported}")
            pending.append(imported)
    return seen


def line_matches(path: Path, pattern: re.Pattern[str]) -> list[tuple[int, str]]:
    matches = []
    for number, line in enumerate((ROOT / path).read_text(encoding="utf-8").splitlines(), 1):
        if pattern.search(line):
            matches.append((number, line.strip()))
    return matches


def fail_matches(label: str, files: set[Path], pattern: str) -> list[str]:
    regex = re.compile(pattern)
    errors: list[str] = []
    for path in sorted(files):
        for number, line in line_matches(path, regex):
            errors.append(f"{label}: {path}:{number}: {line}")
    return errors


def main() -> int:
    package_files = shipped_js()
    runtime = closure(Path("extension.js"), package_files)
    preferences = closure(Path("prefs.js"), package_files)
    reachable = runtime | preferences

    errors: list[str] = []

    unreachable = sorted(package_files - reachable)
    if unreachable:
        errors.extend(f"EGO-P-007 unreachable packaged JavaScript: {path}" for path in unreachable)

    errors += fail_matches("legacy imports API", reachable, r"\bimports\.")

    errors += fail_matches(
        "EGO-I-002 GTK/GDK/Adw import in Shell process",
        runtime,
        r"from\s+['\"]gi://(?:Gtk|Gdk|Adw)(?:\?|['\"])" ,
    )
    errors += fail_matches(
        "EGO-I-003 Shell/Clutter/St/Meta import in preferences process",
        preferences,
        r"from\s+['\"]gi://(?:Clutter|Meta|St|Shell)(?:\?|['\"])" ,
    )

    for path in sorted(runtime):
        matches = line_matches(path, CLIPBOARD_RE)
        if not matches:
            continue
        if path not in CLIPBOARD_RUNTIME_ALLOWLIST:
            for number, line in matches:
                errors.append(
                    f"EGO-A-005 undeclared Shell clipboard access: {path}:{number}: {line}"
                )

    allowed_helper = ROOT / "downloads/fileClipboard.js"
    if allowed_helper.is_file():
        helper_text = allowed_helper.read_text(encoding="utf-8")
        if "St.Clipboard.get_default().set_content(" not in helper_text:
            errors.append(
                "folder-stack clipboard helper must use the narrow user-triggered set_content path"
            )

    errors += fail_matches(
        "EGO-X-002 synchronous subprocess API",
        runtime,
        r"\bGLib\.(?:spawn_sync|spawn_command_line_sync)\s*\(|\.communicate(?:_utf8)?\s*\(",
    )
    errors += fail_matches(
        "EGO-X-004 synchronous file IO in Shell process",
        runtime,
        r"\bGLib\.file_(?:get|set)_contents\s*\(|\.load_contents\s*\(|\.replace_contents\s*\(",
    )
    errors += fail_matches(
        "reviewer-hostile forced GObject disposal",
        runtime,
        r"\brun_dispose\s*\(",
    )

    errors += fail_matches(
        "dynamic code execution",
        reachable,
        r"\beval\s*\(|\bnew\s+Function\s*\(",
    )

    # GNOME Shell 51 compatibility gates. Keep GNOME-50-only compatibility
    # calls isolated in compat/shell.js so new runtime code cannot accidentally
    # reintroduce an API removed or signature-changed in Shell 51.
    errors += fail_matches(
        "GNOME-51 removed pointerWatcher API",
        runtime,
        r"resource:///org/gnome/shell/ui/pointerWatcher\.js",
    )
    errors += fail_matches(
        "GNOME-51 removed Shell.GLSLEffect",
        runtime,
        r"\bShell\.GLSLEffect\b",
    )
    errors += fail_matches(
        "GNOME-51 removed Clutter.get_default_backend()",
        runtime,
        r"\bClutter\.get_default_backend\s*\(",
    )
    errors += fail_matches(
        "GNOME-51 forbids async Extension.disable()",
        runtime,
        r"\basync\s+disable\s*\(",
    )

    runtime_outside_compat = runtime - SHELL_50_COMPAT_ALLOWLIST
    errors += fail_matches(
        "GNOME-51 direct BoxPointer.PopupAnimation use must go through compat/shell.js",
        runtime_outside_compat,
        r"\bBoxPointer\.PopupAnimation\b",
    )

    metadata = json.loads((ROOT / "metadata.json").read_text(encoding="utf-8"))
    shell_versions = metadata.get("shell-version")
    if shell_versions != ["50", "51"]:
        errors.append(
            "metadata shell-version must be ['50', '51'] for the dual-version build"
        )
    if metadata.get("url") != "https://github.com/sahid-code404/aqua-dock-pro":
        errors.append("metadata url must point to the public source repository")
    if metadata.get("session-modes") == ["user"]:
        errors.append("EGO-M-005: omit session-modes when it contains only user")

    description = str(metadata.get("description", "")).lower()
    if "clipboard" not in description:
        errors.append("metadata description must declare clipboard access")
    if CLIPBOARD_RUNTIME_ALLOWLIST & runtime and "folder-stack" not in description:
        errors.append("metadata description must declare folder-stack clipboard access")

    if errors:
        print("EGO compatibility audit failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print(
        "EGO compatibility audit passed "
        f"({len(runtime)} runtime JS, {len(preferences)} preferences JS, "
        f"{len(reachable)} reachable packaged JS)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
