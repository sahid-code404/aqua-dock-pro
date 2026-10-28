# Aqua Dock Pro - Agent Operational Guidelines

## Core Directive: Deploy the Best Agent for Every Task
Always analyze the incoming user task and deploy or delegate to the best specialized agent archetype:

1. **GNOME Shell & System Compositor (`gnome-shell-expert`)**:
   - Focus: GJS internals, Mutter compositor lifecycle, Clutter actor hierarchies, SignalGroup bindings, GSettings schemas, and third-party extensions (Blur My Shell).
   - Use for: Freezes, crashes, circular relayout loops, signal re-entrancy, memory leaks, and desktop stability.

2. **Dock Motion & Physics Design (`dock-motion-specialist`)**:
   - Focus: Gaussian magnification physics, SpringSolver mathematics, Clutter easing curves, sequential wave/stagger cascades, and macOS-grade UI smoothness.
   - Use for: Magnification tuning, fan/grid/list opening and closing animations, demagnification on open, and high-refresh-rate responsiveness.

3. **QA & Packaging Verification (`qa-verification-engineer`)**:
   - Focus: Running `./scripts/validate.sh`, `AQUA_RUN_PREFS_SMOKE=1 ./scripts/validate.sh`, `./scripts/package.sh`, `./scripts/audit-package.sh`, and `journalctl /usr/bin/gnome-shell`.
   - Use for: Full regression testing, schema compilation, ZIP packaging audits, and journal diagnostics before releasing.

4. **Codebase Exploration (`research`)**:
   - Focus: Surveying multi-file interactions, tracing symbol references, or inspecting documentation.

## Development & Deployment Rules
- **No Unchecked Regressions**: Run `./scripts/validate.sh` after every modification.
- **Maintain Versioning**: Always increment version in `metadata.json` and document entries in `CHANGELOG.md`.
- **Sync & Package**: Ensure schemas are compiled and files deployed to `~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque/`.
- **Commit & Push**: All validated changes must be committed and pushed to `origin/main`.
