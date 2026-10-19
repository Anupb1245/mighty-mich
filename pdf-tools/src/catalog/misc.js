// Text/CSV/RTF/HTML/ZIP to PDF, PDF/A, PDF to PNG, scanner, converter hub, share.
import * as t from "../tools/convertText.js";
import * as images from "../tools/images.js";

const PDF = { accept: "application/pdf,.pdf", kinds: ["pdf"] };
const howtoConvert = (what) => [`Drop a ${what} file.`, "Pick the page size.", "Download the PDF."];

export default [
  {
    id: "pdf-converter",
    name: "PDF Converter",
    tagline: "Every conversion, one place.",
    category: "convert",
    icon: "convert",
    mode: "single",
    ...PDF,
    hub: ["pdf-to-word", "pdf-to-excel", "pdf-to-ppt", "pdf-to-jpg", "pdf-to-png", "pdf-to-pdfa", "word-to-pdf", "excel-to-pdf", "ppt-to-pdf", "jpg-to-pdf", "txt-to-pdf", "rtf-to-pdf", "html-to-pdf", "epub-to-pdf", "zip-to-pdf", "csv-to-pdf", "odt-to-pdf", "ods-to-pdf", "odp-to-pdf", "pages-to-pdf"],
    howto: ["Pick the conversion you need.", "Drop the file.", "Download the result."],
    faq: [["Why are Office conversions marked basic?", "Word, Excel and PowerPoint are rebuilt from their text, tables and images in your browser. Simple documents come out well; heavy layouts lose some fidelity. Nothing is uploaded either way."]],
    related: ["compress-pdf", "merge-pdf", "pdf-ocr"],
  },
  {
    id: "pdf-to-png",
    name: "PDF to PNG",
    tagline: "Pages as lossless PNG images.",
    category: "pdf-to-image",
    icon: "export",
    mode: "pages",
    ...PDF,
    selectLabel: "Select pages, or leave all unselected for every page",
    action: "Convert to PNG",
    run: (files, o, ctx) => images.pdfToImages(files, { ...o, format: "png" }, ctx),
    options: [{ key: "dpi", type: "radio", label: "Quality", default: 150, choices: [[96, "Screen (96 dpi)"], [150, "Good (150 dpi)"], [300, "Print (300 dpi)"]] }],
    howto: ["Drop a PDF.", "Pick the resolution.", "Download a ZIP of PNGs, or one PNG for a single page."],
    faq: [["PNG or JPG?", "PNG is lossless and best for text and diagrams. JPG is smaller for photos."]],
    related: ["pdf-to-jpg", "jpg-to-pdf", "compress-pdf"],
  },
  {
    id: "pdf-to-pdfa",
    name: "PDF to PDF/A",
    tagline: "Archive-grade PDF for long-term storage.",
    category: "convert",
    icon: "pdfa",
    mode: "single",
    ...PDF,
    action: "Convert to PDF/A",
    run: t.pdfToPdfa,
    options: [{ key: "conformance", type: "radio", label: "Conformance level", default: "3B", choices: [["3B", "PDF/A-3b (recommended)"], ["2B", "PDF/A-2b"], ["1B", "PDF/A-1b"]] }],
    howto: ["Drop a PDF.", "Pick the conformance level.", "Download the PDF/A file."],
    faq: [
      ["What is PDF/A?", "An ISO standard for archiving: fonts embedded, no encryption, no external dependencies, so the file renders the same decades from now."],
      ["Will every file pass validation?", "Most do. A file with fonts that are not embedded or with JavaScript may still fail a strict validator; the metadata and structure are fixed here."],
    ],
    related: ["compress-pdf", "flatten-pdf", "protect-pdf"],
  },
  {
    id: "txt-to-pdf",
    name: "TXT to PDF",
    tagline: "Plain text, nicely paginated.",
    category: "convert-to-pdf",
    icon: "text",
    mode: "single",
    accept: ".txt,.md,.markdown,.log,text/plain",
    kinds: ["txt", "md", "markdown", "log", "text"],
    action: "Convert to PDF",
    run: t.txtToPdf,
    options: [
      { key: "pageSize", type: "radio", label: "Page size", default: "a4", choices: [["a4", "A4"], ["letter", "Letter"]] },
      { key: "fontSize", type: "number", label: "Font size", default: 11, min: 7, max: 24 },
      { key: "mono", type: "checkbox", label: "Monospace (code, logs)", default: false },
    ],
    howto: howtoConvert("TXT"),
    faq: [["Does it keep my line breaks?", "Yes. Long lines wrap; your own breaks stay."]],
    related: ["rtf-to-pdf", "html-to-pdf", "merge-pdf"],
  },
  {
    id: "csv-to-pdf",
    name: "CSV to PDF",
    tagline: "A spreadsheet export as a clean table.",
    category: "convert-to-pdf",
    icon: "table",
    mode: "single",
    accept: ".csv,.tsv,text/csv",
    kinds: ["csv", "tsv"],
    action: "Convert to PDF",
    run: t.csvToPdf,
    options: [
      { key: "landscape", type: "checkbox", label: "Landscape page", default: false },
      { key: "header", type: "checkbox", label: "First row is a header", default: true },
      { key: "fontSize", type: "number", label: "Font size", default: 9, min: 6, max: 14 },
    ],
    howto: howtoConvert("CSV"),
    faq: [["Which separators work?", "Comma, semicolon and tab are detected automatically. Quoted cells with commas inside are handled."]],
    related: ["excel-to-pdf", "txt-to-pdf", "merge-pdf"],
  },
  {
    id: "rtf-to-pdf",
    name: "RTF to PDF",
    tagline: "Rich Text, kept readable.",
    category: "convert-to-pdf",
    icon: "text",
    mode: "single",
    accept: ".rtf,application/rtf,text/rtf",
    kinds: ["rtf"],
    action: "Convert to PDF",
    run: t.rtfToPdf,
    options: [{ key: "pageSize", type: "radio", label: "Page size", default: "a4", choices: [["a4", "A4"], ["letter", "Letter"]] }],
    howto: howtoConvert("RTF"),
    faq: [["What is kept?", "Paragraphs, bold and font sizes. Images and tables inside RTF are not rendered."]],
    related: ["txt-to-pdf", "word-to-pdf", "html-to-pdf"],
  },
  {
    id: "html-to-pdf",
    name: "HTML to PDF",
    tagline: "A web page's content as a document.",
    category: "convert-to-pdf",
    icon: "html",
    mode: "single",
    accept: ".html,.htm,text/html",
    kinds: ["html", "htm"],
    action: "Convert to PDF",
    run: t.htmlToPdf,
    options: [{ key: "pageSize", type: "radio", label: "Page size", default: "a4", choices: [["a4", "A4"], ["letter", "Letter"]] }],
    howto: ["Save the page as an .html file and drop it here.", "Pick the page size.", "Download the PDF."],
    faq: [["Does it render CSS?", "No. It keeps the content: headings, paragraphs, lists and tables as text, so the PDF stays small and searchable. For a pixel-exact copy use your browser's Print to PDF."]],
    related: ["txt-to-pdf", "epub-to-pdf", "merge-pdf"],
  },
  {
    id: "zip-to-pdf",
    name: "ZIP to PDF",
    tagline: "A folder of files, one PDF.",
    category: "convert-to-pdf",
    icon: "zip",
    mode: "single",
    accept: ".zip,application/zip",
    kinds: ["zip"],
    action: "Convert to PDF",
    run: t.zipToPdf,
    options: [{ key: "pageSize", type: "radio", label: "Page size for images and text", default: "a4", choices: [["a4", "A4"], ["letter", "Letter"], ["fit", "Fit images"]] }],
    howto: ["Drop a ZIP with PDFs, images, text, CSV, RTF or HTML.", "Files are added in name order.", "Download one combined PDF."],
    faq: [["What is skipped?", "Anything that is not a PDF, image, TXT, CSV, RTF or HTML. The result lists what was skipped."]],
    related: ["merge-pdf", "jpg-to-pdf", "txt-to-pdf"],
  },
  {
    id: "pdf-scanner",
    name: "PDF Scanner",
    tagline: "Photograph pages, get a PDF.",
    category: "scan",
    icon: "camera",
    mode: "files",
    accept: "image/*",
    kinds: ["image"],
    capture: "environment",
    minFiles: 1,
    maxFiles: 200,
    action: "Make PDF",
    run: async (files, o, ctx) => {
      const enhanced = [];
      for (const f of files) {
        const bytes = o.enhance && o.enhance !== "none" && ctx.enhanceImage ? await ctx.enhanceImage(f.bytes, o.enhance) : f.bytes;
        enhanced.push({ ...f, bytes, size: bytes.length });
      }
      const r = await images.imagesToPdf(enhanced, { pageSize: o.pageSize, orientation: "auto", margin: "none" }, ctx);
      r.name = "scan.pdf";
      return r;
    },
    options: [
      { key: "enhance", type: "radio", label: "Enhance", default: "document", choices: [["document", "Document (brighten, sharpen)"], ["grayscale", "Grayscale"], ["bw", "Black & white"], ["none", "Keep photo as is"]] },
      { key: "pageSize", type: "radio", label: "Page size", default: "a4", choices: [["a4", "A4"], ["letter", "Letter"], ["fit", "Fit photo"]] },
    ],
    howto: ["On a phone, tap to open the camera and shoot each page. On a desktop, drop photos.", "Reorder the pages, pick an enhancement.", "Download the scanned PDF."],
    faq: [["Is there automatic edge detection?", "Not yet. Frame the page when you shoot; the Document enhancement evens the lighting and sharpens text."]],
    related: ["jpg-to-pdf", "pdf-ocr", "compress-pdf"],
  },
  {
    id: "share-pdf",
    name: "Share PDF",
    tagline: "Hand a file to another app on your device.",
    category: "edit",
    icon: "share",
    mode: "custom",
    noRun: true,
    ...PDF,
    ui({ file, container, api }) {
      const { h, icons, download } = api;
      const canShare = typeof navigator !== "undefined" && !!navigator.share;
      const blob = new File([file.bytes], file.name, { type: "application/pdf" });
      const canShareFile = canShare && (!navigator.canShare || navigator.canShare({ files: [blob] }));
      container.append(
        h(
          "div",
          { style: "padding:24px;text-align:center" },
          h("div", { class: "ok", html: icons.share, style: "margin:0 auto 12px" }),
          h("p", {}, canShareFile ? "Send this PDF to Mail, Messages, Drive or any app on this device. It never touches a server on the way." : "Your browser cannot hand files to other apps directly (this works on phones and recent desktop browsers). Download it instead and attach it where you need it."),
          h("div", { class: "actions", style: "display:flex;gap:10px;justify-content:center;flex-wrap:wrap" },
            canShareFile && h("button", { class: "btn lg", html: `${icons.share}<span>Share…</span>`, onclick: () => navigator.share({ files: [blob], title: file.name }).catch(() => {}) }),
            h("button", { class: "btn secondary lg", html: `${icons.download}<span>Download</span>`, onclick: () => download(file.bytes, file.name, "application/pdf") })
          )
        )
      );
    },
    howto: ["Drop a PDF.", "Tap Share and pick the app.", "Or download it."],
    faq: [["Why no share link?", "A link means a copy on a server. This site keeps everything on your device, so sharing goes through your own apps instead."]],
    related: ["compress-pdf", "protect-pdf", "merge-pdf"],
  },
];
