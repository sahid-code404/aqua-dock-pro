#!/usr/bin/env bash
set -euo pipefail

bundle=${1:?Usage: scripts/audit-package.sh path/to/extension.zip}
[[ -f "$bundle" ]] || {
    printf 'Package not found: %s\n' "$bundle" >&2
    exit 1
}

mapfile -t entries < <(unzip -Z1 "$bundle")
((${#entries[@]})) || {
    printf 'Package is empty.\n' >&2
    exit 1
}

for required in \
    metadata.json \
    extension.js \
    prefs.js \
    stylesheet.css \
    schemas/org.gnome.shell.extensions.aqua-dock-pro.gschema.xml \
    schemas/org.gnome.shell.extensions.aqua-dock-pro.native-blur.gschema.xml; do
    printf '%s\n' "${entries[@]}" | grep -Fxq "$required" || {
        printf 'Required package file missing: %s\n' "$required" >&2
        exit 1
    }
done

for entry in "${entries[@]}"; do
    [[ "$entry" == */ ]] && continue
    top=${entry%%/*}
    case "$top" in
        animation|autohide|compat|core|dock|downloads|effects|interactions|menus|prefs|services|ui|locale|schemas)
            ;;
        extension.js|prefs.js|metadata.json|stylesheet.css|LICENSE)
            ;;
        *)
            printf 'Unexpected top-level package content: %s\n' "$entry" >&2
            exit 1
            ;;
    esac

    case "$entry" in
        tests/*|scripts/*|.github/*|.git/*|po/*|node_modules/*|__pycache__/*|\
        *.po|*.pot|*.map|*.sh|*.py|*.pyc|*.so|*.dll|*.exe|\
        package.json|package-lock.json|README.md|CHANGELOG.md|CONTRIBUTING.md|SUPPORT.md|\
        schemas/gschemas.compiled)
            printf 'Development-only or EGO-disallowed file leaked into package: %s\n' "$entry" >&2
            exit 1
            ;;
    esac
done

metadata=$(mktemp)
trap 'rm -f "$metadata"' EXIT
unzip -p "$bundle" metadata.json >"$metadata"

jq -e '
    .uuid == "aqua-dock-pro@shaque" and
    .name == "AquaDockPro" and
    .url == "https://github.com/sahid-code404/aqua-dock-pro" and
    ."shell-version" == ["50", "51"] and
    (."session-modes"? == null)
' "$metadata" >/dev/null || {
    printf 'Packaged metadata is not EGO-compatible for GNOME Shell 50 and 51.\n' >&2
    exit 1
}

printf 'Package audit passed (%d files).\n' "${#entries[@]}"
