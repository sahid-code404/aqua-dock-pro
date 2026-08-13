# Support

AquaDockPro currently targets GNOME Shell 50 and the GNOME Shell 51 beta on
Wayland. Xwayland applications are supported, but GNOME Shell 50 no longer
provides an X11 session. The stable `51` metadata entry will be shipped only
after GNOME 51.0 is released and retested.

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
