#!/usr/bin/env python3
"""Comprehensive Architectural Section Banner Verification Oracle for Aqua Dock Pro.

Validates:
1. Exact cardinality (5 sections in dock/dockBlur.js, 6 in dock/dockController.js).
2. Sequential numbering (1..5 in dockBlur.js, 1..6 in dockController.js) with zero duplicates.
3. Strictly monotonic character offsets and line numbers.
4. Canonical subsystem title matching.
5. Strict function and boundary anchoring:
   - dockBlur.js:
     * SECTION 1 precedes 'import Gio'
     * SECTION 2 follows getBmsGeneralSettings AND precedes isAquaPopupTarget
     * SECTION 3 precedes AquaDockSurface
     * SECTION 4 precedes activeAquaContainers
     * SECTION 5 follows SECTION 4 AND precedes cleanupBms
   - dockController.js:
     * SECTION 1 precedes DockController class
     * SECTION 2 precedes enableDashManagement()
     * SECTION 3 precedes _connectSignals()
     * SECTION 4 precedes relayout()
     * SECTION 5 precedes _enableFocusPointerExit()
     * SECTION 6 precedes destroy()
"""

import sys
import re
from pathlib import Path

def verify_dock_sections(root_dir: Path = Path('.'), verbose: bool = True) -> bool:
    errors = []
    
    # =========================================================================
    # 1. dock/dockBlur.js Verification
    # =========================================================================
    blur_path = root_dir / 'dock' / 'dockBlur.js'
    if not blur_path.is_file():
        print(f"ERROR: {blur_path} not found.")
        return False

    blur_content = blur_path.read_text(encoding='utf-8')

    blur_banner_pattern = re.compile(
        r'/\* =+\s*\n\s*\* SECTION (\d+):\s*([^\n]+)\n[\s\S]*?\* =+ \*/'
    )
    blur_matches = list(blur_banner_pattern.finditer(blur_content))
    
    expected_blur_titles = {
        1: "IMPORTS & STATE",
        2: "TARGET IDENTIFICATION",
        3: "PMS/BMS SURFACE LIFECYCLE",
        4: "SHADER & PIPELINE HOOKS",
        5: "TEARDOWN & RESET"
    }

    if verbose:
        print("=" * 80)
        print(f"VERIFYING ARCHITECTURAL BANNERS: {blur_path}")
        print("=" * 80)
        print(f"Total section banner blocks found: {len(blur_matches)}")

    blur_found_nums = []
    blur_found_titles = {}
    blur_positions = {}

    for m in blur_matches:
        num = int(m.group(1))
        title = m.group(2).strip()
        start = m.start()
        line = blur_content[:start].count('\n') + 1
        blur_found_nums.append(num)
        blur_found_titles[num] = title
        blur_positions[num] = (start, line)
        if verbose:
            print(f"  [Line {line:4d} | Offset {start:6d}] SECTION {num}: {title}")

    # Cardinality & Duplicates
    if len(blur_matches) != 5:
        errors.append(f"dockBlur.js: Expected exactly 5 sections, found {len(blur_matches)}")
    if len(set(blur_found_nums)) != len(blur_found_nums):
        errors.append(f"dockBlur.js: Duplicate section numbers detected: {blur_found_nums}")

    # Sequence
    if blur_found_nums != [1, 2, 3, 4, 5]:
        errors.append(f"dockBlur.js: Sections not in sequential order 1..5. Found appearance order: {blur_found_nums}")

    # Titles
    for num, exp_title in expected_blur_titles.items():
        if num in blur_found_titles:
            if blur_found_titles[num] != exp_title:
                errors.append(f"dockBlur.js: Section {num} title mismatch: expected '{exp_title}', got '{blur_found_titles[num]}'")
        else:
            errors.append(f"dockBlur.js: Missing Section {num} ('{exp_title}')")

    # Monotonicity
    for i in range(len(blur_matches) - 1):
        if blur_matches[i].start() >= blur_matches[i+1].start():
            errors.append(f"dockBlur.js: Monotonicity violation: SECTION {blur_matches[i].group(1)} >= SECTION {blur_matches[i+1].group(1)}")

    # Function Anchors
    pos_import_gio = blur_content.find("import Gio from 'gi://Gio';")
    pos_getBmsGeneralSettings = blur_content.find("export function getBmsGeneralSettings")
    pos_isAquaPopupTarget = blur_content.find("export function isAquaPopupTarget")
    pos_aquaDockSurface = blur_content.find("export class AquaDockSurface")
    pos_activeAquaContainers = blur_content.find("const activeAquaContainers = new Set();")
    pos_cleanupBms = blur_content.find("export function cleanupBms")

    if 1 in blur_positions and pos_import_gio != -1:
        if blur_positions[1][0] >= pos_import_gio:
            errors.append("dockBlur.js: SECTION 1 does not precede 'import Gio'")
    if 2 in blur_positions:
        sec2_offset = blur_positions[2][0]
        if pos_getBmsGeneralSettings != -1 and sec2_offset <= pos_getBmsGeneralSettings:
            errors.append(f"dockBlur.js: SECTION 2 (offset {sec2_offset}) erroneously precedes getBmsGeneralSettings (offset {pos_getBmsGeneralSettings})")
        if pos_isAquaPopupTarget != -1 and sec2_offset >= pos_isAquaPopupTarget:
            errors.append(f"dockBlur.js: SECTION 2 (offset {sec2_offset}) does not precede isAquaPopupTarget (offset {pos_isAquaPopupTarget})")
    if 3 in blur_positions and pos_aquaDockSurface != -1:
        if blur_positions[3][0] >= pos_aquaDockSurface:
            errors.append("dockBlur.js: SECTION 3 does not precede 'export class AquaDockSurface'")
    if 4 in blur_positions and pos_activeAquaContainers != -1:
        if blur_positions[4][0] >= pos_activeAquaContainers:
            errors.append("dockBlur.js: SECTION 4 does not precede 'const activeAquaContainers'")
    if 5 in blur_positions:
        sec5_offset = blur_positions[5][0]
        if 4 in blur_positions and sec5_offset <= blur_positions[4][0]:
            errors.append("dockBlur.js: SECTION 5 erroneously precedes SECTION 4")
        if pos_cleanupBms != -1 and sec5_offset >= pos_cleanupBms:
            errors.append(f"dockBlur.js: SECTION 5 (offset {sec5_offset}) does not precede cleanupBms (offset {pos_cleanupBms})")

    # =========================================================================
    # 2. dock/dockController.js Verification
    # =========================================================================
    ctrl_path = root_dir / 'dock' / 'dockController.js'
    if not ctrl_path.is_file():
        print(f"ERROR: {ctrl_path} not found.")
        return False

    ctrl_content = ctrl_path.read_text(encoding='utf-8')

    ctrl_banner_pattern = re.compile(
        r'/\* =+\s*\n\s*\* SECTION (\d+):\s*([^\n]+)\n[\s\S]*?\* =+ \*/'
    )
    ctrl_matches = list(ctrl_banner_pattern.finditer(ctrl_content))

    expected_ctrl_titles = {
        1: "IMPORTS & STATE",
        2: "DOCK ITEM MANAGEMENT",
        3: "SIGNAL WIRING & SHELL STATE",
        4: "VISIBILITY & AUTOHIDE COORDINATION",
        5: "HOVER & POINTER TRACKING",
        6: "TEARDOWN & DESTROY"
    }

    if verbose:
        print("\n" + "=" * 80)
        print(f"VERIFYING ARCHITECTURAL BANNERS: {ctrl_path}")
        print("=" * 80)
        print(f"Total section banner blocks found: {len(ctrl_matches)}")

    ctrl_found_nums = []
    ctrl_found_titles = {}
    ctrl_positions = {}

    for m in ctrl_matches:
        num = int(m.group(1))
        title = m.group(2).strip()
        start = m.start()
        line = ctrl_content[:start].count('\n') + 1
        ctrl_found_nums.append(num)
        ctrl_found_titles[num] = title
        ctrl_positions[num] = (start, line)
        if verbose:
            print(f"  [Line {line:4d} | Offset {start:6d}] SECTION {num}: {title}")

    # Cardinality & Duplicates
    if len(ctrl_matches) != 6:
        errors.append(f"dockController.js: Expected exactly 6 sections, found {len(ctrl_matches)}")
    if len(set(ctrl_found_nums)) != len(ctrl_found_nums):
        errors.append(f"dockController.js: Duplicate section numbers detected: {ctrl_found_nums}")

    # Sequence
    if ctrl_found_nums != [1, 2, 3, 4, 5, 6]:
        errors.append(f"dockController.js: Sections not in sequential order 1..6. Found appearance order: {ctrl_found_nums}")

    # Titles
    for num, exp_title in expected_ctrl_titles.items():
        if num in ctrl_found_titles:
            if ctrl_found_titles[num] != exp_title:
                errors.append(f"dockController.js: Section {num} title mismatch: expected '{exp_title}', got '{ctrl_found_titles[num]}'")
        else:
            errors.append(f"dockController.js: Missing Section {num} ('{exp_title}')")

    # Monotonicity
    for i in range(len(ctrl_matches) - 1):
        if ctrl_matches[i].start() >= ctrl_matches[i+1].start():
            errors.append(f"dockController.js: Monotonicity violation: SECTION {ctrl_matches[i].group(1)} >= SECTION {ctrl_matches[i+1].group(1)}")

    # Function Anchors
    def find_method_offset(content, regex):
        m = re.search(regex, content, re.MULTILINE)
        return m.start() if m else -1

    pos_ctrl_class = ctrl_content.find("export class DockController")
    pos_dash_mgmt = ctrl_content.find("enableDashManagement()")
    pos_connect_signals = find_method_offset(ctrl_content, r'^\s*_connectSignals\s*\(')
    pos_relayout = find_method_offset(ctrl_content, r'^\s*relayout\s*\(')
    pos_pointer_exit = find_method_offset(ctrl_content, r'^\s*_enableFocusPointerExit\s*\(')
    pos_destroy = find_method_offset(ctrl_content, r'^\s*destroy\s*\(')

    if 1 in ctrl_positions and pos_ctrl_class != -1:
        if ctrl_positions[1][0] >= pos_ctrl_class:
            errors.append("dockController.js: SECTION 1 does not precede 'export class DockController'")
    if 2 in ctrl_positions and pos_dash_mgmt != -1:
        if ctrl_positions[2][0] >= pos_dash_mgmt:
            errors.append("dockController.js: SECTION 2 does not precede 'enableDashManagement()'")
    if 3 in ctrl_positions and pos_connect_signals != -1:
        if ctrl_positions[3][0] >= pos_connect_signals:
            errors.append("dockController.js: SECTION 3 does not precede '_connectSignals()'")
    if 4 in ctrl_positions and pos_relayout != -1:
        if ctrl_positions[4][0] >= pos_relayout:
            errors.append("dockController.js: SECTION 4 does not precede 'relayout()'")
    if 5 in ctrl_positions and pos_pointer_exit != -1:
        if ctrl_positions[5][0] >= pos_pointer_exit:
            errors.append("dockController.js: SECTION 5 does not precede '_enableFocusPointerExit()'")
    if 6 in ctrl_positions and pos_destroy != -1:
        if ctrl_positions[6][0] >= pos_destroy:
            errors.append("dockController.js: SECTION 6 does not precede 'destroy()'")

    # =========================================================================
    # Diagnostic Output
    # =========================================================================
    if verbose:
        print("\n" + "=" * 80)
        print("VERIFICATION SUMMARY")
        print("=" * 80)
        if errors:
            print(f"STATUS: FAILED ({len(errors)} error(s) detected)")
            for err in errors:
                print(f"  [X] {err}")
        else:
            print("STATUS: PASSED (All section banners, offsets, sequences, and function anchors verified)")
        print("=" * 80)

    return len(errors) == 0

if __name__ == '__main__':
    ok = verify_dock_sections(verbose=True)
    sys.exit(0 if ok else 1)
