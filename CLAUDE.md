# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Grammatik Reader: a static, browser-only TypeScript app (Vite, no framework) for filling in a grammar workbook PDF. The user types answers on the pages, marks them ✓/✗ and exports a copy of the PDF with everything included. The PDF itself is never modified. All work is saved in a sidecar JSON file next to it (`Book.pdf` → `Book.pdf.annotations.json`), accessed through the File System Access API (Chromium only). The app is deployed to GitHub Pages by `.github/workflows/deploy.yml` (unit tests → build → publish) on every push to `main`.

## Commands

A portable Node 22 lives in `.tools/` (gitignored). In the Bash tool, run `source .tools/env.sh` first if `node`/`npm` are not on PATH. In PowerShell, use `npm.cmd` if the execution policy blocks `npm`.

```
npm run dev            # Vite dev server at http://localhost:5173/
npm run build          # tsc --noEmit (type check) + vite build into dist/
npm test               # Vitest unit tests (tests/unit/**/*.test.ts, node environment)
npx vitest run tests/unit/history.test.ts      # single unit test file
npx vitest run -t "name of test"               # single test by name
npm run test:e2e       # Playwright (Chromium); builds and serves dist/ under /grammatik-reader/ on port 4173
npx playwright test tests/e2e/phase3.spec.ts   # single e2e file
npm run sample         # regenerate samples/Sample Workbook.pdf (used by e2e tests)
```

There is no linter. Type checking happens only in `npm run build` (strict, `noUnusedLocals`/`noUnusedParameters`). `predev`/`prebuild` copy pdf.js cmaps and standard fonts into `public/pdfjs/` (gitignored). The first e2e run needs `npx playwright install chromium`.

## Architecture

The entry point is `src/main.ts` → `ui/app.ts` (`App`: start screen, open/resume) → `ui/session.ts` (`Session`: one open book). `Session` wires everything together and is the place to look first for how features connect.

**Coordinates.** Every stored position is in PDF user space of the *unrotated* page (points, origin bottom-left, y up). `model/coords.ts` mirrors pdf.js `PageViewport` maths (`makeViewport`, `pdfToScreen`, `screenToPdf`) so that overlays line up with the canvas. Rendering converts PDF → screen and export uses the values directly, so nothing stored depends on zoom or `/Rotate`.

**State and undo.** `model/store.ts` `Store` holds the single `SidecarDoc` (schema in `model/schema.ts`) shared by both split panes. Annotation edits go through `store.change(label, mutations, mergeKey?)`, using the mutation builders `createOp`/`updateOp`/`deleteOp` from `model/history.ts`. Each mutation stores full before/after snapshots, so undo applies the mutation backwards. Consecutive transactions with the same `mergeKey` collapse into one undo step (e.g. typing); `history.seal()` ends a merge. View state (`setView`), settings and the answer key bypass history. The store emits `content` / `view` / `reset` changes with affected pages, and views re-render from these. `contentRev`/`viewRev` counters drive dirty tracking.

**Persistence.** `storage/sidecar.ts` reads and writes the JSON and runs `migrate()` (`schema.ts`, `SCHEMA_VERSION = 1`; add future version steps there). A corrupt file is backed up to `.bak` before the app starts fresh. `storage/autosave.ts` saves content about 1 s and view state about 10 s after a change, detects external changes from another machine (Google Drive sync), then reloads silently or asks reload/overwrite. `storage/handles.ts` keeps file and directory handles in IndexedDB for "Resume".

**Rendering and interaction.** `pdf/book.ts` loads the PDF with a locally bundled worker. `pdf/renderer.ts` is a prioritised, cancellable render queue with an LRU canvas cache shared across panes. `ui/pane.ts` is one scrolling PDF view. `ui/split.ts` places two panes; the second pane serves the answer key, with the page mapping in `model/answerKey.ts`. `ui/annotations.ts` draws store contents onto every mounted page of every pane and routes pointer events to the active `Tool` (one per mode: `tools/select.ts`, `text.ts`, `area.ts`, `underline.ts`, `blank.ts`, `check.ts`; `Session.setMode` swaps them and sets a `mode-*` class on the session, which `styles.css` uses to decide which overlay nodes take pointer events). `tools/editor.ts` `EditorState` holds the mode and selection shared by all panes. The selection is a list (Select mode can hold several items); `editor.selection` is non-null only when exactly one item is selected.

Page annotations are five collections: `texts`, `areas`, `marks`, `blanks`, `underlines` (every entity has `x`/`y`, which Select mode moves). They are linked by id: `TextBox.areaId`/`lineIndex` (row in an answer area), `markId` (a correction belongs to a ✗), `blankId` (typed into a blank). A blank is "filled" while a text box points to it. Array order of `blanks` is the Tab order. `deletionOps` in `tools/select.ts` handles these dependents (a mark takes its corrections along; text in a deleted blank is unlinked). Use it rather than raw `deleteOp` when deleting user-selected items. Adding a collection means touching `schema.ts` (type, `emptyPage`, `isPageEmpty`, `migrate`) and `CollectionTypes` in `history.ts`.

**Export.** `export/exportPdf.ts` uses pdf-lib with the bundled Noto Sans (`src/assets/fonts`). `export/layout.ts` reproduces the browser's text wrapping (`pre-wrap`, `LINE_HEIGHT` from `model/text.ts`), so exported text matches the screen. If you change on-screen text layout, change export layout too, and the reverse.

Pure logic (coords, areas/row snapping, history, schema, answer key, export layout) lives in `src/model` and `src/export`, and Vitest covers it in a node environment. The e2e tests (`tests/e2e/fixtures.ts`) stub the native file pickers with Origin Private File System handles, so the real File System Access code paths run without dialogs.
