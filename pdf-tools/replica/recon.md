# Recon map: Smallpdf (web)

Date: 2026-10-19. Sources: public pages and third-party reviews only (the
container's network policy blocks smallpdf.com directly, so the site was read
through search snapshots and review sites; no account, no scraping, no source
code). Platform: web. Nothing in `replica/screens/` because no screenshots
could be taken; layouts below are described from public listings.

## Scope

- **App / platform:** Smallpdf, web app.
- **Slice:** the core loop users pay for: pick a tool, drop a PDF, process it,
  download the result. The organize / convert-image / security tools. Not the
  Word/Excel/PPT converters, OCR, eSign, AI chat, scanner app or integrations.
- **For whom:** a standalone product on the user's own domain.

## Sources

| source | URL | what it gave |
| --- | --- | --- |
| marketing site (nav + tool list, snapshot) | https://urlscan.io/result/611d4040-84fd-4aa3-9cfd-407c97dbd91d/content | tool categories and names |
| marketing site | https://smallpdf.com | "21 tools to convert, compress and edit PDFs for free" |
| blog: free vs Pro | https://smallpdf.com/blog/smallpdf-free-vs-pro-plan-comparison | what Pro gates: Edit Text, Strong Compression, batch, AI, unlimited downloads, 7-day trial |
| blog: is Smallpdf safe | https://smallpdf.com/blog/is-smallpdf-safe | files kept 1 hour on EU servers then deleted; 14 days for shared/eSign |
| pricing aggregators | https://www.capterra.com/p/172606/Smallpdf/pricing/ , https://toolradar.com/tools/smallpdf/pricing | Free: 2 tasks/day; Pro ~$15/mo or ~$9/mo yearly; Team ~$12/user |
| reviews | https://www.trustpilot.com/review/smallpdf.com , https://www.capterra.com/p/172606/Smallpdf/reviews/ , https://g2.com/products/smallpdf/reviews/smallpdf-review-8693773 | complaints: billing/cancellation traps, 2-task cap, upload errors on big files, compression quality |
| App Store listing | https://apps.apple.com/app/smallpdf-pdf-scanner-editor/id1485259500 | mobile pitch, same tool set |

## Screen inventory

| ID | screen | route | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home | `/` | pitch + pick a tool | top nav with tool mega-menu, hero headline, tool grid (21 tools, icon + name + one-liner), "how it works" trio, trust/privacy block, pricing teaser, footer | default; logged-out |
| S02 | All tools | `/pdf-tools` | full catalogue | category headers (Convert & Compress, Organize, View & Edit, Convert from PDF, Convert to PDF, Sign & Security), tool cards | default |
| S03 | Tool page: upload | `/merge-pdf`, `/compress-pdf`, `/split-pdf`, … | the tool's entry | H1 + one-liner, big dashed drop zone ("Choose files" button, drag & drop, cloud import icons), how-to steps, FAQ, related tools, rating widget | empty; drag-over; file rejected (wrong type / too big / over daily limit) |
| S04 | Tool page: working area | same URL, after upload | arrange and set options | file/page thumbnails (reorder by drag, rotate, delete per page), tool options panel (e.g. compression level, split mode, page ranges), "Add more files", primary action button | loading thumbnails; options; validation error |
| S05 | Processing | same URL | progress | spinner + status text, cancel | processing; failed (retry) |
| S06 | Result | same URL | download | result card (file name, size, before/after for compress), Download button, "Continue to…" chain into other tools, share link / email, "Start over" | ready; expired (file deleted after 1 hour) |
| S07 | Pricing | `/pricing` | upsell | 3 plan cards (Free / Pro / Team), monthly-yearly toggle, feature comparison table, FAQ | default |
| S08 | Login / signup | `/login` | account | email + Google/Apple SSO | default; error |
| S09 | Daily limit wall | modal over S03/S04 | gate free users | "You've used your 2 free tasks today", Pro CTA, countdown | shown |
| S10 | Help center | support.smallpdf.com | docs | categories, search | default |

## User flows

```
F01 Merge several PDFs into one
    S01 -> S03 (merge) -> S04 reorder files -> S05 -> S06 download
    clicks on happy path: 4 (tool, choose files, merge, download)
    edge: one file is not a PDF; >1 file needed; large file; daily cap hit (S09)

F02 Compress a PDF
    S03 (compress) -> S04 pick level (Basic free / Strong Pro) -> S05 -> S06 shows before/after size
    edge: file already small (no gain); Strong gated to Pro

F03 Split a PDF
    S03 (split) -> S04 choose mode: extract selected pages | split into separate files by range -> S05 -> S06 (one PDF or a ZIP)
    edge: single-page PDF; empty selection

F04 Organize pages (rotate / delete / extract)
    S03 -> S04 thumbnails, click to select, rotate 90°, delete, drag to reorder -> S05 -> S06
    edge: delete all pages blocked

F05 Convert images to PDF
    S03 (JPG to PDF) -> S04 reorder images, page size / orientation / margin -> S05 -> S06
    edge: HEIC unsupported; mixed sizes

F06 Convert PDF to images
    S03 (PDF to JPG) -> S04 pick: whole pages | extract images only, quality -> S05 -> S06 (ZIP)

F07 Protect / unlock
    S03 (protect) -> S04 enter password twice -> S05 -> S06
    S03 (unlock) -> S04 enter password if needed -> S05 -> S06
    edge: wrong password; owner-only restrictions

F08 Number pages
    S03 -> S04 position (6 spots), start number, format -> S05 -> S06

F09 Chain tools
    S06 "Continue to" -> S04 of another tool with the result already loaded
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| TopNav | logged-out | menu open | all |
| ToolCard | grid, list, "related" | hover | S01 S02 S03 |
| DropZone | files, images | empty, drag-over, error, disabled | S03 |
| FileChip / PageThumb | file, page | selected, rotating, dragging, deleting | S04 |
| OptionsPanel | radio group, range input, password, select | invalid | S04 |
| PrimaryButton | default, loading, disabled | | S04 S06 |
| ProgressCard | spinner, percent | failed | S05 |
| ResultCard | single file, zip, before/after | expired | S06 |
| ContinueMenu | list of tools | | S06 |
| StepsTrio | 3 numbered steps | | S01 S03 |
| FAQAccordion | | open/closed | S03 S07 |
| PricingCard | free, pro, team | highlighted | S07 |
| Toast | success, error | | all |
| LimitModal | | | S09 |

## Inferred data model

The original is server-side: files go up, a job runs, a download link comes
back and dies after an hour. For a browser-only clone the model is only what
lives in memory for the session:

```
Job        id, tool, files[], options, status (idle|working|done|failed), result, error
           evidence: S04-S06; confidence: high
File       name, size, type, bytes, pageCount, pages[]
Page       index, rotation, selected, thumbnail
           evidence: S04 thumbnails, rotate/delete per page; confidence: high
Result     name, size, blob, kind (pdf|zip|image)
           evidence: S06; confidence: high
Account    (original only) email, plan, tasksToday
           evidence: S08, S09; confidence: high — skipped in clone
```

## Feature matrix

See `features.csv`.

## What cannot (or will not) be cloned

- Word / Excel / PowerPoint conversions both ways: need a server-side office
  engine. Out of scope for a browser-only clone (skip rows).
- OCR, AI summarizer / chat / translate: server models. Skip.
- eSign with legal audit trail: regulated product, server-side. Skip.
- Scanner mobile app, Google Workspace / Dropbox integrations: their
  platforms. Skip.
- Cloud import (Google Drive, Dropbox): needs their OAuth apps. Could.
- The brand, logo, copy, illustrations: never copied; replica-brand handles it.

## Size

- Screens: 10 (6 of them one tool page in different states). Flows: 9.
  Entities: 4 in-memory.
- Hard parts: (1) real compression without a server, (2) rendering page
  thumbnails fast for big PDFs, (3) encrypt / decrypt in the browser.
- Size: **M** for the browser-only slice above. The full Smallpdf (office
  conversion, OCR, eSign, accounts, billing) is XL and needs a backend.

## Summary

- Core loop: pick tool, drop file, process, download. Four clicks.
- 10 screens, 9 flows, 14 components, 4 in-memory entities.
- Hardest: compression, thumbnails at scale, encryption in-browser.
- Out of scope: office conversion, OCR, AI, eSign, accounts, integrations.
- Next: `/replica-architect`.
