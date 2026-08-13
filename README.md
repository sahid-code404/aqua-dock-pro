<div align="center">

<br/>

```text
 █████╗  ██████╗ ██╗   ██╗ █████╗     ██████╗  ██████╗  ██████╗██╗  ██╗
██╔══██╗██╔═══██╗██║   ██║██╔══██╗    ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝
███████║██║   ██║██║   ██║███████║    ██║  ██║██║   ██║██║     █████╔╝
██╔══██║██║▄▄ ██║██║   ██║██╔══██║    ██║  ██║██║   ██║██║     ██╔═██╗
██║  ██║╚██████╔╝╚██████╔╝██║  ██║    ██████╔╝╚██████╔╝╚██████╗██║  ██╗
╚═╝  ╚═╝ ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝
                                                                    PRO
```

### A modern dock for GNOME, built to feel smooth and responsive.

**Made with ❤️ for GNOME. Give it a try — I hope you enjoy using it 😊**

<br/>

[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-50-5294E2?style=for-the-badge&logo=gnome&logoColor=white)](https://extensions.gnome.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-GJS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://gjs.guide/)
[![GTK](https://img.shields.io/badge/GTK-4.0-4A90D9?style=for-the-badge&logo=gtk&logoColor=white)](https://gtk.org)
[![License](https://img.shields.io/badge/License-MIT-00C9C8?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-WIP-orange?style=for-the-badge)](https://github.com/sahid-code404/aqua-dock-pro)

<br/>

> ⚠️ **Work in progress:** There are still bugs and unfinished parts. I'm testing and fixing things regularly.

</div>

---

## ✦ Aqua Dock Pro

Aqua Dock Pro is a customizable GNOME Shell dock with smooth magnification, spring-based motion, live window previews, intellihide, folder stacks, notification badges, mounted devices and multi-monitor support.

Currently focused on **GNOME Shell 50 + Wayland**.

> 🧪 Around **3–4 months of work and 230+ install/test/debug cycles** so far.  
> 🤖 **AI disclosure:** I use AI tools for coding help, debugging, refactoring, GNOME/GJS API help and some documentation, and I test and fix the results myself.

---

#📸 Preview

<p align="center">
  <img width="2560" height="1600" alt="Aqua Dock Pro Main Dock" src="https://github.com/user-attachments/assets/41a620ce-e300-4670-bd23-d7519eefcdbe" />
</p>

Downloads Stack

<p align="center">
  <img width="2560" height="1600" alt="Aqua Dock Pro Downloads Stack" src="https://github.com/user-attachments/assets/e236ea04-3e64-4512-9c67-2d1cedcae073" />
</p>

Screenshots are from the current development build, so some details may change.

---

## ⚡ Quick Install

Copy the whole block and paste it into the terminal once:

```bash
tmpdir="$(mktemp -d)" && \
git clone https://github.com/sahid-code404/aqua-dock-pro.git "$tmpdir" && \
mkdir -p ~/.local/share/gnome-shell/extensions && \
rm -rf ~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque && \
cp -a "$tmpdir"/. ~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque/ && \
rm -rf ~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque/.git && \
glib-compile-schemas ~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque/schemas && \
gnome-extensions enable aqua-dock-pro@shaque && \
rm -rf "$tmpdir"
```

**Wayland:** log out and back in once after installing.  
**X11:** use **Alt + F2 → `r` → Enter**.

---

## ✨ Highlights

| | |
|---|---|
| **Dock** | Bottom / left / right, start / center / end alignment, floating spacing, custom size and styling |
| **Motion** | Gaussian magnification, spring physics, hover lift, launch / attention / download bounce |
| **Windows** | Live previews, Genie-style minimize/restore, monitor and workspace isolation |
| **Hide modes** | Never, Intellihide, Always, plus pressure reveal |
| **Files** | Downloads stack, custom folder stack, Trash and mounted devices |
| **Interaction** | Mouse actions, keyboard navigation, drag-and-drop, context menus |
| **Appearance** | Notification badges, 6 running indicator styles, colors, borders, radius and opacity |
| **Settings** | GTK 4 / Libadwaita preferences, backup/restore and reset |

---

## ⌨️ Keyboard Navigation

| Shortcut | Action |
|---|---|
| **Super + D** | Focus the dock |
| **← / →** | Move across a horizontal dock |
| **↑ / ↓** | Move across a vertical dock |
| **Enter / Space** | Open or activate the selected item |
| **Escape** | Exit focus mode or close an open popup/stack |

---

## 🧩 Features

### Dock & Motion

- Bottom, left and right positions
- Start, center and end alignment
- Independent dock on each monitor
- Optional monitor/workspace isolation
- Icon size **24–128 px**
- Dock scale **0.5×–2.0×**
- Corner radius **0–40 px**
- Custom pill color, opacity, border and spacing
- Gaussian magnification up to **3.5×**
- Adjustable magnification curve and spread
- Spring tension and damping
- Hover lift up to **24 px**
- Launch, attention and download bounce animations

### Windows & Visibility

- Live compositor window previews
- Minimized/hidden window previews
- Cross-workspace previews
- Optional close button on preview thumbnails
- Genie-style minimize and restore animation
- Never / Intellihide / Always hide modes
- Reveal and hide delays
- Pressure reveal with adjustable sensitivity

### Files, Folders & Devices

- Downloads stack
- Optional custom folder stack
- Fan / Grid / List views
- Sort by Newest / Name / Type
- Thumbnails and file-type icons
- Live file watching
- Trash full/empty state and Empty Trash action
- Mounted USB drives, phones, cameras and network mounts
- Hide individual mounted devices from the dock

### Mouse & Drag-and-Drop

- Smart left-click behavior
- Minimize / cycle / preview / no-action modes
- Middle-click actions
- Scroll to cycle or minimize/restore windows
- Reorder pinned apps
- Drag apps from GNOME Overview to pin them
- Drag files onto app icons
- Move the Applications button
- Layout lock to prevent accidental changes

### Indicators & Menus

- Notification count badges
- Custom badge colors
- 6 running indicator styles
- App desktop actions
- Pin / Unpin
- Window list
- Quit Application
- Downloads / Trash context actions

---

## ⚙️ Preferences

Aqua Dock Pro uses a native **GTK 4 / Libadwaita** preferences window.

| Page | Includes |
|---|---|
| **Dock** | Position, alignment, size, scale, spacing, opacity, radius, borders |
| **Motion** | Magnification, spring tuning, hover lift, animation timing |
| **Behavior** | Auto-hide, pressure reveal, click/scroll actions, workspace/monitor behavior |
| **Widgets** | Badges, indicators, previews, tooltips |
| **Downloads** | Stack view, sorting, thumbnails, custom folder |
| **Devices** | Mounted-device behavior |
| **About** | Version and project information |

Settings can also be **exported/imported as JSON** or reset to defaults.

---

## 🛠 Under the Hood

| | |
|---|---|
| **GNOME** | GNOME Shell 50 |
| **Language** | JavaScript / GJS |
| **Shell UI** | St + Clutter |
| **Preferences** | GTK 4 + Libadwaita |
| **System APIs** | GObject Introspection |
| **Files / Events** | Gio + GLib |
| **Settings** | GSettings |
| **Session** | Mainly tested on Wayland |

<details>
<summary><b>Project structure</b></summary>

<br/>

| Folder | Contains |
|---|---|
| `animation` | Magnification, spring motion and bounce |
| `autohide` | Visibility, overlap detection and pressure reveal |
| `compat` | GNOME Shell compatibility helpers |
| `core` | Shared state, settings and helpers |
| `dock` | Dock UI and layout |
| `downloads` | Downloads and custom folder stacks |
| `effects` | Genie effect |
| `interactions` | Mouse, keyboard and drag-and-drop |
| `menus` | Context menus |
| `prefs` | Preferences UI |
| `schemas` | GSettings |
| `services` | Apps, files, notifications, Trash and devices |
| `ui` | Window previews and other UI |

</details>

---

## 🐛 Status

**It has bugs.**

The areas I'm still working on most are **animations, intellihide, window previews, drag-and-drop, multi-monitor behavior and folder stacks**.

### Tested on

- Fedora Linux
- GNOME Shell 50
- Wayland
- Intel integrated graphics

Testing on **AMD, NVIDIA, multiple monitors, fractional scaling, other distros and vertical layouts** is very welcome.

---

## 💬 Feedback & Contributions

If you try it, I'd really like feedback on **performance, animations, bugs, keyboard navigation, multi-monitor behavior and how the dock feels to use**.

Issues, testing, suggestions and code reviews are welcome.

When reporting a bug, please include your **GNOME version, distro, Wayland/X11, GPU, scaling, monitor setup and dock position** if possible. Screenshots, videos and GNOME Shell logs help a lot.

---

## ⚖️ License

Released under the **MIT License**. See [`LICENSE`](LICENSE).

---

<div align="center">

### Sahidul Haque

[![GitHub](https://img.shields.io/badge/GitHub-sahid--code404-181717?style=flat-square&logo=github)](https://github.com/sahid-code404)
[![Project](https://img.shields.io/badge/Aqua_Dock_Pro-Repository-00C9C8?style=flat-square&logo=gnome)](https://github.com/sahid-code404/aqua-dock-pro)

<br/>

If Aqua Dock Pro works well for you, a ⭐ is always appreciated. 😊

**Made with ❤️ for GNOME.**

</div>
