# Architecture: Inkfold (browser-only PDF tools)

The one decision that shapes everything: **no server**. Every tool runs in the
visitor's browser. That is also the product angle (see recon: the original's
users worry about uploads and hit a 2-task daily cap). It rules out office
conversion, OCR and eSign, which the recon already marked out of scope.

## Stack

| layer | choice | why |
| --- | --- | --- |
| site | static HTML + ES modules, no bundler | nothing to build, host anywhere (Netlify, Pages, S3, any domain) |
| PDF read/write | `@cantoo/pdf-lib` 2.x (pdf-lib fork) | merge, split, rotate, delete, draw text, embed images, **encrypt** and **open with password** |
| PDF render | `pdfjs-dist` 4.x | page thumbnails, PDF to image, image-based compression |
| zip | `fflate` | multi-file results (split, PDF to JPG) |
| vendor | `scripts/vendor.mjs` copies the three ESM builds into `vendor/` | no CDN, no third-party requests, works offline |
| tests | `node --test` for the pure tool functions; `playwright-core` + the system Chromium for end-to-end | pure functions take bytes in, bytes out, so Node can test them |

## Modules

```
src/registry.js        every tool: id, name, tagline, accept, min/max files, options, run, how-to, faq, related
src/tools/*.js         pure functions: (files, options, ctx) -> Result   — no DOM
src/render.js          pdf.js wrapper: thumbnails, renderPageToJpeg(bytes, index, scale, quality)
src/zip.js             zipFiles([{name, data}]) -> Uint8Array
src/ui/toolPage.js     the tool page state machine: idle -> loaded -> working -> done | failed
src/ui/dropzone.js     drag & drop + file picker + type/size validation
src/ui/fileList.js     file chips (reorder, remove) and page grid (select, rotate, delete, reorder)
src/ui/options.js      renders a tool's options schema to form controls
src/app.js             home page tool grid from the registry
```

`run(files, options, ctx)` gets `ctx.render` (pdf.js) injected so the pure
tools stay testable in Node without a canvas.

## Data (in memory only)

```
Job      tool, files: LoadedFile[], options, status, result?, error?
LoadedFile  name, size, bytes: Uint8Array, pageCount, pages: PageState[]
PageState   index, rotation (0|90|180|270), selected, thumb?: string (data URL)
Result   name, mime, bytes, sizeBefore, sizeAfter, kind: pdf | zip | image
```

Nothing is written to storage. Nothing leaves the tab. Closing the tab is the
"delete after one hour" of the original, except it is instant.

## Routes

Static pages. `tool.html?tool=<id>` for every tool; `index.html` home;
`tools.html` catalogue. A host rewrite from `/merge-pdf` to
`/tool.html?tool=merge-pdf` gives the original's URL shape; `_redirects` and
`vercel.json` are left to replica-deploy.

## Build order (vertical slice first)

1. Shell: home grid + tool page states with **merge** end to end.
2. Page grid: thumbnails, select, rotate, delete, reorder → split, rotate,
   delete pages, extract pages.
3. Images: JPG/PNG to PDF, PDF to JPG (zip), compress (image-based).
4. Security: protect, unlock. Edit: number pages, watermark, flatten.
5. Continue-to-tool chaining, FAQ/how-to copy, mobile pass, a11y pass.

## Security notes

- No uploads, no cookies, no analytics, no third-party scripts.
- `Cross-Origin-Opener-Policy` / `Embedder-Policy` headers set by the dev
  server so `SharedArrayBuffer`-based workers stay possible later.
- Password fields are `type=password`, never logged, never stored.
- Large files: everything is in memory; the UI warns above 200 MB.
