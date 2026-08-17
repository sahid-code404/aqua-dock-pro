# Translations

Run `po/update-pot.sh` after changing user-visible text. Copy the generated template to `<locale>.po`, translate it, and keep placeholders such as `%s` and `%d` unchanged.

The package script automatically compiles every `po/*.po` catalog into the extension bundle.
