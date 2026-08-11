# Support

AquaDockPro currently targets GNOME Shell 50 on Wayland and X11.

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
