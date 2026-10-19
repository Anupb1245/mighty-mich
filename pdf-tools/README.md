# Inkfold

PDF tools that never leave your device. Merge, split, organize, rotate, delete
and extract pages, compress, JPG ⇄ PDF, number pages, watermark, protect,
unlock and flatten. Everything runs in the browser with the PDF engine it
already has. No upload, no account, no daily limit, no subscription.

Built clean-room with the Replica skill pack as a local-first take on the
"online PDF tools" category (recon and architecture notes in `replica/`).

## Run it

```bash
cd pdf-tools
npm install        # also copies the three vendored libraries into vendor/
npm start          # http://localhost:4173
```

Any static host works: upload the folder (minus `node_modules/`) after
`npm install` has produced `vendor/`. `_redirects` (Netlify) and `vercel.json`
give every tool a clean URL such as `/merge-pdf`.

## Test it

```bash
npm test           # unit tests for every tool, pure Node, no browser
npm run test:e2e   # real Chromium through every flow (needs a Chromium binary; see tests/e2e/run.mjs)
```

## How it is built

| piece | what |
| --- | --- |
| `src/tools/*.js` | pure functions, bytes in, bytes out. Testable in Node. |
| `src/registry.js` | every tool: name, copy, options schema, runner |
| `src/render.js` | pdf.js: thumbnails, page renders, JPEG re-encoding |
| `src/ui/` | drop zone, file list, page grid, options form, the tool page state machine |
| `vendor/` | `@cantoo/pdf-lib` (read/write/encrypt), `pdfjs-dist` (render), `fflate` (zip) |

Compression keeps text selectable at the Recommended and Strong levels: it
re-encodes the JPEG images inside the file and leaves everything else alone.
Maximum rasterizes each page, which is smallest but turns text into pixels.

What it does not do, on purpose: Word/Excel/PowerPoint conversion, OCR, eSign,
AI. Those need a server, and the whole point is that there is none.

## License

MIT.
