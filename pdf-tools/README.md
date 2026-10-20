# Inkfold

PDF tools that never leave your device. Forty-nine of them, covering the whole
classic PDF-suite menu, and every one runs in the browser with the PDF engine
it already has. No upload, no account, no daily limit, no subscription.

| Category | Tools |
| --- | --- |
| Compress | Compress PDF (lossless, image downsampling that keeps text selectable, or full rasterize) |
| Convert | PDF Converter hub, PDF to PDF/A, PDF OCR (in-browser engine, English offline) |
| PDF to Image | PDF to JPG, PDF to PNG |
| Image to PDF | JPG to PDF (JPG, PNG, WebP, GIF, BMP) |
| PDF to Office | PDF to Word, PDF to Excel, PDF to PowerPoint |
| Office to PDF | Word, Excel, PowerPoint to PDF |
| OpenOffice to PDF | ODT, ODS, ODP to PDF |
| Convert to PDF | EPUB, TXT, CSV, RTF, HTML, ZIP to PDF |
| iWork to PDF | Pages to PDF (from the preview inside the .pages bundle) |
| Organize | Merge, Split, Organize, Rotate, Delete pages, Extract pages |
| Edit | Edit PDF, PDF Annotator, Number pages, Watermark, Crop, Redact (content really removed), PDF Reader, Share |
| Fill & Sign | Sign PDF (draw, type, upload), PDF Form Filler, Request Signatures (explains why that needs a server) |
| Protect | Protect (AES-256), Unlock, Flatten |
| AI PDF | AI Assistant, Chat with PDF, Summarizer, Translate PDF, Question Generator, on an OpenAI-compatible endpoint you choose |
| Scan | PDF Scanner (camera capture with document enhancement) |

How the Office conversions keep the design: Word, Excel and PowerPoint files
are rendered by a real layout engine inside the browser (docx-preview, ExcelJS
styles, pptx-preview), each page is rasterized exactly as it looks, and an
invisible text layer keeps the PDF searchable and selectable. A "text only"
mode gives a smaller, re-flowed file. PDF to Word places every text block and
image where it was on the page (frames), with an optional page background for
drawing-heavy pages; PDF to PowerPoint keeps each page as a picture with the
text in the notes.

Honest limits: ODT/ODS/ODP conversions are the text-based kind; the AI tools
need an endpoint you configure (nothing is sent anywhere else); OCR languages
other than English are fetched on first use; collecting other people's
signatures and HWP files need a server, so they are not offered.

Built clean-room with the Replica skill pack as a local-first take on the
"online PDF tools" category (recon, architecture and the feature matrix are in
`replica/`; parity against the reference menu scores 98/100).

## Run it

```bash
cd pdf-tools
npm install        # also copies the three vendored libraries into vendor/
npm start          # http://localhost:4173
```

## Host it on GitHub Pages

The workflow in `.github/workflows/pages.yml` installs, runs the unit tests,
builds `dist/` and publishes it. It runs on every push to `main` that touches
`pdf-tools/`, and can be started by hand from the Actions tab.

One-time setup, in the repository on GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   (The workflow also tries to enable this itself on first run.)
2. Merge this branch into `main`, or open **Actions → Deploy Inkfold to GitHub
   Pages → Run workflow** and pick the branch.

The site then lives at `https://<user>.github.io/<repo>/`. Every link in the
site is relative, so it works under that sub-path. Clean tool URLs such as
`/merge-pdf` work there too: Pages serves `404.html` for unknown paths and that
page redirects to the tool.

## Host it anywhere else

`npm run build` writes `dist/`: upload that folder to any static host. The
build also generates `_redirects` (Netlify), `vercel.json` (Vercel, with a
CSP), `robots.txt` and, when `SITE_URL=https://your.domain` is set, a
`sitemap.xml`, all from the tool catalog.

### Custom domain

- GitHub Pages: **Settings → Pages → Custom domain**, then at your registrar add
  a `CNAME` record from `www` (or your subdomain) to `<user>.github.io`, or for
  an apex domain the four `A` records GitHub lists (185.199.108.153,
  185.199.109.153, 185.199.110.153, 185.199.111.153). Tick "Enforce HTTPS" once
  the certificate is issued.
- Netlify / Vercel: add the domain in the dashboard and follow the DNS records
  it shows.

## Test it

```bash
npm test           # 73 unit tests over the pure tool functions, Node only
npm run test:e2e   # 43 Chromium steps through every tool's real UI (needs a Chromium binary; see tests/e2e/run.mjs)
node tests/e2e/run.mjs editor ai   # a subset, by step-file name
```

## How it is built

| piece | what |
| --- | --- |
| `src/tools/*.js` | pure functions, bytes in, bytes out. Testable in Node. Office/ODF/EPUB parsing and writing is hand-written XML. |
| `src/catalog/*.js` + `src/registry.js` | every tool: name, copy, options schema, runner, grouped in 15 categories |
| `src/render.js` | pdf.js: thumbnails, page renders, text extraction, JPEG re-encoding, scan enhancement |
| `src/ui/` | drop zone, file list, page grid, options form, the tool page state machine; `editor.js`/`reader.js` (page canvas tools), `aiPanel.js` (AI workspace) |
| `vendor/` | `@cantoo/pdf-lib` (read/write/encrypt/PDF-A), `pdfjs-dist` (render), `fflate` (zip), DejaVu + fontkit (Unicode text), tesseract.js + English data (OCR), docx-preview + jszip, ExcelJS, pptx-preview and html-to-image (exact-layout Office rendering, loaded only when used) |
| `src/exact.js` | the exact-layout pipeline: hidden layout host, per-page raster, DOM-derived invisible text layer |

Compression keeps text selectable at the Recommended and Strong levels: it
re-encodes the JPEG images inside the file and leaves everything else alone.
Maximum rasterizes each page, which is smallest but turns text into pixels.

What it does not do, on purpose: Word/Excel/PowerPoint conversion, OCR, eSign,
AI. Those need a server, and the whole point is that there is none.

## License

MIT.
