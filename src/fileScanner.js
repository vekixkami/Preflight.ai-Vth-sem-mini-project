/**
 * fileScanner.js
 *
 * Extracts plain text from attached documents (PDF, DOCX, TXT) so their
 * content can be fed through the SAME Layer 1 / Layer 2 detection pipeline
 * used for typed prompt text (see content.js runScanAndDecide). This file
 * only extracts text — it does not scan, warn, sanitize, or log anything.
 *
 * Parsing runs entirely client-side using vendored pdf.js (src/vendor/pdf.min.js)
 * and mammoth.js (src/vendor/mammoth.browser.min.js), loaded as regular
 * content scripts before this file.
 */
(function () {
  const SUPPORTED_EXTENSIONS = ["pdf", "docx", "txt"];
  // Bounds keep a huge or malformed attachment from stalling the send.
  const MAX_FILE_BYTES = 25 * 1024 * 1024;
  const MAX_PDF_PAGES = 150;

  function extensionOf(fileName) {
    const parts = String(fileName || "").toLowerCase().split(".");
    return parts.length > 1 ? parts.pop() : "";
  }

  function ensurePdfWorkerConfigured() {
    if (typeof pdfjsLib === "undefined") return;
    if (pdfjsLib.GlobalWorkerOptions.workerSrc) return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("src/vendor/pdf.worker.min.js");
  }

  async function extractPdfText(file) {
    ensurePdfWorkerConfigured();
    const buffer = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pageTexts = [];
    const pageLimit = Math.min(doc.numPages, MAX_PDF_PAGES);
    for (let pageNum = 1; pageNum <= pageLimit; pageNum += 1) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item) => item.str).join(" "));
    }
    return pageTexts.join("\n");
  }

  async function extractDocxText(file) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || "";
  }

  async function extractTxtText(file) {
    return file.text();
  }

  async function extractOne(file) {
    const ext = extensionOf(file.name);
    if (file.size > MAX_FILE_BYTES) {
      console.warn("[Preflight] attachment too large to scan locally — skipped");
      return { name: file.name, text: "", skipped: true };
    }
    try {
      if (ext === "pdf") return { name: file.name, text: await extractPdfText(file) };
      if (ext === "docx") return { name: file.name, text: await extractDocxText(file) };
      if (ext === "txt") return { name: file.name, text: await extractTxtText(file) };
      return { name: file.name, text: "", unsupported: true };
    } catch (error) {
      console.warn("[Preflight] failed to extract text from attachment", file.name, error);
      return { name: file.name, text: "", error: true };
    }
  }

  // Returns { combinedText, files } where files reports per-attachment
  // status (name/unsupported/error) WITHOUT including its extracted text —
  // callers must not log file names or content, only aggregate counts.
  async function extractFilesText(files) {
    const results = await Promise.all(Array.from(files || []).map(extractOne));
    const combinedText = results
      .filter((r) => r.text && r.text.trim().length > 0)
      .map((r) => `--- Attachment: ${r.name} ---\n${r.text}`)
      .join("\n\n");
    return {
      combinedText,
      files: results.map(({ name, unsupported, error, skipped }) => ({ name, unsupported, error, skipped })),
    };
  }

  window.PreflightFileScanner = { extractFilesText, SUPPORTED_EXTENSIONS };
})();
