// Pure burn-in logic for the editor family: annotations, crop, redact, forms. No DOM.
//
// Coordinates: every item/box is in "display points" — the page as the viewer shows it
// (after /Rotate), origin top-left, 1 unit = 1 PDF point. pageFrame() maps that to the
// unrotated, bottom-left space pdf-lib draws in, honouring the CropBox offset.
import { PDFDocument, degrees, rgb, result, baseName, loadDoc, saveDoc, ToolError } from "./core.js";
import { LineCapStyle, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature, PDFButton } from "../../vendor/pdf-lib.esm.js";
import { fontsFor } from "./text.js";

export function hexToRgb(hex, fallback = [0, 0, 0]) {
  const m = String(hex || "").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return rgb(fallback[0], fallback[1], fallback[2]);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Display frame of a page: W/H as shown, plus mapping to pdf-lib coordinates. */
export function pageFrame(page) {
  const crop = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const cw = crop.width;
  const ch = crop.height;
  const [W, H] = rot === 90 || rot === 270 ? [ch, cw] : [cw, ch];
  const toPdf = (xd, yd) => {
    let x, y;
    if (rot === 90) [x, y] = [yd, xd];
    else if (rot === 180) [x, y] = [cw - xd, yd];
    else if (rot === 270) [x, y] = [cw - yd, ch - xd];
    else [x, y] = [xd, ch - yd];
    return { x: crop.x + x, y: crop.y + y };
  };
  /** display rect (top-left x,y,w,h) -> pdf rect (bottom-left x,y,width,height) */
  const rectToPdf = (r) => {
    const a = toPdf(r.x, r.y);
    const b = toPdf(r.x + r.w, r.y + r.h);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  };
  return { W, H, rot, crop, toPdf, rectToPdf };
}

function sniffImage(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  return null;
}

/**
 * Burn items onto pages. Returns the result for the first file.
 * ctx.toPng(bytes, name) converts non PNG/JPEG images when available.
 */
export async function applyAnnotations(files, { items = [] } = {}, ctx = {}) {
  const file = files[0];
  if (!items.length) throw new ToolError("Nothing to apply yet. Add text, shapes, a signature or an image first.", "no_items");
  const doc = await loadDoc(file);
  const pages = doc.getPages();
  const fonts = await fontsFor(doc);
  const imageCache = new Map();
  let drawn = 0;

  for (const it of items) {
    const page = pages[it.page | 0];
    if (!page) continue;
    const f = pageFrame(page);
    const opacity = it.opacity == null ? 1 : Math.max(0, Math.min(1, Number(it.opacity)));
    const stroke = Number(it.stroke ?? 2);
    switch (it.type) {
      case "text":
      case "note": {
        const size = Number(it.size) || 14;
        const font = it.bold ? fonts.bold : fonts.regular;
        if (it.type === "note" || it.background) {
          const r = f.rectToPdf({ x: it.x, y: it.y, w: it.w, h: it.h });
          page.drawRectangle({ ...r, color: hexToRgb(it.background || "#fff59d"), opacity });
        }
        const pad = it.type === "note" ? 4 : 0;
        const base = f.toPdf(it.x + pad, it.y + pad + size * 0.92);
        const text = String(it.text ?? "");
        if (!text.trim()) break;
        try {
          page.drawText(text, { x: base.x, y: base.y, size, font, color: hexToRgb(it.color, [0.1, 0.1, 0.12]), opacity, rotate: degrees(f.rot), maxWidth: Math.max(size, (it.w || 200) - pad * 2), lineHeight: size * 1.25 });
        } catch {
          page.drawText(text.replace(/[^\x20-\x7E -ÿ]/g, "?"), { x: base.x, y: base.y, size, font: fonts.regular, color: hexToRgb(it.color, [0.1, 0.1, 0.12]), opacity, rotate: degrees(f.rot), maxWidth: Math.max(size, (it.w || 200) - pad * 2), lineHeight: size * 1.25 });
        }
        drawn++;
        break;
      }
      case "rect":
      case "highlight":
      case "whiteout":
      case "redact": {
        const r = f.rectToPdf({ x: it.x, y: it.y, w: it.w, h: it.h });
        if (it.type === "highlight") page.drawRectangle({ ...r, color: hexToRgb(it.color || "#ffeb3b"), opacity: it.opacity == null ? 0.4 : opacity });
        else if (it.type === "whiteout") page.drawRectangle({ ...r, color: rgb(1, 1, 1), opacity: 1 });
        else if (it.type === "redact") page.drawRectangle({ ...r, color: rgb(0, 0, 0), opacity: 1 });
        else
          page.drawRectangle({
            ...r,
            color: it.fill && it.fill !== "none" ? hexToRgb(it.fill) : undefined,
            borderColor: it.color && it.color !== "none" ? hexToRgb(it.color) : undefined,
            borderWidth: it.color && it.color !== "none" ? stroke : 0,
            opacity,
            borderOpacity: opacity,
          });
        drawn++;
        break;
      }
      case "ellipse": {
        const r = f.rectToPdf({ x: it.x, y: it.y, w: it.w, h: it.h });
        page.drawEllipse({
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          xScale: r.width / 2,
          yScale: r.height / 2,
          color: it.fill && it.fill !== "none" ? hexToRgb(it.fill) : undefined,
          borderColor: it.color && it.color !== "none" ? hexToRgb(it.color) : undefined,
          borderWidth: it.color && it.color !== "none" ? stroke : 0,
          opacity,
          borderOpacity: opacity,
        });
        drawn++;
        break;
      }
      case "line":
      case "path": {
        const pts = it.type === "line" ? [[it.x, it.y], [it.x + it.w, it.y + it.h]] : it.points || [];
        if (pts.length < 2) break;
        const color = hexToRgb(it.color || "#1b1f2a");
        for (let i = 1; i < pts.length; i++) {
          const a = f.toPdf(pts[i - 1][0], pts[i - 1][1]);
          const b = f.toPdf(pts[i][0], pts[i][1]);
          page.drawLine({ start: a, end: b, thickness: stroke, color, opacity, lineCap: LineCapStyle.Round });
        }
        drawn++;
        break;
      }
      case "image":
      case "signature": {
        let bytes = it.imageBytes;
        if (!bytes) break;
        let kind = sniffImage(bytes);
        if (!kind) {
          if (!ctx.toPng) throw new ToolError("Only PNG and JPEG images can be placed.", "bad_image");
          bytes = await ctx.toPng(bytes, "image");
          kind = "png";
        }
        let img = imageCache.get(bytes);
        if (!img) {
          img = kind === "jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
          imageCache.set(bytes, img);
        }
        // anchor = display bottom-left corner of the box, drawn with the page rotation so it lands upright on screen
        const anchor = f.toPdf(it.x, it.y + it.h);
        page.drawImage(img, { x: anchor.x, y: anchor.y, width: it.w, height: it.h, rotate: degrees(f.rot), opacity });
        drawn++;
        break;
      }
      default:
        break;
    }
  }
  if (!drawn) throw new ToolError("Nothing could be applied.", "no_items");
  const r = result(`${baseName(file.name)}-edited.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { items: drawn };
  return r;
}

/**
 * Crop. box: display rect {x,y,w,h}. pages: "all" | "current" | number[] ; page: the index the box was drawn on.
 * cut=true also sets the MediaBox so the content outside is permanently gone from the page geometry.
 */
export async function cropPages(files, { box, pages = "current", page = 0, cut = false } = {}) {
  const file = files[0];
  if (!box || !(box.w > 4) || !(box.h > 4)) throw new ToolError("Drag a crop area on the page first.", "no_box");
  const doc = await loadDoc(file);
  const all = doc.getPages();
  const targets = pages === "all" ? all.map((_, i) => i) : Array.isArray(pages) ? pages : [page | 0];
  let applied = 0;
  for (const i of targets) {
    const p = all[i];
    if (!p) continue;
    const f = pageFrame(p);
    // clamp the box to this page's display frame
    const bx = Math.max(0, Math.min(f.W, box.x));
    const by = Math.max(0, Math.min(f.H, box.y));
    const bw = Math.max(1, Math.min(f.W - bx, box.w - (bx - box.x)));
    const bh = Math.max(1, Math.min(f.H - by, box.h - (by - box.y)));
    const r = f.rectToPdf({ x: bx, y: by, w: bw, h: bh });
    p.setCropBox(r.x, r.y, r.width, r.height);
    if (cut) {
      p.setMediaBox(r.x, r.y, r.width, r.height);
      p.setBleedBox(r.x, r.y, r.width, r.height);
      p.setTrimBox(r.x, r.y, r.width, r.height);
      p.setArtBox(r.x, r.y, r.width, r.height);
    }
    applied++;
  }
  const rr = result(`${baseName(file.name)}-cropped.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  rr.stats = { pages: applied };
  return rr;
}

/**
 * Redact: boxes [{ page, x, y, w, h }] in display points. Affected pages are rendered to an
 * image (ctx.renderPage), the boxes are painted into the pixels (ctx.paintBoxes), and the page
 * is replaced by that image so the text underneath is really gone. Other pages are untouched.
 * Without ctx.paintBoxes the boxes are drawn with pdf-lib on top of the rasterized page instead.
 */
export async function redactPages(files, { boxes = [], stripMetadata = true, scale = 2, quality = 0.9 } = {}, ctx = {}) {
  const file = files[0];
  if (!boxes.length) throw new ToolError("Draw at least one redaction box.", "no_boxes");
  if (!ctx.renderPage) throw new ToolError("Redaction needs a browser.", "no_renderer");
  const doc = await loadDoc(file);
  const byPage = new Map();
  for (const b of boxes) {
    const i = b.page | 0;
    if (!byPage.has(i)) byPage.set(i, []);
    byPage.get(i).push(b);
  }
  let replaced = 0;
  for (const [i, pageBoxes] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
    const old = doc.getPage(i);
    if (!old) continue;
    const f = pageFrame(old);
    let jpg = await ctx.renderPage(file.bytes, i, { scale, format: "jpeg", quality, password: file.password });
    let painted = false;
    if (ctx.paintBoxes) {
      jpg = await ctx.paintBoxes(jpg, pageBoxes.map((b) => ({ x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale })));
      painted = true;
    }
    const img = await doc.embedJpg(jpg);
    const page = doc.insertPage(i, [f.W, f.H]);
    page.drawImage(img, { x: 0, y: 0, width: f.W, height: f.H });
    if (!painted) for (const b of pageBoxes) page.drawRectangle({ x: b.x, y: f.H - b.y - b.h, width: b.w, height: b.h, color: rgb(0, 0, 0) });
    doc.removePage(i + 1);
    replaced++;
    ctx.onProgress?.(replaced / byPage.size);
  }
  if (stripMetadata) {
    try {
      doc.setTitle("");
      doc.setAuthor("");
      doc.setSubject("");
      doc.setKeywords([]);
      doc.setProducer("");
      doc.setCreator("");
    } catch {
      /* ignore */
    }
  }
  const r = result(`${baseName(file.name)}-redacted.pdf`, await saveDoc(doc), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { pages: replaced, boxes: boxes.length };
  return r;
}

function fieldType(field) {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "optionlist";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFButton) return "button";
  return "unknown";
}

/** Fields of a form: [{ name, type, value, options, multiline, readOnly }]. */
export async function listFields(bytes, { password } = {}) {
  const doc = await loadDoc({ name: "form.pdf", bytes, password });
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const out = [];
  for (const field of form.getFields()) {
    const type = fieldType(field);
    const entry = { name: field.getName(), type, value: null, options: [], readOnly: !!field.isReadOnly?.() };
    if (type === "text") {
      entry.value = field.getText() ?? "";
      entry.multiline = !!field.isMultiline?.();
    } else if (type === "checkbox") entry.value = field.isChecked();
    else if (type === "radio" || type === "dropdown") {
      entry.options = field.getOptions();
      const sel = field.getSelected();
      entry.value = Array.isArray(sel) ? sel[0] ?? "" : sel ?? "";
    } else if (type === "optionlist") {
      entry.options = field.getOptions();
      entry.value = field.getSelected();
    }
    out.push(entry);
  }
  return out;
}

/** Fill fields by name. values: { [name]: string | boolean | string[] }. */
export async function fillForm(files, { values = {}, flatten = false } = {}) {
  const file = files[0];
  const doc = await loadDoc(file);
  const form = doc.getForm();
  const fields = form.getFields();
  if (!fields.length) throw new ToolError("This PDF has no form fields. Use Edit PDF to type on it instead.", "no_fields");
  let set = 0;
  for (const field of fields) {
    const name = field.getName();
    if (!(name in values)) continue;
    const v = values[name];
    const type = fieldType(field);
    try {
      if (type === "text") field.setText(v == null ? "" : String(v));
      else if (type === "checkbox") v === true || v === "true" || v === "on" ? field.check() : field.uncheck();
      else if (type === "radio") v ? field.select(String(v)) : field.clear?.();
      else if (type === "dropdown") v ? field.select(String(v)) : field.clear?.();
      else if (type === "optionlist") field.select(Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
      else continue;
      set++;
    } catch (err) {
      throw new ToolError(`Could not set "${name}": ${String(err?.message || err).slice(0, 100)}`, "bad_value");
    }
  }
  // Appearances: try the standard font first, then the Unicode font for non-Latin text.
  try {
    form.updateFieldAppearances();
  } catch {
    const { regular } = await fontsFor(doc);
    form.updateFieldAppearances(regular);
  }
  if (flatten) form.flatten();
  const r = result(`${baseName(file.name)}-filled.pdf`, await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }), { sizeBefore: file.size, pageCount: doc.getPageCount() });
  r.stats = { set, fields: fields.length, flattened: !!flatten };
  return r;
}

export { PDFDocument };

/** Display frames of every page: [{ W, H, rot }]. Used by the editor and reader UIs. */
export async function pageFrames(file) {
  const doc = await loadDoc(file);
  return doc.getPages().map((p) => {
    const f = pageFrame(p);
    return { W: f.W, H: f.H, rot: f.rot };
  });
}
