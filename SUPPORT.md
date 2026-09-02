# Support

AquaDockPro targets GNOME Shell 50 and GNOME Shell 51 on Wayland. The same
extension package keeps GNOME 50 behavior intact while using guarded GNOME 51
compatibility paths where Shell APIs changed. Xwayland applications are
supported, but GNOME Shell 50 no longer provides an X11 session.

GNOME 51 is still in its pre-release cycle as of this compatibility update. The
repository and GitHub package metadata advertise `51` so Fedora 45 / GNOME 51
users can install and test the extension normally. extensions.gnome.org release
publication remains subject to EGO accepting the GNOME 51 target.

Before reporting a problem:

1. Install the newest release and log out and back in.
2. Reproduce with the default settings when possible.
3. Open Preferences → About → **Copy Diagnostics**.
4. Include the exact steps, dock position, auto-hide mode, monitor layout, and relevant journal messages.

Useful log command:

```bash
journalctl --user -b -o cat | rg 'AquaDockPro|JS ERROR|Extension'
```

Do not include a settings export in a public issue unless you have reviewed it; exports may contain local folder paths and device identifiers. The copied diagnostic report contains setting names only, never their values.
