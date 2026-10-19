// OCR plus the AI tools. The AI tools run on an OpenAI-compatible endpoint the user configures
// (their own router, a hosted provider, Ollama…); the browser calls it directly.
import { ocr, LANGUAGES } from "../tools/ocr.js";
import { mountAiPanel } from "../ui/aiPanel.js";

const PDF = { accept: "application/pdf,.pdf", kinds: ["pdf"] };
const AI_FAQ = [
  ["Where does my document go?", "To the endpoint you set in the panel, and nowhere else. Your browser sends the document's text straight to that URL with your own key. Nothing passes through this site, which has no server. Pick an endpoint you trust with the content: a router on your own machine keeps it local."],
  ["Which endpoints work?", "Anything that speaks the OpenAI chat-completions API: a self-hosted router such as the one this project ships with (default http://localhost:20128/v1), OpenAI, Anthropic through a compatible proxy, Groq, Mistral, Together, OpenRouter, Ollama, LM Studio. The endpoint must allow browser requests (CORS)."],
  ["Is there a free tier or quota?", "This site adds none. You pay whatever your endpoint charges, if anything."],
  ["What about scanned PDFs?", "They have no text layer. Run PDF OCR first; the output is a searchable PDF the AI tools can read."],
];
const aiTool = (id, name, tagline, icon, mode, extra = {}) => ({
  id,
  name,
  tagline,
  category: "ai",
  icon,
  mode: "custom",
  layout: "full",
  noRun: true,
  styles: "src/ui/ai.css",
  ...PDF,
  ui: ({ file, container, api }) => mountAiPanel({ file, container, api, mode, chatFirst: extra.chatFirst }),
  faq: AI_FAQ,
  ...extra,
});

export default [
  {
    id: "pdf-ocr",
    name: "PDF OCR",
    tagline: "Make scans and photos searchable.",
    category: "convert",
    icon: "ocr",
    mode: "single",
    accept: "application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp,.bmp",
    kinds: ["pdf", "image"],
    action: "Recognize text",
    run: ocr,
    options: [
      { key: "lang", type: "radio", label: "Language", default: "eng", choices: LANGUAGES },
      { key: "output", type: "radio", label: "Output", default: "pdf", choices: [["pdf", "Searchable PDF (looks the same, text selectable)"], ["txt", "Plain text (.txt)"]] },
    ],
    howto: ["Drop a scanned PDF or a photo of a page.", "Pick the language. English works fully offline.", "Download a PDF that looks identical but can be searched, selected and read aloud."],
    faq: [
      ["Does OCR upload my file?", "No. The recognition engine (Tesseract, compiled to WebAssembly) runs inside your browser. English language data ships with the site, so English OCR works with the network off."],
      ["Other languages?", "The first time you pick another language its data (3–15 MB) is downloaded from the Tesseract.js data CDN and cached in your browser. Only that language file is fetched; your document still never leaves your device."],
      ["How accurate is it?", "Good on clean scans at 150 dpi or more and on straight, well-lit photos. Handwriting and heavy skew are not recognized. The visible page is never changed; only an invisible text layer is added."],
    ],
    related: ["pdf-scanner", "ai-assistant", "compress-pdf"],
  },
  aiTool("ai-assistant", "AI PDF Assistant", "Ask, summarize, extract. Your endpoint, your key.", "ai", "chat", {
    howto: ["Drop a PDF.", "Set your endpoint once: base URL, API key, model. Test the connection.", "Use a quick action or ask anything about the document."],
    related: ["chat-with-pdf", "ai-summarizer", "pdf-ocr"],
  }),
  aiTool("chat-with-pdf", "Chat with PDF", "A conversation with your document.", "chat", "chat", {
    chatFirst: true,
    howto: ["Drop a PDF.", "Pick your endpoint and model.", "Chat. The document text is sent with every question."],
    related: ["ai-assistant", "ai-summarizer", "ai-question-generator"],
  }),
  aiTool("ai-summarizer", "AI PDF Summarizer", "Short, detailed or bullet-point summaries.", "text", "summary", {
    howto: ["Drop a PDF.", "Pick a style.", "Summarize, then copy or download as text or PDF."],
    related: ["ai-assistant", "translate-pdf", "ai-question-generator"],
  }),
  aiTool("translate-pdf", "Translate PDF", "The whole document, page by page.", "translate", "translate", {
    howto: ["Drop a PDF.", "Pick the target language.", "Translate, then download the translated PDF or text."],
    related: ["ai-summarizer", "ai-assistant", "txt-to-pdf"],
  }),
  aiTool("ai-question-generator", "AI Question Generator", "Quiz questions from any document.", "question", "questions", {
    howto: ["Drop a PDF.", "Choose how many questions and which kind.", "Generate, then copy or download."],
    related: ["ai-summarizer", "chat-with-pdf", "ai-assistant"],
  }),
];
