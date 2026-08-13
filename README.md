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

[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-50-5294E2?style=for-the-badge\&logo=gnome\&logoColor=white)](https://extensions.gnome.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-GJS-F7DF1E?style=for-the-badge\&logo=javascript\&logoColor=black)](https://gjs.guide/)
[![GTK](https://img.shields.io/badge/GTK-4.0-4A90D9?style=for-the-badge\&logo=gtk\&logoColor=white)](https://gtk.org)
[![License](https://img.shields.io/badge/License-MIT-00C9C8?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-WIP-orange?style=for-the-badge)](https://github.com/sahid-code404/aqua-dock-pro)
[![Wayland](https://img.shields.io/badge/Wayland-Tested-7C5CFC?style=for-the-badge)](https://wayland.freedesktop.org)

<br/>

> ⚠️ **Work in progress:** There are bugs and unfinished parts. I'm still testing and fixing things regularly.

</div>

---

## ✦ Aqua Dock Pro

**Aqua Dock Pro** is a GNOME Shell dock with magnification, animations, window previews, a Downloads stack, notification badges, intellihide and plenty of customization.

Currently made mainly for **GNOME Shell 50 + Wayland**.

> 🧪 Around **3–4 months of work and 230+ install/test/debug cycles** so far.

> 🤖 **AI disclosure:** I use AI tools for coding help, debugging, refactoring, GNOME/GJS API help and some documentation, and I test and fix the results myself.

---

## 📸 Current Look

### ✦ Main Dock

<p align="center">
  <img width="2560" height="1600" alt="Aqua Dock Pro Main Dock" src="https://github.com/user-attachments/assets/41a620ce-e300-4670-bd23-d7519eefcdbe" />
</p>

### ✦ Downloads Stack

<p align="center">
  <img width="2560" height="1600" alt="Aqua Dock Pro Downloads Stack" src="https://github.com/user-attachments/assets/e236ea04-3e64-4512-9c67-2d1cedcae073" />
</p>

> Screenshots are from the current development build, so some things may change later.

---

# ⚡ Quick Install

### GNOME Shell 50

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

**Wayland:** Log out and back in once after installing.

**X11:** Use **Alt + F2 → `r` → Enter**.

---

# ✦ Features

## 🎯 Dock

* Bottom, left and right positions
* Adjustable icon size
* Dock thickness
* Floating spacing
* Corner radius
* Background opacity
* Border color and width
* Custom icon spacing

---

## ✨ Magnification & Motion

Magnification and animation are two of the parts I care about most.

* Gaussian-style magnification
* Spring-based movement
* Adjustable tension and damping
* Hover lift
* Smooth icon scaling
* Launch bounce
* Attention animation
* Download animation

Most of this can be changed from Preferences.

---

## 🪄 Genie Minimize / Restore

Experimental Genie-style minimize and restore animation that tries to visually connect a window with its dock icon.

This is still experimental and doesn't behave perfectly with every window or setup.

---

## 📂 Downloads Stack

Open recent downloads directly from the dock.

| View     | Description                     |
| -------- | ------------------------------- |
| **Fan**  | Spreads recent files into a fan |
| **Grid** | Thumbnail grid                  |
| **List** | Simple compact list             |

It currently supports:

* Recent-file ordering
* Image thumbnails
* File-type icons
* Automatic updates
* Mouse and keyboard navigation
* Overflow handling
* Open/close animations
* Bounce when a new download appears

---

## 🪟 Window Previews

Hover over a running app to see its windows.

* Live previews
* Multiple windows
* Minimized windows
* Windows from other workspaces
* Click to activate
* Adjustable preview size
* Adjustable hover delay

---

## 🗂 Context Menus

Right-click an app icon for actions such as:

* New Window
* Desktop Actions
* Pin / Unpin
* Window List
* Quit Application
* App-specific actions

Downloads and Trash also have their own menu actions.

---

## 🔔 Notification Badges

Unread notification counts can appear directly on app icons.

* Live count updates
* Show/hide badges
* Custom badge color
* Custom text color

Some apps may behave differently depending on how they send notifications.

---

## ⚫ Running Indicators

Choose how running applications are shown.

| Style             | Preview |
| ----------------- | ------- |
| **Single Dot**    | `•`     |
| **Multiple Dots** | `• • •` |
| **Line**          | `———`   |
| **Pill**          | `(———)` |
| **Glow**          | `✦`     |
| **Glow Dots**     | `✦ ✦ ✦` |

Size and color can be changed too.

---

## 🖱 Mouse Interaction

**Left click**

* Open or focus an app
* Minimize the active window
* Switch between windows

**Middle click**

* Open a new window

**Scroll**

* Cycle through app windows

**Hover**

* Magnification
* Lift
* Tooltips
* Window previews

---

## 📌 Drag & Drop

* Reorder pinned apps
* Move icons around the dock
* Drag apps into the dock
* Insertion indicator
* Drop highlighting

There are still a few drag-and-drop edge cases I'm working on.

---

## 👓 Auto-Hide & Intellihide

| Mode            | Behaviour                                |
| --------------- | ---------------------------------------- |
| **Never**       | Dock stays visible                       |
| **Intellihide** | Hides when a window overlaps it          |
| **Always**      | Hides until the screen edge is triggered |

You can also change reveal delay, hide delay and edge behaviour.

---

## 🗑 Trash

* Empty/full icon
* Automatic updates
* Open Trash
* Empty Trash

---

## 📥 Downloads Monitoring

* Detect new files
* Update the stack automatically
* Bounce on new downloads
* Generate thumbnails
* File-type icons

---

# ⚙️ Preferences

Aqua Dock Pro has a GTK 4 / LibAdwaita preferences window.

| Page          | What you can change                                  |
| ------------- | ---------------------------------------------------- |
| **Dock**      | Size, position, spacing, opacity, radius and borders |
| **Motion**    | Magnification, tension, damping and hover lift       |
| **Behavior**  | Auto-hide, clicking and scrolling                    |
| **Widgets**   | Badges, indicators, previews and tooltips            |
| **Downloads** | Stack behaviour and thumbnails                       |
| **About**     | Version and project info                             |

---

# 🧩 Project Structure

The extension is split into separate folders so the different parts don't all live in one huge file.

| Folder         | Contains                                   |
| -------------- | ------------------------------------------ |
| `animation`    | Motion and bounce animations               |
| `autohide`     | Intellihide and visibility                 |
| `core`         | Shared state and helpers                   |
| `dock`         | Dock UI and layout                         |
| `downloads`    | Downloads stack                            |
| `effects`      | Genie effect                               |
| `interactions` | Mouse, drag-and-drop and app actions       |
| `menus`        | Context menus                              |
| `prefs`        | Preferences UI                             |
| `schemas`      | GSettings                                  |
| `services`     | App, file, notification and Trash handling |
| `ui`           | Window previews and other UI               |

The structure is still changing as the project grows.

---

# 🛠 Technology

|                    |                          |
| ------------------ | ------------------------ |
| **GNOME**          | GNOME Shell 50           |
| **Language**       | JavaScript / GJS         |
| **Modules**        | ES Modules               |
| **Shell UI**       | St                       |
| **Animation**      | Clutter                  |
| **Preferences**    | GTK 4 + LibAdwaita       |
| **APIs**           | GObject Introspection    |
| **Files / Events** | Gio + GLib               |
| **Settings**       | GSettings                |
| **Session**        | Mainly tested on Wayland |

---

# 📈 Performance

Performance is still something I'm testing.

I'm trying to keep background work low and avoid doing unnecessary work while the dock is idle. If you notice high CPU/RAM usage, stuttering, lag or anything strange, please open an issue.

---

# 🐛 Known Issues

**It has bugs.**

The areas I'm still working on most are animations, intellihide, window previews, drag-and-drop, multi-monitor behaviour and the Downloads stack.

Different hardware, scaling settings and GNOME setups may also expose problems I haven't seen yet.

I'll keep fixing them as I find them.

---

# 🧪 Tested On

|                  |                           |
| ---------------- | ------------------------- |
| **Distribution** | Fedora Linux              |
| **GNOME**        | GNOME Shell 50            |
| **Session**      | Wayland                   |
| **Graphics**     | Intel integrated graphics |

I'd especially like to hear how it works on:

* AMD
* NVIDIA
* Multiple monitors
* Fractional scaling
* Other Linux distributions
* Vertical dock layouts

---

# 💬 Feedback

If you try it, I'd really like feedback on **performance, animations, bugs, intellihide and how the dock actually feels to use**.

If something looks wrong or you know a better way to do something in GNOME/GJS, feel free to point it out.

---

# 📝 Bug Reports

When reporting a bug, things like your **GNOME version, distro, Wayland/X11, GPU, scaling and dock position** are useful.

Please also explain what happened and how to reproduce it if possible.

Screenshots, videos and GNOME Shell logs help a lot.

---

# 🗺 Development

For now I'm mainly fixing bugs, improving animations and intellihide, working on multi-monitor behaviour and cleaning up the code.

There's no strict roadmap yet.

---

# 🤝 Contributions

Issues, testing, suggestions and code reviews are welcome.

Even just trying the extension on a different setup and telling me what works or breaks helps.

---

# ⚖️ License

Released under the **MIT License**.

You can use, modify and distribute Aqua Dock Pro under the terms of the license.

See [`LICENSE`](LICENSE).

---

# 👤 Author

<div align="center">

### Sahidul Haque

[![GitHub](https://img.shields.io/badge/GitHub-sahid--code404-181717?style=flat-square\&logo=github)](https://github.com/sahid-code404)

[![Project](https://img.shields.io/badge/Aqua_Dock_Pro-Repository-00C9C8?style=flat-square\&logo=gnome)](https://github.com/sahid-code404/aqua-dock-pro)

<br/>

### Like the dock?

If you use Aqua Dock Pro and enjoy it, a ⭐ is always appreciated. 😊

Found a bug? **Open an issue — I'll keep working on it.**

<br/>

**Made with ❤️ for GNOME.**

</div>
