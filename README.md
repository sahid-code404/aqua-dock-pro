<div align="center">

<br/>

```
 █████╗  ██████╗ ██╗   ██╗ █████╗     ██████╗  ██████╗  ██████╗██╗  ██╗
██╔══██╗██╔═══██╗██║   ██║██╔══██╗    ██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝
███████║██║   ██║██║   ██║███████║    ██║  ██║██║   ██║██║     █████╔╝ 
██╔══██║██║▄▄ ██║██║   ██║██╔══██║    ██║  ██║██║   ██║██║     ██╔═██╗ 
██║  ██║╚██████╔╝╚██████╔╝██║  ██║    ██████╔╝╚██████╔╝╚██████╗██║  ██╗
╚═╝  ╚═╝ ╚══▀▀═╝  ╚═════╝ ╚═╝  ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝╚═╝  ╚═╝
                                                                    PRO
```

**A premium, physics-driven dock for GNOME Shell — built for Linux, designed to impress.**

<br/>

[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-50-5294E2?style=for-the-badge&logo=gnome&logoColor=white)](https://extensions.gnome.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![GTK](https://img.shields.io/badge/GTK-4.0-4A90D9?style=for-the-badge&logo=gtk&logoColor=white)](https://gtk.org)
[![License](https://img.shields.io/badge/License-MIT-00C9C8?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-Active-00D26A?style=for-the-badge)](https://github.com/sahid-code404/aqua-dock-pro)
[![Wayland](https://img.shields.io/badge/Wayland-✓-7C5CFC?style=for-the-badge)](https://wayland.freedesktop.org)

<br/>

> *Deliver a premium desktop experience while remaining lightweight, modular, and fully native to GNOME Shell.*

<br/>

</div>


<img width="3199" height="1999" alt="Screenshot From 2026-06-26 05-02-50" src="https://github.com/user-attachments/assets/f0d60c6e-9dab-4c2c-aa87-43465d234e79" />
<img width="3199" height="1999" alt="Screenshot From 2026-06-26 05-03-16" src="https://github.com/user-attachments/assets/3993363c-eedf-43cd-8a6c-f9544c7551a0" />

---
## ✦ What is AquaDockPro?

AquaDockPro is a **complete rewrite** of the GNOME dock experience — not a fork, not a theme, but a ground-up engineering effort.

Built on a **spring-physics animation engine**, a **modular event-driven architecture**, and **native GNOME compositor APIs**, it brings a level of polish and performance that traditional GNOME extensions simply don't offer.

| | |
|---|---|
| 🎯 **Premium UX** | Gaussian magnification, spring physics, Genie minimize effects |
| ⚡ **Engineered for performance** | Frame-synced rendering, zero polling loops, GPU-friendly compositing |
| 🧩 **Fully modular** | Every subsystem is decoupled and independently configurable |
| 🔧 **Deep customization** | 50+ settings across appearance, behavior, animations, and widgets |

---

## ⚡ Quick Install

```bash
# Clone the repository
git clone https://github.com/sahid-code404/aqua-dock-pro.git
cd aqua-dock-pro

# Install to your GNOME extensions directory
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r . ~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque

# Compile GSettings schemas
glib-compile-schemas ~/.local/share/gnome-shell/extensions/aqua-dock-pro@shaque/schemas

# Enable the extension
gnome-extensions enable aqua-dock-pro@shaque
```

> **🟣 Wayland** — Log out and back in after installation.  
> **🔵 X11** — Press `Alt + F2`, type `r`, press `Enter`.

---

## ✦ Feature Overview

### 🎯 Dock

A beautifully crafted floating dock that feels like it belongs on your desktop.

- Position: **Bottom**, **Left**, or **Right**
- Configurable icon size, dock thickness, and corner radius
- Background opacity control with custom border color and width
- Automatic layout recalculation and floating edge spacing

---

### ✨ Animation Engine

Powered by a custom **spring-physics solver** — not CSS transitions, not tweens.

- Gaussian magnification on hover
- Configurable spring damping and tension
- Adjustable hover lift with smooth interpolation
- Frame-synchronized rendering (no dropped frames)
- **Launch**, **attention**, and **download** bounce animations


---

### 📂 Downloads Stack

A polished Downloads folder stack, right in your dock.

| View Mode | Description |
|-----------|-------------|
| **Fan View** | Fanned card layout for quick visual scanning |
| **Grid View** | Thumbnail grid for image-heavy folders |
| **List View** | Compact list with metadata |

Additional features: keyboard & mouse navigation, recent file ordering, automatic thumbnails, content-type icons, overflow handling, animated open/close.

---

### 🪟 Live Window Previews

See what's running before you switch — without leaving the dock.

- Live compositor thumbnails (not screenshots)
- Multi-window and minimized window previews
- Cross-workspace previews
- Click-to-activate with animated popup
- Configurable preview size and hover delay

---

### 🗂 Context Menus

Native GNOME popup menus for every item in the dock.

```
Right-click any dock icon →
  ├── New Window
  ├── Desktop Actions
  ├── Pin / Unpin
  ├── Window List
  ├── Quit Application
  ├── Downloads Menu
  └── Trash Menu → Empty Trash
```

---

### 🔔 Notification Badges

Live unread counts on your dock icons, sourced directly from the GNOME notification system.

- Native GNOME notification integration
- Live count updates
- Configurable badge and text color
- Badge visibility toggle

---

### ⚫ Running Indicators

Six styles to mark your active applications:

| Style | Preview |
|-------|---------|
| Single Dot | `•` |
| Multiple Dots | `• • •` |
| Line | `———` |
| Pill | `(———)` |
| Glow | `✦` |
| Glow Dots | `✦ ✦ ✦` |

Fully customizable size and color.

---

### 🖱 Smart Mouse Interaction

Every click, scroll, and drag is handled intelligently.

- Click to minimize active windows
- Smart window cycling when clicking a running app
- Middle-click to open a new window
- Scroll to cycle through windows
- Drag to launch or restore
- Hover magnification and lift

---

### 📌 Drag & Drop

Reorder your dock on the fly.

- Drag pinned apps to reorder
- Pin apps by dragging from the GNOME Overview
- Animated drag preview and insertion indicator
- Drop zone highlighting
- Smart launch when dropped outside the dock

---

### 👓 Auto-Hide

Three modes — pick what suits your workflow.

| Mode | Behavior |
|------|----------|
| **Never** | Dock is always visible |
| **Intellihide** | Hides only when a window overlaps |
| **Always** | Hides until you push to the edge |

Pressure reveal, configurable reveal/hide delay, edge detection.

---

### 🗑 Trash & Downloads Monitoring

The dock keeps an eye on your file system so you don't have to.

- **Trash** — Live full/empty icon, directory monitoring, bounce on new items
- **Downloads** — Auto-detection, bounce on new files, thumbnail generation, dynamic stack

---

### ⚙️ Preferences

A full **Adwaita preferences window** — no config files, no terminal tweaks.

| Page | What You Configure |
|------|--------------------|
| **Dock** | Size, position, radius, opacity, borders |
| **Motion** | Spring tension, damping, magnification, lift |
| **Behavior** | Auto-hide mode, click actions, scroll behavior |
| **Widgets** | Badges, indicators, tooltips, previews |
| **Downloads** | Stack view, thumbnail size, bounce behavior |
| **About** | Version, links, credits |

---

## 🏗 Architecture

AquaDockPro is organized into focused, decoupled modules — each responsible for exactly one domain.

```
AquaDockPro/
│
├── animation/          # Spring solver, bounce engine, frame scheduler, easing
├── autohide/           # Visibility controller, overlap detector, pressure barrier
├── core/               # Event bus, state manager, settings cache, constants
├── dock/               # Dock widget, layout engine, item rendering, factory
├── downloads/          # File enumeration, stack UI, fan/grid/list views, keyboard nav
├── effects/
│   └── genie/          # Native minimize/restore compositor animation
├── interactions/       # App actions, drag & drop manager, tooltip manager
├── menus/              # Context menu actions and GNOME popup integration
├── prefs/
│   ├── pages/          # One file per preferences page
│   └── widgets/        # Reusable Adwaita row components
├── schemas/            # GSettings XML schema
├── services/           # App tracker, file service, notification watcher, trash monitor
├── ui/
│   └── preview/        # Live window thumbnail system
│
├── extension.js        # Extension entry point
├── prefs.js            # Preferences entry point
├── metadata.json       # Extension metadata
└── stylesheet.css      # Clutter/St stylesheet
```

---

## 🛠 Technology Stack

| Layer | Technology |
|-------|-----------|
| Shell Integration | GNOME Shell 50, GJS, St Toolkit, Clutter |
| UI Framework | GTK 4, LibAdwaita |
| System APIs | GObject Introspection, Gio, GLib |
| Language | JavaScript (ES Modules) |

---

## 📈 Performance

AquaDockPro was engineered around performance from day one — not retrofitted.

| Concern | Approach |
|---------|----------|
| Animation | Frame-synchronized via `requestAnimationFrame`-equivalent, no `setInterval` loops |
| Settings | Cached GSettings reads — no redundant dconf calls per frame |
| Memory | Minimal allocations in hot paths, pooled where possible |
| Rendering | GPU-friendly native compositor paths, no shader hacks |
| File I/O | Fully asynchronous with batched enumeration |
| Updates | Event-driven — components update only when state actually changes |

---

## ⚖️ License

Released under the **MIT License** — free to use, modify, and distribute.  
See [`LICENSE`](LICENSE) for the full text.

---

## 👤 Author

**Sahidul Haque**

[![GitHub](https://img.shields.io/badge/GitHub-sahid--code404-181717?style=flat-square&logo=github)](https://github.com/sahid-code404)
[![Project](https://img.shields.io/badge/Project-aqua--dock--pro-00C9C8?style=flat-square&logo=gnome)](https://github.com/sahid-code404/aqua-dock-pro)

---

<div align="center">

**Built with ❤️ for the GNOME desktop community**

*If AquaDockPro makes your desktop feel a little more yours — consider leaving a ⭐ on the repo.*

</div>
