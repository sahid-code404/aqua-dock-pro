#!/usr/bin/env python3
"""Adversarial Stress Test Suite for dock section verification oracle.
Authored by Milestone 4 Iteration 2 Challenger 1 (`teamwork_preview_challenger_m4_iter2_1`).

Tests:
1. Baseline verification against current repository.
2. Cardinality mutations (missing sections, extra sections, duplicate sections).
3. Monotonicity & sequence permutations (inverted sections, swapped sections, M4-iter1 regressions).
4. Subsystem title mutations (corrupted titles, empty titles).
5. Function boundary anchor violations (Section 2 before getBmsGeneralSettings, Section 2 after isAquaPopupTarget, Section 5 before Section 4, Section 5 after cleanupBms, Controller Section 3 after _connectSignals, etc.).
6. Bypass vulnerability probing: What happens if anchor functions themselves are renamed or removed?
"""

import sys
import shutil
import tempfile
from pathlib import Path

# Add project root to path so we can import verify_dock_sections
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

try:
    from verify_dock_sections import verify_dock_sections
except ImportError:
    # If script is named verify-dock-sections.py (with hyphen)
    import importlib.util
    spec = importlib.util.spec_from_file_location("verify_dock_sections", str(PROJECT_ROOT / 'scripts' / 'verify-dock-sections.py'))
    vds = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(vds)
    verify_dock_sections = vds.verify_dock_sections

class OracleStressRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.findings = []

    def run_case(self, name: str, setup_fn, should_pass: bool, expected_error_substring: str = None):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            # Create dock directory and copy files
            (tmp_root / 'dock').mkdir(parents=True)
            shutil.copy2(PROJECT_ROOT / 'dock' / 'dockBlur.js', tmp_root / 'dock' / 'dockBlur.js')
            shutil.copy2(PROJECT_ROOT / 'dock' / 'dockController.js', tmp_root / 'dock' / 'dockController.js')

            # Apply mutation
            setup_fn(tmp_root)

            # Capture errors
            # We run verify_dock_sections(root_dir=tmp_root, verbose=False)
            # To also inspect errors, we can redirect stdout or import inspect
            res = verify_dock_sections(root_dir=tmp_root, verbose=False)

            if res == should_pass:
                self.passed += 1
                print(f"  [PASS] {name} (returned should_pass={should_pass})")
            else:
                self.failed += 1
                print(f"  [FAIL] {name}: Expected result={should_pass}, but got {res}")
                self.findings.append(f"{name}: expected should_pass={should_pass}, got {res}")

def main():
    runner = OracleStressRunner()
    print("=" * 80)
    print("ADVERSARIAL STRESS TEST: Dock Section Banner Verification Oracle")
    print("=" * 80)

    # 1. Baseline Test
    print("\n--- Group 1: Baseline Verification ---")
    runner.run_case("Baseline repository code passes", lambda root: None, should_pass=True)

    # 2. Cardinality Mutations
    print("\n--- Group 2: Cardinality Mutations ---")
    def delete_blur_sec5(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        banner = "/* ============================================================================\n * SECTION 5: TEARDOWN & RESET\n * Container unhooking, surface disposal, and DockBlurManager lifecycle.\n * ============================================================================ */"
        p.write_text(c.replace(banner, "// Banner removed"), encoding='utf-8')

    runner.run_case("dockBlur: Delete Section 5 (Cardinality 4 != 5)", delete_blur_sec5, should_pass=False)

    def duplicate_blur_sec2(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        banner = "/* ============================================================================\n * SECTION 2: TARGET IDENTIFICATION\n * Actor classification, container resolution, and corner geometry hooks.\n * ============================================================================ */"
        p.write_text(c + "\n\n" + banner, encoding='utf-8')

    runner.run_case("dockBlur: Duplicate Section 2 (Cardinality 6 != 5, Duplicates)", duplicate_blur_sec2, should_pass=False)

    def delete_ctrl_sec6(root):
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        banner = "/* ============================================================================\n * SECTION 6: TEARDOWN & DESTROY\n * Complete resource teardown, timer cancellation, and subsystem destruction.\n * ============================================================================ */"
        p.write_text(c.replace(banner, "// Banner removed"), encoding='utf-8')

    runner.run_case("dockController: Delete Section 6 (Cardinality 5 != 6)", delete_ctrl_sec6, should_pass=False)

    def extra_ctrl_sec7(root):
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        banner = "/* ============================================================================\n * SECTION 7: EXTRA SUBSECTION\n * Bogus extra section.\n * ============================================================================ */"
        p.write_text(c + "\n\n" + banner, encoding='utf-8')

    runner.run_case("dockController: Extra Section 7 (Cardinality 7 != 6)", extra_ctrl_sec7, should_pass=False)

    # 3. Monotonicity & Sequence Permutations
    print("\n--- Group 3: Sequence & Permutation Mutations ---")
    def blur_swap_sec3_sec4(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        # Renumber Section 3 to Section 4 and Section 4 to Section 3
        c = c.replace("SECTION 3: PMS/BMS SURFACE LIFECYCLE", "TEMP_SEC")
        c = c.replace("SECTION 4: SHADER & PIPELINE HOOKS", "SECTION 3: SHADER & PIPELINE HOOKS")
        c = c.replace("TEMP_SEC", "SECTION 4: PMS/BMS SURFACE LIFECYCLE")
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockBlur: Swap numbering Section 3 & 4 (Sequence broken)", blur_swap_sec3_sec4, should_pass=False)

    def blur_m4_iter1_regression(root):
        # In M4 Iteration 1, Section 2 and Section 5 were stacked above getBmsSettings at line 16-23
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        sec2_banner = "/* ============================================================================\n * SECTION 2: TARGET IDENTIFICATION\n * Actor classification, container resolution, and corner geometry hooks.\n * ============================================================================ */"
        sec5_banner = ("/* ============================================================================\n"
                       " * SECTION 5: TEARDOWN & RESET\n"
                       " * Container unhooking, surface disposal, and DockBlurManager lifecycle.\n"
                       " * ============================================================================ */")
        # Remove from current locations
        c = c.replace(sec2_banner, "")
        c = c.replace(sec5_banner, "")
        # Place above getBmsSettings
        target = "export function getBmsSettings"
        c = c.replace(target, sec2_banner + "\n" + sec5_banner + "\n" + target)
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockBlur: Revert to M4 Iteration 1 layout (Banners stacked at line 16)", blur_m4_iter1_regression, should_pass=False)

    def ctrl_m4_iter1_regression(root):
        # In M4 Iteration 1, Controller line 410 was Section 5 and line 683 was Section 3
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        c = c.replace("SECTION 3: SIGNAL WIRING & SHELL STATE", "SECTION 5: SIGNAL WIRING & SHELL STATE")
        c = c.replace("SECTION 5: HOVER & POINTER TRACKING", "SECTION 3: HOVER & POINTER TRACKING")
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockController: Revert to M4 Iteration 1 layout (Scrambled 1,2,5,4,3,6)", ctrl_m4_iter1_regression, should_pass=False)

    # 4. Title Mismatch Mutations
    print("\n--- Group 4: Subsystem Title Mutations ---")
    def blur_corrupt_title_sec2(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        c = c.replace("SECTION 2: TARGET IDENTIFICATION", "SECTION 2: TARGET ID WRONG")
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockBlur: Corrupt Section 2 Title", blur_corrupt_title_sec2, should_pass=False)

    def ctrl_corrupt_title_sec5(root):
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        c = c.replace("SECTION 5: HOVER & POINTER TRACKING", "SECTION 5: INPUTS & POINTERS")
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockController: Corrupt Section 5 Title", ctrl_corrupt_title_sec5, should_pass=False)

    # 5. Function Boundary Anchoring Mutations
    print("\n--- Group 5: Function Boundary Anchoring Mutations ---")
    def blur_sec2_after_isAquaPopupTarget(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        sec2_banner = "/* ============================================================================\n * SECTION 2: TARGET IDENTIFICATION\n * Actor classification, container resolution, and corner geometry hooks.\n * ============================================================================ */"
        c = c.replace(sec2_banner, "")
        # Place AFTER isAquaPopupTarget
        target = "export function addBlurForTarget"
        c = c.replace(target, sec2_banner + "\n" + target)
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockBlur: Section 2 placed AFTER isAquaPopupTarget", blur_sec2_after_isAquaPopupTarget, should_pass=False)

    def blur_sec5_after_cleanupBms(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        sec5_banner = "/* ============================================================================\n * SECTION 5: TEARDOWN & RESET\n * Container unhooking, surface disposal, and DockBlurManager lifecycle.\n * ============================================================================ */"
        c = c.replace(sec5_banner, "")
        # Place AFTER cleanupBms
        target = "export class DockBlurManager"
        c = c.replace(target, sec5_banner + "\n" + target)
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockBlur: Section 5 placed AFTER cleanupBms", blur_sec5_after_cleanupBms, should_pass=False)

    def ctrl_sec3_after_connectSignals(root):
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        sec3_banner = "/* ============================================================================\n * SECTION 3: SIGNAL WIRING & SHELL STATE\n * Signal connections, notification subscriptions, and throttled item refreshes.\n * ============================================================================ */"
        c = c.replace(sec3_banner, "")
        # Place AFTER _connectSignals
        target = "_queueRefresh(refreshNotifications = false)"
        c = c.replace(target, sec3_banner + "\n" + target)
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockController: Section 3 placed AFTER _connectSignals", ctrl_sec3_after_connectSignals, should_pass=False)

    def ctrl_sec6_after_destroy(root):
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        sec6_banner = "/* ============================================================================\n * SECTION 6: TEARDOWN & DESTROY\n * Complete resource teardown, timer cancellation, and subsystem destruction.\n * ============================================================================ */"
        c = c.replace(sec6_banner, "")
        # Place at end of file after destroy
        c = c + "\n\n" + sec6_banner
        p.write_text(c, encoding='utf-8')

    runner.run_case("dockController: Section 6 placed AFTER destroy()", ctrl_sec6_after_destroy, should_pass=False)

    # 6. Bypass Probing (Missing Anchor Functions)
    print("\n--- Group 6: Adversarial Probing: Missing Anchor Functions ---")
    bypass_vulnerabilities = []
    def probe_bypass(name, mutate_fn):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_root = Path(tmpdir)
            (tmp_root / 'dock').mkdir(parents=True)
            shutil.copy2(PROJECT_ROOT / 'dock' / 'dockBlur.js', tmp_root / 'dock' / 'dockBlur.js')
            shutil.copy2(PROJECT_ROOT / 'dock' / 'dockController.js', tmp_root / 'dock' / 'dockController.js')
            mutate_fn(tmp_root)
            res = verify_dock_sections(root_dir=tmp_root, verbose=False)
            if res is True:
                msg = f"[VULNERABILITY] {name}: Oracle returned PASSED (True) despite missing anchor target!"
                print(f"  ! {msg}")
                bypass_vulnerabilities.append(msg)
            else:
                print(f"  ✓ [SECURE] {name}: Oracle rejected missing anchor target.")

    def blur_missing_anchor_isAquaPopupTarget(root):
        p = root / 'dock' / 'dockBlur.js'
        c = p.read_text(encoding='utf-8')
        c = c.replace("export function isAquaPopupTarget", "export function renamedIsAquaPopupTarget")
        p.write_text(c, encoding='utf-8')

    probe_bypass("dockBlur: Anchor 'isAquaPopupTarget' renamed", blur_missing_anchor_isAquaPopupTarget)

    def ctrl_missing_anchor_connectSignals(root):
        p = root / 'dock' / 'dockController.js'
        c = p.read_text(encoding='utf-8')
        c = c.replace("_connectSignals()", "_wireSignals()")
        p.write_text(c, encoding='utf-8')

    probe_bypass("dockController: Anchor '_connectSignals()' renamed", ctrl_missing_anchor_connectSignals)

    # Summary
    print("\n" + "=" * 80)
    print(f"ADVERSARIAL STRESS TEST SUMMARY: {runner.passed} layout mutation tests passed, {runner.failed} failed")
    if bypass_vulnerabilities:
        print("\nAdversarial Bypass Vulnerability Analysis:")
        for v in bypass_vulnerabilities:
            print(f"  {v}")
        print("  Root cause: scripts/verify-dock-sections.py checks 'if pos != -1 and ...' without asserting that 'pos != -1'.")
    print("=" * 80)

    # Exit code reflects whether all 14 layout rejection tests passed
    return 0 if runner.failed == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
