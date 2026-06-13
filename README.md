# 🐱 Desktop Cat

A living desktop companion that sits on your screen. Built with Electron — transparent, always-on-top, uses <30MB RAM at idle.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run in development
npm start
```

The cat will appear on your screen. Drag it anywhere. It lives on top of all windows.

---

## Build for Distribution

```bash
# Build for your current platform
npm run build

# Target specific platforms
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

Outputs land in `dist/`.

> **Note:** For Windows, you need `tray-icon.ico`. For macOS, `tray-icon.icns`. Place them in `src/assets/`. You can generate these from the SVG using tools like Inkscape or online converters.

---

## What the Cat Does

### States

| State | Trigger |
|-------|---------|
| **Idle** | Default — slow breathing, tail sway, occasional blink |
| **Walk** | Dragging the cat |
| **Typing** | ≥2 keypresses/sec for 1+ second |
| **Scroll** | Mouse wheel detected |
| **Hungry** | 4 hours since last feed |
| **Eating** | Clicking cat when hungry |
| **Overfed** | 3 rapid clicks while hungry |
| **Sleeping** | 20+ min idle, or post-overfed |
| **Playing** | Random every 15–30 min |
| **Angry** | 15 min idle with no interaction |
| **Startled** | App focus or resume from suspend |
| **Sunbathing** | Same position for 10+ min |

### Extras
- **Random speech bubbles** float above the cat every 8–15 min
- **Yawn** animation every 8–12 min while idle
- **Sneeze** 1% chance per minute while idle
- **Mirror stare** ~once/hour: cat stares directly at you
- **Moonlight mode**: after 11pm, crescent moon appears on forehead, animations slow
- **XP system**: interactions earn XP → unlock accessories (bow @ 7 days, bandana @ 14, crown @ 30)

### Feeding
- Right-click tray → "Feed cat" OR click the cat directly when hungry
- 3 rapid clicks = overfed → slumped/sleepy state with funny speech bubble

---

## System Tray Menu

Right-click the tray icon (cat face) for:

- 🍖 **Feed cat** — reset hunger timer
- ⏰ **Wake up** — wake from sleep
- 👁 **Show/Hide cat** — toggle visibility
- 📐 **Cat size** — Small (32px) / Medium (48px) / Large (64px)
- 🚀 **Launch on startup** — toggle auto-start
- ❌ **Quit**

---

## Config File

Saved to your OS's userData directory:

| OS | Path |
|----|------|
| Windows | `%APPDATA%\desktop-cat\cat-config.json` |
| macOS | `~/Library/Application Support/desktop-cat/cat-config.json` |
| Linux | `~/.config/desktop-cat/cat-config.json` |

```json
{
  "x": 1200,
  "y": 800,
  "size": 48,
  "lastFed": 1718000000000,
  "xp": 0,
  "accessories": [],
  "launchOnStartup": false,
  "visible": true
}
```

---

## Adding New Poses

1. **Open `src/cat.svg`** and add a new `<g id="pose-yourpose">` group alongside the existing pose groups. Follow the same structure: body, head, tail, paws.

2. **Register in `src/cat.js`** — add your pose name to the `POSES` array at the top.

3. **Add CSS animations** in `src/styles.css` — target `#pose-yourpose.active` with your keyframes.

4. **Trigger it** from cat.js by calling `setPose('yourpose')` based on whatever condition you want.

---

## Adding New Accessories

1. Add a `<g id="accessory-youritem">` group in `cat.svg` positioned to sit on/around the cat's head/body.

2. Add a milestone entry to `XP_MILESTONES` in `cat.js`:
   ```js
   { days: 60, accessory: 'youritem' }
   ```

3. The `applyAccessories()` function will automatically show/hide it based on the saved accessories list.

---

## Adding Speech Lines

In `cat.js`, add strings to the `SPEECH_LINES` array. Supports emoji. Aim for ≤30 characters to fit the bubble.

---

## Performance Notes

- All SVG poses are inline — zero network calls
- `requestAnimationFrame` only runs during active animation states
- Timers are paused on system suspend (`powerMonitor`)
- `will-change` is intentionally minimal to avoid GPU layer bloat
- Target: <30MB RAM, <1% CPU at idle

---

## Architecture

```
src/
├── main.js       — Electron main process (window, tray, IPC, config)
├── preload.js    — Context bridge (safe IPC exposure to renderer)
├── index.html    — Transparent window shell, loads SVG + scripts
├── cat.svg       — All 12 pose groups as named <g> elements
├── cat.js        — Behavior state machine, all interaction logic
├── styles.css    — CSS keyframe animations for every pose
└── assets/
    ├── tray.svg  — Tray icon source
    └── tray.png  — Tray icon (16×16, used at runtime)
```

---

## License

MIT — do whatever you want with your cat.
