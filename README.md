<div align="center">

# Illustration Editor

**SVG illustration editor for an electronics textbook**


</div>

A canvas-based vector illustration editor built for the "From Charge to HTML" course (`presentation-charge-to-html`). Illustrations are stored as JSON with semantic color roles rather than raw colors, so every figure renders in both light and dark mode and stays in sync with the Typst book's Catppuccin palette. The Vite dev server doubles as a small REST API that saves figures and auto-recompiles the book on each edit.

## ■ Features

- ❖ **Canvas editor** — circle, rect, line, arrow, cubic bezier, and text tools on a react-konva stage, with select/transform, grid, snap-to-grid, undo/redo, and copy/paste/duplicate shortcuts
- ❖ **Dual theme** — figures use color roles (`fg`, `bg`, `muted`, `accent` + opacity steps) resolved per theme, with a live side-by-side light/dark preview
- ❖ **Science palette** — accent hues mapped to disciplines (math, physics, chemistry, electronics, cs) plus `red` and `default`, with optional per-element overrides; colors synced with the book's `template.typ`
- ❖ **JSON storage** — each illustration is a JSON file; saving also writes `.light.svg` / `.dark.svg`, and `generate-svgs.mjs` batch-regenerates both SVGs for every figure
- ❖ **Live Typst build** — the dev-server API watches `.typ` files and recompiles `main.pdf` + `main-dark.pdf` (debounced) whenever a figure is saved
- ❖ **Data scripts** — `migrate.mjs` upgrades legacy hex/opacity figures to color roles; `fix-beziers.mjs` replaces curve placeholders with real bezier elements

## ■ Stack

<div align="center">

| Component | Technology |
|-----------|------------|
| Editor | React 19, react-konva, Konva |
| Dev server / API | Vite 8 + custom plugin, chokidar |
| Export | Node.js ESM scripts (JSON → SVG) |
| Book | Typst (compiled to light/dark PDF) |

</div>

## ■ How It Works

```
1. Draw shapes in the canvas editor; each save posts the figure JSON to the Vite plugin API
2. The API writes the .json source and generates .light.svg / .dark.svg alongside it
3. chokidar detects the new SVGs, debounces, and runs Typst to rebuild main.pdf + main-dark.pdf
4. Run generate-svgs.mjs to regenerate all SVGs from scratch without the dev server
```

## ■ Screenshots

<div align="center">

![Screenshot](screenshots/main.png)

*Canvas editor with drawing tools, color palette, and live light/dark preview*

</div>

## ■ Usage

```bash
npm install
npm run dev              # editor + save API + Typst auto-build
node generate-svgs.mjs   # batch-regenerate all .light/.dark SVGs
```

## ■ License

MIT © [pluttan](https://github.com/pluttan)
