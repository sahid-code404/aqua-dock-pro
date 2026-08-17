#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output_dir=${1:-"$project_root/dist"}

"$project_root/scripts/validate.sh"
mkdir -p "$output_dir"

extra=()
extra+=(--extra-source=LICENSE)
for directory in animation autohide compat core dock downloads effects interactions menus prefs services ui; do
    [[ -d "$project_root/$directory" ]] || continue
    extra+=(--extra-source="$directory")
done

translations=()
if compgen -G "$project_root/po/*.po" >/dev/null; then
    translations=(--podir=po --gettext-domain=aqua-dock-pro)
fi

gnome-extensions pack "$project_root" \
    --force \
    --out-dir="$output_dir" \
    --schema=schemas/org.gnome.shell.extensions.aqua-dock-pro.gschema.xml \
    "${translations[@]}" \
    "${extra[@]}"

printf 'Bundle written to %s/aqua-dock-pro@shaque.shell-extension.zip\n' "$output_dir"
