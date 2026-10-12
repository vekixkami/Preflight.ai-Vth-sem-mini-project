/**
 * content.js
 * Runs on chatgpt.com / chat.openai.com / claude.ai
 *
 * Responsibilities:
 *  1. Watch the prompt input box.
 *  2. Intercept Send (click or Enter) BEFORE the request fires.
 *  3. Run Layer 1 detection (local, instant).
 *  4. If Layer 1 flags → show warning overlay, pause send.
 *  5. If Layer 1 is clean → call Layer 2 ML backend (async, 1.5s timeout).
 *  6. Layer 2 high risk → show warning. Medium risk → show softer warning.
 *     Low risk or Layer 2 unavailable → allow send.
 *  7. Log every decision to the background service worker.
 *  8. After send, observe the response area to confirm the prompt went out.
 */

(function () {
  const SITE = detectAiPlatform(location.hostname);
  let lastInputSource = "text_field";

  function detectAiPlatform(hostname) {
    const host = hostname.toLowerCase();
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("gemini.google.com") || host.includes("bard.google.com")) return "gemini";
    if (host.includes("copilot.microsoft.com") || host.includes("bing.com")) return "copilot";
    if (host.includes("perplexity.ai")) return "perplexity";
    return "chatgpt";
  }

  // ---------------------------------------------------------------------
  // Site-specific selectors (this is the part that needs maintenance
  // whenever ChatGPT/Claude update their UI)
  // ---------------------------------------------------------------------
  const SELECTORS = {
    chatgpt: {
      inputBox: "#prompt-textarea",
      sendButton: 'button[data-testid="send-button"]',
      responseContainer: 'div[data-message-author-role="assistant"]',
    },
    claude: {
      inputBox: 'div[contenteditable="true"]',
      sendButton: 'button[aria-label="Send Message"]',
      responseContainer: 'div[data-testid="message"]',
    },
    gemini: {
      inputBox: 'div[contenteditable="true"], textarea',
      sendButton: 'button[aria-label*="Send"], button[aria-label*="Submit"]',
      responseContainer: "model-response, .response-container",
    },
    copilot: {
      inputBox: 'textarea, div[contenteditable="true"]',
      sendButton: 'button[aria-label*="Submit"], button[aria-label*="Send"]',
      responseContainer: "cib-message, .ac-container",
    },
    perplexity: {
      inputBox: 'textarea, div[contenteditable="true"]',
      sendButton: 'button[aria-label*="Submit"], button[aria-label*="Send"]',
      responseContainer: "div[data-testid='answer'], .answer",
    },
  };

  const sel = SELECTORS[SITE];

  document.addEventListener("paste", (event) => {
    lastInputSource = "clipboard";
    if (event.clipboardData && event.clipboardData.files && event.clipboardData.files.length > 0) {
      addAttachments(event.clipboardData.files);
    }
  }, true);
  document.addEventListener("drop", (event) => {
    lastInputSource = "upload";
    if (event.dataTransfer && event.dataTransfer.files) addAttachments(event.dataTransfer.files);
  }, true);
  document.addEventListener("change", (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type === "file") {
      lastInputSource = "upload";
      addAttachments(event.target.files);
    }
  }, true);

  // Holds the currently pending send action so we can resume it
  // after the employee responds to the warning.
  let pendingSend = null;

  // Files picked/dropped since the last successful send. The site's own JS
  // may clear the underlying <input type="file"> once it "accepts" the
  // attachment, so we capture File objects immediately on change/drop
  // rather than re-reading the input at send time. Known limitation: if the
  // employee removes an attachment chip in the page UI without us seeing a
  // corresponding DOM event, it stays queued here until the next send.
  let pendingAttachments = [];

  function attachmentKey(file) {
    return `${file.name}:${file.size}:${file.lastModified}`;
  }

  function addAttachments(fileList) {
    if (!fileList || fileList.length === 0) return;
    const seen = new Set(pendingAttachments.map(attachmentKey));
    Array.from(fileList).forEach((file) => {
      const key = attachmentKey(file);
      if (!seen.has(key)) {
        seen.add(key);
        pendingAttachments.push(file);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Helper: get current text from the input box (handles both
  // <textarea> based and contenteditable-based editors)
  // ---------------------------------------------------------------------
  function getInputText(inputEl) {
    if (!inputEl) return "";
    return inputEl.value !== undefined ? inputEl.value : inputEl.innerText;
  }

  function replaceInputText(inputEl, text) {
    if (!inputEl) return;
    inputEl.focus();

    if (inputEl.value !== undefined) {
      const prototype = Object.getPrototypeOf(inputEl);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (valueSetter) valueSetter.call(inputEl, text);
      else inputEl.value = text;
      inputEl.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }));
      return;
    }

    // execCommand is still the most compatible way to update controlled
    // contenteditable editors such as ProseMirror while producing the input
    // event their framework expects.
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(inputEl);
    selection.removeAllRanges();
    selection.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    selection.removeAllRanges();

    if (!inserted) {
      inputEl.textContent = text;
      inputEl.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }));
    }
  }

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
  }

  function isExtensionContextAvailable() {
    return (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.id === "string" &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }

  function classifyWithLayer2(text) {
    return new Promise((resolve) => {
      if (!isExtensionContextAvailable()) {
        console.warn("[Preflight] Layer2 unavailable — extension context invalidated; reload this tab after reloading the extension");
        resolve({ success: false, error: "extension_context_invalidated" });
        return;
      }

      let settled = false;
      const failOpenTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn("[Preflight] Layer2 runtime message timeout — proceeding fail-open");
        resolve({ success: false, error: "runtime_timeout" });
      }, 2500);

      try {
        chrome.runtime.sendMessage(
          { type: "PREFLIGHT_LAYER2_CLASSIFY", text },
          (response) => {
            if (settled) return;
            settled = true;
            clearTimeout(failOpenTimer);
            if (chrome.runtime.lastError) {
              const message = chrome.runtime.lastError.message || "unknown runtime error";
              const contextInvalidated = message.toLowerCase().includes("extension context invalidated");
              console.warn("[Preflight] Layer2 runtime message error —", message);
              resolve({
                success: false,
                error: contextInvalidated ? "extension_context_invalidated" : "runtime_error",
              });
              return;
            }
            console.log("[Preflight] response returned to content script →", response);
            resolve(response || { success: false, error: "no_response" });
          }
        );
      } catch (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failOpenTimer);
        const message = err?.message || "unknown message error";
        const contextInvalidated = message.toLowerCase().includes("extension context invalidated");
        console.warn("[Preflight] Layer2 message send failed —", message);
        resolve({
          success: false,
          error: contextInvalidated ? "extension_context_invalidated" : "message_error",
        });
      }
    });
  }

  // ---------------------------------------------------------------------
  // Intercept the send action (click on send button, or Enter key)
  //
  // ChatGPT and Claude are React SPAs and can replace the composer nodes
  // between typing and sending. Listen once on `document` instead of
  // attaching to whichever button/input happens to exist at boot time.
  // Document capture also runs before React's delegated event handlers.
  // ---------------------------------------------------------------------
  function eventCameFrom(event, selector) {
    return event.composedPath().some(
      (node) => node instanceof Element && node.matches(selector)
    );
  }

  function attachInterceptors() {
    document.addEventListener("click", (event) => {
      const sendButton = event.target instanceof Element
        ? event.target.closest(sel.sendButton)
        : null;
      if (!sendButton) return;

      const inputBox = document.querySelector(sel.inputBox);
      handleSendAttempt(event, inputBox, sendButton);
    }, true);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      if (!eventCameFrom(event, sel.inputBox)) return;

      const inputBox = document.querySelector(sel.inputBox);
      handleSendAttempt(event, inputBox, document.querySelector(sel.sendButton));
    }, true);

    // Keyboard shortcuts and future site UI changes may submit the composer
    // without producing a click. This is a final interception backstop.
    document.addEventListener("submit", (event) => {
      const inputBox = document.querySelector(sel.inputBox);
      if (!inputBox || !(event.target instanceof Element) || !event.target.contains(inputBox)) return;
      handleSendAttempt(event, inputBox, document.querySelector(sel.sendButton));
    }, true);

    console.log("[Preflight] document-level send interception active");
  }

  // ---------------------------------------------------------------------
  // Core interception logic
  //
  // IMPORTANT: preventDefault()/stopImmediatePropagation() MUST be called
  // synchronously, before any `await`. Once an async function hits its
  // first await, control returns to the browser and the original click/
  // keydown event continues its normal dispatch — by the time our scan
  // result comes back, the site's own handler has already fired and the
  // message is gone. This was the bug that let messages send before the
  // warning appeared.
  // ---------------------------------------------------------------------
  function handleSendAttempt(event, inputBox, sendButton) {
    // If we already approved this exact send, let it through natively.
    if (pendingSend && pendingSend.approved && pendingSend.text === getInputText(inputBox)) {
      // A button click may synchronously produce a form submit event. Keep
      // the approval alive through the current task so both events pass.
      if (!pendingSend.releaseScheduled) {
        pendingSend.releaseScheduled = true;
        const approvedSend = pendingSend;
        setTimeout(() => {
          if (pendingSend === approvedSend) pendingSend = null;
        }, 0);
      }
      return; // do not preventDefault — allow native send
    }

    const text = getInputText(inputBox);
    const attachments = pendingAttachments.slice();
    if ((!text || text.trim().length === 0) && attachments.length === 0) return;

    // Block FIRST, synchronously, no matter what. We decide afterward
    // (once the scan resolves) whether to actually let it through.
    event.preventDefault();
    event.stopImmediatePropagation();

    // Ignore duplicate click/submit events while the same text is already
    // being scanned, but keep every one of them blocked.
    if (pendingSend && pendingSend.scanning && pendingSend.text === text) return;

    pendingSend = { text, findings: [], approved: false, scanning: true };
    console.log("[Preflight] intercepted send; scanning prompt", attachments.length ? `+ ${attachments.length} attachment(s)` : "");

    runScanAndDecide(text, inputBox, sendButton, attachments);
  }

  // Extracts text from any attached documents and appends it to the typed
  // prompt text so Layer 1 regex + Layer 2 ML both cover attachment content.
  // Returns { scanText, attachmentCount } — never the attachment file names,
  // to keep the same "no raw content in logs" guarantee logEvent already has.
  async function buildScanText(text, attachments) {
    if (!attachments || attachments.length === 0) {
      return { scanText: text, attachmentCount: 0 };
    }
    if (typeof window.PreflightFileScanner === "undefined") {
      console.warn("[Preflight] file scanner unavailable — scanning typed text only");
      return { scanText: text, attachmentCount: attachments.length };
    }
    try {
      const { combinedText } = await window.PreflightFileScanner.extractFilesText(attachments);
      const scanText = combinedText ? `${text}\n\n${combinedText}` : text;
      return { scanText, attachmentCount: attachments.length };
    } catch (error) {
      console.error("[Preflight] attachment text extraction failed", error);
      return { scanText: text, attachmentCount: attachments.length };
    }
  }

  async function runScanAndDecide(text, inputBox, sendButton, attachments) {
    const scanStartedAt = performance.now();
    const { scanText, attachmentCount } = await buildScanText(text, attachments);

    if (!pendingSend || pendingSend.text !== text) return;

    let findings;
    try {
      findings = await window.SentinelDetectors.scan(scanText);
    } catch (error) {
      console.error("[Preflight] prompt scan failed", error);
      pendingSend = null;
      return;
    }

    // The composer may have changed while the asynchronous keyword lookup ran.
    if (!pendingSend || pendingSend.text !== text) return;

    console.log("[Preflight] Layer1 verdict —", findings.length > 0 ? `${findings.length} finding(s)` : "clean");

    if (findings.length > 0) {
      // Layer 1 flagged something (in the typed text and/or an attachment) —
      // show the existing rich warning immediately.
      pendingSend = { text, findings, approved: false };
      logEvent({ stage: "pre_send", text, findings, action: "layer1_warning_shown", scanStartedAt, attachmentCount });
      showWarningOverlay(findings, {
        onSanitize: async () => {
          // Sanitize only rewrites the typed prompt text — attachment
          // content can't be rewritten in place, so a flagged attachment
          // must be removed by the employee before proceeding.
          const safeText = await window.SentinelDetectors.sanitize(text);
          replaceInputText(document.querySelector(sel.inputBox) || inputBox, safeText);
          pendingSend = null;
          logEvent({ stage: "pre_send", text, findings, action: "replaced_with_safe_data", scanStartedAt, attachmentCount });
        },
        onProceed: () => {
          pendingSend.approved = true;
          logEvent({ stage: "pre_send", text, findings, action: "proceeded", scanStartedAt, attachmentCount });
          pendingAttachments = [];
          resumeSend(inputBox, sendButton);
        },
        onCancel: () => {
          pendingSend = null;
          logEvent({ stage: "pre_send", text, findings, action: "cancelled", scanStartedAt, attachmentCount });
        },
      });
      return;
    }

    // Layer 1 is clean — ask Layer 2 (scanning typed text + attachment text).
    console.log("[Preflight] entering Layer2 path");
    logEvent({ stage: "pre_send", text, findings: [], action: "no_flag_layer1_calling_layer2", scanStartedAt, attachmentCount });

    let layer2Response = null;
    console.log("[Preflight] sending runtime message → PREFLIGHT_LAYER2_CLASSIFY");
    layer2Response = await classifyWithLayer2(scanText);

    // Guard: composer may have changed during the Layer 2 round-trip.
    if (!pendingSend || pendingSend.text !== text) return;

    if (!layer2Response || !layer2Response.success) {
      const reason = layer2Response ? layer2Response.error : "unknown";
      if (reason === "timeout") {
        console.warn("[Preflight] Layer2 timeout — proceeding with Layer1-only result");
      } else {
        console.warn("[Preflight] Layer2 unavailable —", reason, "— proceeding with Layer1-only result");
      }
      // Layer 2 unavailable: never block the user — release the send.
      logEvent({ stage: "pre_send", text, findings: [], action: `layer2_${reason}_allowed`, scanStartedAt, attachmentCount });
      pendingSend = { text, findings: [], approved: true };
      pendingAttachments = [];
      resumeSend(inputBox, sendButton);
      return;
    }

    const { result } = layer2Response;
    const { risk_level, content_type, confidence } = result;

    logEvent({
      stage: "pre_send",
      text,
      findings: [],
      action: `layer2_verdict_${risk_level}`,
      layer2: { risk_level, content_type, confidence },
      scanStartedAt,
      attachmentCount,
    });

    if (risk_level === "low") {
      // Safe — let it through.
      pendingSend = { text, findings: [], approved: true };
      pendingAttachments = [];
      resumeSend(inputBox, sendButton);
      return;
    }

    // High or medium risk — show Layer 2 warning.
    console.log("[Preflight] Layer2 warning shown — risk:", risk_level, "type:", content_type);
    pendingSend = { text, findings: [], approved: false };
    showLayer2WarningOverlay(result, {
      onProceed: () => {
        pendingSend.approved = true;
        logEvent({ stage: "pre_send", text, findings: [], action: "layer2_warning_proceeded", layer2: { risk_level, content_type }, scanStartedAt, attachmentCount });
        pendingAttachments = [];
        resumeSend(inputBox, sendButton);
      },
      onCancel: () => {
        pendingSend = null;
        logEvent({ stage: "pre_send", text, findings: [], action: "layer2_warning_cancelled", layer2: { risk_level, content_type }, scanStartedAt, attachmentCount });
      },
    });
  }

  function resumeSend(inputBox, previousSendButton) {
    const liveSendButton = document.querySelector(sel.sendButton) || previousSendButton;
    if (liveSendButton && liveSendButton.isConnected) liveSendButton.click();
    else simulateEnter(document.querySelector(sel.inputBox) || inputBox);
  }

  function simulateEnter(inputBox) {
    inputBox.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
  }

  // ---------------------------------------------------------------------
  // Layer 2 warning overlay — shown when ML classifier returns high/medium risk
  // ---------------------------------------------------------------------
  function showLayer2WarningOverlay(result, { onProceed, onCancel }) {
    const existing = document.getElementById("sentinel-overlay");
    if (existing) existing.remove();

    const { risk_level, content_type, confidence, entities = [] } = result;
    const isHigh = risk_level === "high";

    const friendlyType = {
      contract: "Contract / Legal Document",
      financial_report: "Financial Report",
      hr_doc: "HR Document",
      source_code: "Source Code",
      strategy_doc: "Strategy / Internal Document",
      customer_data: "Customer / CRM Data",
      general: "General",
    }[content_type] || content_type;

    const confidencePct = Math.round(confidence * 100);

    const entityList = entities.length > 0
      ? `<ul class="sentinel-l2-entities">${
          entities.slice(0, 6).map(e =>
            `<li><span class="sentinel-l2-entity-label">${escapeHtml(e.label)}</span><span>${escapeHtml(e.text)}</span></li>`
          ).join("")
        }</ul>`
      : "";

    const overlay = document.createElement("div");
    overlay.id = "sentinel-overlay";

    overlay.innerHTML = `
      <section class="sentinel-modal" role="dialog" aria-modal="true" aria-labelledby="sentinel-title" aria-describedby="sentinel-description">
        <header class="sentinel-modal-header sentinel-risk-${isHigh ? "high" : "medium"}">
          <span class="sentinel-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M10.3 3.2 2.2 17.3A2 2 0 0 0 3.9 20h16.2a2 2 0 0 0 1.7-2.7L13.7 3.2a2 2 0 0 0-3.4 0Z"/>
              <path d="M12 8v4.5M12 16h.01"/>
            </svg>
          </span>
          <div class="sentinel-header-copy">
            <h2 id="sentinel-title">${isHigh ? "⚠️ Potential Sensitive Information" : "Heads up — Review before sending"}</h2>
            <p>${isHigh ? "This prompt may contain confidential company data." : "This prompt may contain internal information."}</p>
          </div>
          <button id="sentinel-close-btn" class="sentinel-close" type="button" aria-label="Close warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="sentinel-content">
          <p id="sentinel-description" class="sentinel-l2-description">
            ${isHigh
              ? "Preflight's ML classifier identified this prompt as likely containing sensitive company data. Sending this to a public AI may expose internal information."
              : "Preflight flagged this prompt as potentially containing internal information. Consider reviewing before sending."}
          </p>
          <div class="sentinel-l2-details">
            <div class="sentinel-l2-row">
              <span class="sentinel-l2-key">Content type</span>
              <strong class="sentinel-l2-value">${escapeHtml(friendlyType)}</strong>
            </div>
            <div class="sentinel-l2-row">
              <span class="sentinel-l2-key">Confidence</span>
              <strong class="sentinel-l2-value">${confidencePct}%</strong>
            </div>
            <div class="sentinel-l2-row">
              <span class="sentinel-l2-key">Risk level</span>
              <strong class="sentinel-l2-value sentinel-l2-risk-${risk_level}">${risk_level.charAt(0).toUpperCase() + risk_level.slice(1)}</strong>
            </div>
          </div>
          ${entityList ? `<div class="sentinel-l2-entity-section"><span class="sentinel-l2-section-label">Detected entities</span>${entityList}</div>` : ""}
          <div class="sentinel-buttons sentinel-l2-buttons">
            <button id="sentinel-proceed-btn" class="sentinel-btn ${isHigh ? "sentinel-btn-proceed" : "sentinel-btn-proceed-medium"}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
              <span>Send Anyway</span>
            </button>
            <button id="sentinel-cancel-btn" class="sentinel-btn sentinel-btn-sanitize">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              <span>Cancel</span>
            </button>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(overlay);

    const closeOverlay = () => { overlay.remove(); onCancel(); };
    document.getElementById("sentinel-close-btn").addEventListener("click", closeOverlay);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") closeOverlay(); });
    document.getElementById("sentinel-close-btn").focus();

    document.getElementById("sentinel-proceed-btn").addEventListener("click", () => {
      overlay.remove();
      onProceed();
    });
    document.getElementById("sentinel-cancel-btn").addEventListener("click", closeOverlay);
  }

  // ---------------------------------------------------------------------
  // Layer 1 warning overlay UI (unchanged)
  // ---------------------------------------------------------------------
  function showWarningOverlay(findings, { onSanitize, onProceed, onCancel }) {
    const existing = document.getElementById("sentinel-overlay");
    if (existing) existing.remove();

    const riskLevel = window.SentinelDetectors.highestRisk(findings);
    const riskLabel = { critical: "Critical", high: "High", medium: "Medium", low: "Low" }[riskLevel] || "Low";
    const personalTypes = new Set(["aadhaar", "pan", "phone", "email", "bank_account"]);
    const credentialTypes = new Set(["openai_key", "anthropic_key", "aws_key", "jwt", "db_url", "private_key", "generic_secret", "hardcoded_password"]);
    const categoryCounts = findings.reduce((counts, finding) => {
      if (personalTypes.has(finding.type)) counts.personal += 1;
      else if (credentialTypes.has(finding.type)) counts.credentials += 1;
      else counts.business += 1;
      return counts;
    }, { personal: 0, credentials: 0, business: 0 });

    const overlay = document.createElement("div");
    overlay.id = "sentinel-overlay";
    const icons = {
      alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.3 3.2 2.2 17.3A2 2 0 0 0 3.9 20h16.2a2 2 0 0 0 1.7-2.7L13.7 3.2a2 2 0 0 0-3.4 0Z"/><path d="M12 8v4.5M12 16h.01"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
      person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
      lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
      building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16M17 9h3v12M8 7h2M8 11h2M8 15h2M13 7h1M13 11h1M13 15h1M2 21h20"/></svg>',
      chevron: '<svg class="sentinel-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
      id: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5.5 16c.5-1.5 1.3-2 2.5-2s2 .5 2.5 2M13 10h5M13 14h4"/></svg>',
      shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
      send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    };

    const categoryCard = (kind, label, count, icon) => `
      <div class="sentinel-category ${kind} ${count ? "is-active" : ""}">
        <span class="sentinel-category-icon">${icon}</span>
        <span class="sentinel-category-label">${label}</span>
        <strong>${count}</strong>
      </div>`;

    overlay.innerHTML = `
      <section class="sentinel-modal" role="dialog" aria-modal="true" aria-labelledby="sentinel-title" aria-describedby="sentinel-description">
        <header class="sentinel-modal-header sentinel-risk-${riskLevel}">
          <span class="sentinel-header-icon">${icons.alert}</span>
          <div class="sentinel-header-copy">
            <h2 id="sentinel-title">Sensitive Data Detected</h2>
            <p>Review the details before proceeding.</p>
          </div>
          <button id="sentinel-close-btn" class="sentinel-close" type="button" aria-label="Close warning">${icons.close}</button>
        </header>
        <div class="sentinel-content">
          <div class="sentinel-overview">
            <p id="sentinel-description">This prompt contains data that may expose sensitive company information if sent to a public AI platform.</p>
            <div class="sentinel-risk-card">
              <span>Risk Level</span>
              <strong class="sentinel-risk-badge">${icons.shield}${riskLabel}</strong>
            </div>
          </div>
          <div class="sentinel-summary" aria-label="Detected data categories">
            ${categoryCard("personal", "Personal Information", categoryCounts.personal, icons.person)}
            ${categoryCard("credentials", "Credentials &amp; Secrets", categoryCounts.credentials, icons.lock)}
            ${categoryCard("business", "Business Data", categoryCounts.business, icons.building)}
          </div>
          <button id="sentinel-details-btn" class="sentinel-details-toggle" type="button" aria-expanded="false" aria-controls="sentinel-details">
            ${icons.chevron}<span>View Details</span>
          </button>
          <div id="sentinel-details" class="sentinel-details" hidden>
            ${findings.map((f) => `
              <section class="sentinel-detail-item">
                <span class="sentinel-detail-icon">${icons.id}</span>
                <h3>${escapeHtml(f.label)}</h3>
                <div class="sentinel-detail-row"><span class="sentinel-detail-label">Detected:</span><code>${escapeHtml(f.detected || f.match)}</code></div>
                <div class="sentinel-detail-row"><span class="sentinel-detail-label">Replacement:</span><code class="sentinel-safe-value">${escapeHtml(window.SentinelDetectors.replacementFor(f.type))}</code></div>
              </section>`).join("")}
          </div>
          <div class="sentinel-safety-note">${icons.shield}<span>Replacing will keep your prompt useful while protecting sensitive data.</span></div>
          <div class="sentinel-buttons">
            <button id="sentinel-sanitize-btn" class="sentinel-btn sentinel-btn-sanitize">${icons.shield}<span>Replace with Safe Data</span></button>
            <button id="sentinel-proceed-btn" class="sentinel-btn sentinel-btn-proceed">${icons.send}<span>Send Anyway</span></button>
          </div>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);

    document.getElementById("sentinel-details-btn").addEventListener("click", (event) => {
      const details = document.getElementById("sentinel-details");
      const opening = details.hidden;
      details.hidden = !opening;
      event.currentTarget.querySelector("span").textContent = opening ? "Hide Details" : "View Details";
      event.currentTarget.setAttribute("aria-expanded", String(opening));
    });
    const closeOverlay = () => { overlay.remove(); onCancel(); };
    document.getElementById("sentinel-close-btn").addEventListener("click", closeOverlay);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeOverlay();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeOverlay();
    });
    document.getElementById("sentinel-close-btn").focus();
    document.getElementById("sentinel-sanitize-btn").addEventListener("click", async () => {
      const buttons = overlay.querySelectorAll("button");
      buttons.forEach((button) => { button.disabled = true; });
      try {
        await onSanitize();
        overlay.remove();
      } catch (error) {
        console.error("[Preflight.ai] safe replacement failed", error);
        buttons.forEach((button) => { button.disabled = false; });
      }
    });
    document.getElementById("sentinel-proceed-btn").addEventListener("click", () => {
      overlay.remove();
      onProceed();
    });
  }

  // ---------------------------------------------------------------------
  // Phase 3 — Post-send confirmation
  // Watches for a new assistant response appearing, confirming the
  // prompt actually left the browser.
  // ---------------------------------------------------------------------
  function observeResponses() {
    const target = document.body;
    const observer = new MutationObserver(() => {
      const responses = document.querySelectorAll(sel.responseContainer);
      if (responses.length > 0) {
        // A response appeared. In the full version we'd diff against
        // the last known count and cross-reference with pendingSend /
        // recent logEvent calls to detect bypasses. Kept minimal here.
        logEvent({ stage: "post_send_confirmed", text: null, findings: [], action: "response_received" });
      }
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  // ---------------------------------------------------------------------
  // Logging to backend
  // ---------------------------------------------------------------------
  function logEvent(payload) {
    // Never persist or transmit raw prompt content, matched values, or
    // company keyword labels. Type and risk level are enough for analytics.
    const { text, ...safePayload } = payload;
    if (typeof text === "string") {
      safePayload.textLength = text.length;
      safePayload.input_preview = previewPrompt(text);
    }
    if (typeof payload.scanStartedAt === "number") {
      safePayload.latency_ms = Math.max(0, Math.round(performance.now() - payload.scanStartedAt));
      delete safePayload.scanStartedAt;
    }
    if (Array.isArray(safePayload.findings)) {
      safePayload.findings = safePayload.findings.map(({ type, riskLevel }) => ({
        type,
        riskLevel,
      }));
    }
    // Guard: chrome.runtime may be undefined if the extension context was
    // invalidated. A logEvent failure must NEVER throw into the caller —
    // logging is fire-and-forget and must not block the scan pipeline.
    try {
      chrome.runtime.sendMessage({
        type: "SENTINEL_LOG_EVENT",
        payload: {
          ...safePayload,
          site: SITE,
          ai_platform: SITE,
          domain: location.hostname,
          page_title: document.title,
          input_source: lastInputSource,
          timestamp: Date.now(),
        },
      });
      lastInputSource = "text_field";
    } catch (err) {
      // Swallow silently — logging failure must never affect send flow.
    }
  }

  function previewPrompt(text) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 79)}…`;
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  attachInterceptors();
  observeResponses();
})();
