# Contributing

Keep changes focused, event-driven, and compatible with the extension lifecycle.

- Every signal, timeout, file monitor, cancellable, and actor needs one clear owner and a teardown path.
- Do not read GSettings or allocate objects in the animation hot path.
- New behavior must use a schema key with a backward-compatible default.
- Never rename or remove a settings key without a versioned migration.
- Keep normal visual defaults stable unless a visual change is intentional.
- Update `CHANGELOG.md` and increment `metadata.json` for every delivered revision.

Run the complete local check before submitting a change:

```bash
scripts/validate.sh
```

For a preferences construction check, run from a graphical session:

```bash
AQUA_RUN_PREFS_SMOKE=1 scripts/validate.sh
```
