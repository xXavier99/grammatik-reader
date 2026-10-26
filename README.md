# Grammatik Reader

A static web app for working through a grammar workbook PDF (e.g. *Grammatik aktiv*):
type answers anywhere on the pages, keep the answer key open in a split pane, mark
answers right or wrong, and export a copy of the PDF with everything baked in.

Everything runs in the browser. The PDF is never modified: your work is saved in a
sidecar file next to it (`Book.pdf` → `Book.pdf.annotations.json`).

## Features

- **Text** (`T`): click anywhere and type. Enter goes to the next row (same spacing as
  the last answer area), Shift+Enter is a newline, ↑/↓ move between rows, Tab jumps to
  the next answer area. Boxes can be moved (grip or Alt+drag), resized in width and
  deleted. Font size and colour in the toolbar apply to new boxes and to the selected box.
- **Answer areas** (`A`): set *Lines*, then drag from the top of the first row's text to
  the printed line under the last row. The rows follow the printed lines, and you go
  straight into typing in the first row. The area's row spacing is remembered, so for
  the next block you only need to click its first row and press Enter.
- **Blanks** (`B`): for answers scattered through a text. Click where each answer starts,
  in the order you want to fill them; each spot gets a numbered placeholder. Press Enter
  (or click a placeholder in Text mode) to start typing, then Tab / Shift+Tab move to the
  next / previous blank in that order. In Text mode a click near a placeholder snaps to it.
  In Blanks mode, drag a placeholder to move it or press Delete to remove it. Placeholders
  are never exported.
- **Select** (`V`): click a text box, ✓/✗ mark or placeholder to select it, Shift+click to
  add more, or drag a rectangle on empty space to select everything it touches. Drag a
  selected item to move the whole selection; Delete removes it (a mark takes its correction
  with it). Enter edits the selected text box.
- **Check** (`C`): left click puts a ✓ next to an answer; right click puts a ✗ and opens a
  correction next to it. Click a mark to remove it, drag it to move it (with its correction),
  right-click a ✓ to turn it into a ✗. In Check mode the colour picker sets the correction colour.
- **Split view**: a second pane (stacked or side by side) with its own page and zoom, e.g.
  for the answer key. *Map* (`M`) records "top page → bottom page"; with *Link* on, the
  bottom pane follows the top pane. *Key…* edits the mapping table and the start of the
  answer section.
- **Export**: a copy of the PDF with answers (and optionally ✓/✗ and corrections),
  default name `Book - answers.pdf`.
- Undo/redo (Ctrl+Z / Ctrl+Y) for all edits; autosave about 1 s after a change; last page
  and zoom remembered per book; light/dark theme follows the system. Press `?` for all shortcuts.

## Run locally

Requires Node.js 18 or newer (22 LTS recommended).

```powershell
npm install
npm run dev        # open the printed http://localhost:5173/ in Chrome or Edge
```

On Windows PowerShell, if `npm` is blocked by the script execution policy, use `npm.cmd`
instead (`npm.cmd install`, `npm.cmd run dev`).

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests (Vitest): coordinates, layout, row snapping, undo/redo, schema, answer key, export |
| `npm run test:e2e` | Browser tests (Playwright) against the production build served from a sub-path. First run: `npx playwright install chromium` |
| `npm run build` | Production build into `dist/` |
| `npm run sample` | Regenerates `samples/Sample Workbook.pdf`, a test workbook |

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs the unit tests, builds and publishes
the site on every push to `main`. The build uses relative asset paths, so it works under
any repository name.

1. Create a **public** repository on GitHub (Pages on private repositories needs a paid plan).
   Don't add a README there.
2. In the repository, open **Settings → Pages → Build and deployment → Source** and choose
   **GitHub Actions**.
3. Push the project:
   ```powershell
   git add .
   git commit -m "Grammatik Reader"
   git remote add origin https://github.com/<user>/<repo>.git
   git push -u origin main
   ```
4. Watch the **Actions** tab. When the run is green, the app is at
   `https://<user>.github.io/<repo>/`.

Later changes: commit and push, and the site redeploys automatically.

Don't put the workbook PDF itself in the repository: the site only contains the app, and the
book stays in your own folder.

## Using it with Google Drive on two computers

1. Put the PDF in a folder synced by **Google Drive for Desktop** (e.g. `G:\My Drive\Deutsch\`).
2. Open the app, click **Open PDF…**, pick the PDF, then select the folder that contains it
   (or any folder above it) and allow editing. The app creates
   `<name>.pdf.annotations.json` next to the PDF and saves your work there.
3. Next time, click **Resume “…”** and confirm the permission prompt.
4. On the second computer, do the same once. Drive syncs the annotations file between
   machines.
5. If the file changed on the other computer while the app is open, you'll see one of two
   things. With no unsaved edits, the app quietly reloads it when the window regains focus.
   With unsaved edits, it asks whether to reload or overwrite.

If the annotations file is ever damaged, it is copied to `<name>.pdf.annotations.json.bak`
before the app starts fresh, and you get a message.

Avoid editing on both computers at the same time: Drive may then create a
"conflicted copy" of the annotations file, which the app does not merge.

## Annotation file format

JSON, `"version": 1`. All positions are in PDF user-space units (points, origin bottom-left),
so they don't depend on zoom and are used as-is for export. Contents: `pages` (text boxes,
answer areas, ✓/✗ marks and blanks per page), `settings` (default font size, colours, area lines,
remembered row spacing), `answerKey` (answer section start, link toggle, mapping table),
and `view` (last page, zoom, split layout).

## Known limitations

- **Chromium only** (Chrome or Edge on desktop). The app relies on the File System Access API,
  which Firefox and Safari don't support.
- **Permission is re-granted once per browser session.** Browsers don't let a site keep
  file access across restarts, hence the one-click **Resume**. "Resume" is remembered per
  site and per computer: the localhost version and the GitHub Pages version each need one
  **Open PDF…** first.
- Only one person or computer should edit a book at a time (see above).
- Answer areas assume upright pages; on pages rotated in the PDF (`/Rotate`) text and marks
  work, but area rows may not line up.

## Code layout

```
src/pdf/       PDF loading (pdf.js, local worker), page geometry, layout maths, render queue + cache
src/model/     document schema + migration, store, undo/redo, coordinate transforms, row maths
src/tools/     select, text, answer-area, blanks and check-mode tools
src/ui/        app shell, toolbar, sidebar, panes, split view, answer-key panel, dialogs
src/storage/   file handles (IndexedDB), sidecar read/write, autosave + conflict detection
src/export/    PDF export with pdf-lib (embeds the bundled Noto Sans, SIL OFL)
```
