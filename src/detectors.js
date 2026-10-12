/**
 * detectors.js
 * Layer 1 — rule-based detection. Runs entirely locally in the browser.
 * No network calls. No ML. Pure pattern matching, instant results.
 *
 * Exposes a single function: window.SentinelDetectors.scan(text)
 * Returns an array of findings: [{ type, label, match, riskLevel }]
 */

(function () {
  // ---------------------------------------------------------------------
  // PATTERNS — Indian PII
  // ---------------------------------------------------------------------

  // Aadhaar: 12 digits, often space/hyphen separated in groups of 4.
  // Accept Aadhaar-shaped values directly so common user/test inputs are
  // caught even when they do not pass checksum validation.
  const AADHAAR_REGEX = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

  // PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Case-insensitive
  // so lowercase/mixed-case pastes (zxcvb9876q) are still caught, same as GST.
  const PAN_REGEX = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi;

  // GST: 15 chars — 2 digit state code + PAN + 1 entity code + Z + 1 checksum
  const GST_REGEX = /\b(?:0[1-9]|[12]\d|3[0-8])[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi;

  // Indian banking identifiers. Account numbers have no universal shape, so
  // require a nearby label instead of flagging every long number in prose.
  const IFSC_REGEX = /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi;
  const BANK_ACCOUNT_REGEX = /\b(?:bank\s+)?(?:a\/?c|account)(?:\s+(?:number|no\.?))?\s*[:#=-]?\s*(\d[\d\s-]{7,24}\d)\b/gi;

  // Indian phone numbers: optional +91/91, optionally wrapped in parentheses
  // e.g. "+91 98765 43210", "98765-43210", "(+91)-9876543210". The bracketed
  // form is matched as one unit so the closing ")" can't break the country
  // code off from the rest of the number (which previously caused the match
  // to fall back to starting at the trailing separator instead).
  const PHONE_REGEX = /(?:^|(?<![\w]))(?:\(\+?91\)|\+91|91)?[\s-]?[6-9]\d{4}[\s-]?\d{5}(?!\w)/g;

  // Email
  const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

  // ---------------------------------------------------------------------
  // PATTERNS — secrets & credentials
  // ---------------------------------------------------------------------

  const OPENAI_KEY_REGEX = /\bsk-[A-Za-z0-9]{20,}\b/g;
  const ANTHROPIC_KEY_REGEX = /\bsk-ant-[A-Za-z0-9-]{20,}\b/g;
  const AWS_KEY_REGEX = /\bAKIA[0-9A-Z]{16}\b/g;
  const AWS_SECRET_REGEX = /\b(?:[A-Za-z0-9+/]{40})\b/g; // loose, paired with context check
  const JWT_REGEX = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
  const DB_URL_REGEX = /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi;
  const PRIVATE_KEY_REGEX = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g;
  const GENERIC_API_KEY_REGEX = /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}['"]?/gi;
  const HARDCODED_PASSWORD_REGEX = /\b(?:password|passwd|pwd|db_password)\s*[:=]\s*['"]?(?!\s*(?:null|none|undefined|changeme|example)\b)[^\s'";,}]{6,}['"]?/gi;
  const FILE_REFERENCE_REGEX = /(?:^|[\s"'`(])([^\s"'`]+\.(?:xlsx?|xlsm|csv|pdf|env|pem|key))(?![\w])/gi;
  const ENV_ASSIGNMENT_REGEX = /(?:^|\n)\s*[A-Z][A-Z0-9_]{2,}\s*=\s*[^\s#]+/gm;
  const SOURCE_CODE_REGEX = /(?:```(?:js|javascript|ts|typescript|py|python|java|go|rb|php|c|cpp|cs|sql|sh|bash)?\s*[\s\S]{20,}?```|\b(?:const|let|var|function|class|import|require)\s+[A-Za-z_$][\w$]*[\s=({])/g;

  // Deliberately non-realistic replacements. Format-valid dummy identifiers
  // can be mistaken for real data and would be detected again on the next
  // scan, so these values are explicit synthetic markers instead.
  const SAFE_REPLACEMENTS = {
    aadhaar: "[SYNTHETIC_AADHAAR]",
    pan: "[SYNTHETIC_PAN]",
    gst: "[SYNTHETIC_GST]",
    phone: "[SYNTHETIC_PHONE]",
    email: "[SYNTHETIC_EMAIL]",
    openai_key: "[REDACTED_OPENAI_KEY]",
    anthropic_key: "[REDACTED_ANTHROPIC_KEY]",
    aws_key: "[REDACTED_AWS_KEY]",
    jwt: "[REDACTED_JWT]",
    db_url: "[REDACTED_DATABASE_URL]",
    private_key: "[REDACTED_PRIVATE_KEY]",
    generic_secret: "[REDACTED_SECRET]",
    company_keyword: "[REDACTED_COMPANY_TERM]",
    ifsc: "[SYNTHETIC_IFSC]",
    bank_account: "[SYNTHETIC_BANK_ACCOUNT]",
    hardcoded_password: "[REDACTED_PASSWORD]",
    file_reference: "[REDACTED_FILE_REFERENCE]",
    env_content: "[REDACTED_ENV_VALUE]",
    source_code: "[REDACTED_SOURCE_CODE]",
  };

  // ---------------------------------------------------------------------
  // Verhoeff checksum validation for Aadhaar (reduces false positives)
  // ---------------------------------------------------------------------
  const VERHOEFF_TABLE_D = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
    [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
    [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
    [9,8,7,6,5,4,3,2,1,0]
  ];
  const VERHOEFF_TABLE_P = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
    [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
    [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],[0,9,4,5,1,2,6,8,7,3] // unused row guard
  ];

  function isValidAadhaarChecksum(num) {
    const digits = num.replace(/\D/g, "");
    if (digits.length !== 12) return false;
    let c = 0;
    const reversed = digits.split("").reverse();
    for (let i = 0; i < reversed.length; i++) {
      c = VERHOEFF_TABLE_D[c][VERHOEFF_TABLE_P[i % 8][parseInt(reversed[i], 10)]];
    }
    return c === 0;
  }

  function isPlausibleAadhaar(num) {
    const digits = num.replace(/\D/g, "");
    if (digits.length !== 12) return false;
    if (/^(\d)\1{11}$/.test(digits)) return false;
    if (/^[01]/.test(digits)) return false;
    return true;
  }

  // ---------------------------------------------------------------------
  // Company-specific keywords — loaded from chrome.storage.local
  // (populated during onboarding, synced from backend)
  //
  // Fails open: if the extension context has been invalidated (e.g. the
  // extension was reloaded while the tab was open), chrome.storage will
  // be undefined. Guard against this explicitly and resolve with [] so
  // the scan pipeline always completes and never blocks the send button.
  // ---------------------------------------------------------------------
  function getCompanyKeywords() {
    return new Promise((resolve) => {
      // Guard: chrome.storage is undefined when the extension context is
      // invalidated (tab open before/after extension reload). Fail open.
      if (
        typeof chrome === "undefined" ||
        !chrome.storage ||
        !chrome.storage.local
      ) {
        console.warn("[Preflight] chrome.storage unavailable — skipping keyword check");
        resolve([]);
        return;
      }
      try {
        chrome.storage.local.get(["companyKeywords"], (result) => {
          // chrome.runtime.lastError is set if the context was invalidated
          // between the guard check and the callback firing.
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn("[Preflight] storage.get error —", chrome.runtime.lastError.message);
            resolve([]);
            return;
          }
          resolve((result && result.companyKeywords) || []);
        });
      } catch (err) {
        console.warn("[Preflight] getCompanyKeywords threw —", err.message);
        resolve([]);
      }
    });
  }

  function findKeywordMatches(text, keywords) {
    const findings = [];
    const lowerText = text.toLowerCase();
    keywords.forEach((kw) => {
      if (kw && lowerText.includes(kw.toLowerCase())) {
        findings.push({
          type: "company_keyword",
          label: `Flagged term: "${kw}"`,
          match: kw,
          detected: kw,
          riskLevel: "high",
        });
      }
    });
    return findings;
  }

  // ---------------------------------------------------------------------
  // Main scan function
  // ---------------------------------------------------------------------
  function scanPatterns(text) {
    const findings = [];

    const aadhaarMatches = text.match(AADHAAR_REGEX) || [];
    aadhaarMatches.forEach((m) => {
      if (isPlausibleAadhaar(m)) {
        findings.push({ type: "aadhaar", label: "Aadhaar Number", match: mask(m), detected: m, riskLevel: "critical" });
      }
    });

    (text.match(PAN_REGEX) || []).forEach((m) =>
      findings.push({ type: "pan", label: "PAN Number", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(GST_REGEX) || []).forEach((m) =>
      findings.push({ type: "gst", label: "GSTIN", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(IFSC_REGEX) || []).forEach((m) =>
      findings.push({ type: "ifsc", label: "IFSC Code", match: mask(m), detected: m, riskLevel: "high" })
    );

    for (const m of text.matchAll(BANK_ACCOUNT_REGEX)) {
      findings.push({ type: "bank_account", label: "Bank Account Number", match: mask(m[1]), detected: m[1], riskLevel: "critical" });
    }

    (text.match(PHONE_REGEX) || []).forEach((m) =>
      findings.push({ type: "phone", label: "Phone Number", match: mask(m), detected: m, riskLevel: "medium" })
    );

    (text.match(EMAIL_REGEX) || []).forEach((m) =>
      findings.push({ type: "email", label: "Email Address", match: mask(m), detected: m, riskLevel: "low" })
    );

    (text.match(OPENAI_KEY_REGEX) || []).forEach((m) =>
      findings.push({ type: "openai_key", label: "OpenAI API Key", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(ANTHROPIC_KEY_REGEX) || []).forEach((m) =>
      findings.push({ type: "anthropic_key", label: "Anthropic API Key", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(AWS_KEY_REGEX) || []).forEach((m) =>
      findings.push({ type: "aws_key", label: "AWS Access Key", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(JWT_REGEX) || []).forEach((m) =>
      findings.push({ type: "jwt", label: "JWT Token", match: mask(m), detected: m, riskLevel: "high" })
    );

    (text.match(DB_URL_REGEX) || []).forEach((m) =>
      findings.push({ type: "db_url", label: "Database Connection String", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(PRIVATE_KEY_REGEX) || []).forEach((m) =>
      findings.push({ type: "private_key", label: "Private Key", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(GENERIC_API_KEY_REGEX) || []).forEach((m) =>
      findings.push({ type: "generic_secret", label: "Possible API Key / Secret", match: mask(m), detected: m, riskLevel: "high" })
    );

    (text.match(HARDCODED_PASSWORD_REGEX) || []).forEach((m) =>
      findings.push({ type: "hardcoded_password", label: "Hardcoded Password", match: mask(m), detected: m, riskLevel: "critical" })
    );

    (text.match(FILE_REFERENCE_REGEX) || []).forEach((m) =>
      findings.push({ type: "file_reference", label: "Sensitive File Type", match: mask(m.trim()), detected: m.trim(), riskLevel: "high" })
    );

    (text.match(ENV_ASSIGNMENT_REGEX) || []).forEach((m) =>
      findings.push({ type: "env_content", label: ".env / Configuration Value", match: mask(m.trim()), detected: m.trim(), riskLevel: "high" })
    );

    (text.match(SOURCE_CODE_REGEX) || []).forEach((m) =>
      findings.push({ type: "source_code", label: "Source Code Pasted as Text", match: mask(m), detected: m, riskLevel: "medium" })
    );

    return findings;
  }

  // A single piece of sensitive text can satisfy several detectors. Keep the
  // broadest security-relevant finding and drop findings wholly contained by
  // it (for example, an email-looking DB credential inside a connection URL,
  // or an API key inside a complete .env assignment).
  const CONTAINER_FINDING_TYPES = new Set(["env_content", "db_url", "private_key"]);

  function resolveOverlappingFindings(text, findings) {
    const nextSearchStart = new Map();
    const located = findings.map((finding, order) => {
      const value = finding.detected || finding.match;
      const occurrenceKey = `${finding.type}\u0000${value}`;
      const searchStart = nextSearchStart.get(occurrenceKey) || 0;
      let start = text.indexOf(value, searchStart);

      // Masked/normalized findings should be rare, but leaving them unlocated
      // is safer than accidentally suppressing a legitimate detection.
      if (start === -1) start = text.indexOf(value);
      if (start !== -1) nextSearchStart.set(occurrenceKey, start + value.length);

      return { finding, order, start, end: start === -1 ? -1 : start + value.length };
    });

    const containers = located
      .filter((item) => item.start !== -1 && CONTAINER_FINDING_TYPES.has(item.finding.type))
      .sort((a, b) => (b.end - b.start) - (a.end - a.start));

    return located
      .filter((item) => {
        if (item.start === -1) return true;
        return !containers.some((container) =>
          container !== item &&
          container.start <= item.start &&
          container.end >= item.end
        );
      })
      .sort((a, b) => a.order - b.order)
      .map((item) => item.finding);
  }

  // Mask sensitive values before they're ever logged or displayed in full
  function mask(value) {
    if (value.length <= 6) return "*".repeat(value.length);
    return value.slice(0, 3) + "*".repeat(value.length - 6) + value.slice(-3);
  }

  async function scan(text) {
    if (!text || text.trim().length === 0) return [];

    try {
      const patternFindings = scanPatterns(text);
      const keywords = await getCompanyKeywords();
      const keywordFindings = findKeywordMatches(text, keywords);
      return resolveOverlappingFindings(text, [...patternFindings, ...keywordFindings]);
    } catch (err) {
      // Any unexpected detector failure must never block the send button.
      // Log and return clean so the pipeline continues normally.
      console.error("[Preflight] Layer1 scan error — failing open:", err);
      return [];
    }
  }

  function replaceValidAadhaar(text) {
    return text.replace(AADHAAR_REGEX, (match) =>
      isPlausibleAadhaar(match) ? SAFE_REPLACEMENTS.aadhaar : match
    );
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  async function sanitize(text) {
    if (!text) return "";

    let safeText = text;

    // Replace the most specific credential formats first.
    safeText = safeText.replace(
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC )?PRIVATE KEY-----|$)/g,
      SAFE_REPLACEMENTS.private_key
    );
    safeText = safeText.replace(ANTHROPIC_KEY_REGEX, SAFE_REPLACEMENTS.anthropic_key);
    safeText = safeText.replace(OPENAI_KEY_REGEX, SAFE_REPLACEMENTS.openai_key);
    safeText = safeText.replace(AWS_KEY_REGEX, SAFE_REPLACEMENTS.aws_key);
    safeText = safeText.replace(JWT_REGEX, SAFE_REPLACEMENTS.jwt);
    safeText = safeText.replace(DB_URL_REGEX, SAFE_REPLACEMENTS.db_url);
    safeText = safeText.replace(GENERIC_API_KEY_REGEX, SAFE_REPLACEMENTS.generic_secret);
    safeText = safeText.replace(HARDCODED_PASSWORD_REGEX, SAFE_REPLACEMENTS.hardcoded_password);
    safeText = safeText.replace(GST_REGEX, SAFE_REPLACEMENTS.gst);
    safeText = safeText.replace(PAN_REGEX, SAFE_REPLACEMENTS.pan);
    safeText = safeText.replace(IFSC_REGEX, SAFE_REPLACEMENTS.ifsc);
    safeText = safeText.replace(BANK_ACCOUNT_REGEX, SAFE_REPLACEMENTS.bank_account);
    safeText = replaceValidAadhaar(safeText);
    safeText = safeText.replace(PHONE_REGEX, SAFE_REPLACEMENTS.phone);
    safeText = safeText.replace(EMAIL_REGEX, SAFE_REPLACEMENTS.email);
    safeText = safeText.replace(FILE_REFERENCE_REGEX, (match, file) => match.replace(file, SAFE_REPLACEMENTS.file_reference));
    safeText = safeText.replace(ENV_ASSIGNMENT_REGEX, SAFE_REPLACEMENTS.env_content);
    safeText = safeText.replace(SOURCE_CODE_REGEX, SAFE_REPLACEMENTS.source_code);

    const keywords = await getCompanyKeywords();
    keywords
      .filter((keyword) => typeof keyword === "string" && keyword.length > 0)
      .sort((a, b) => b.length - a.length)
      .forEach((keyword) => {
        safeText = safeText.replace(
          new RegExp(escapeRegExp(keyword), "gi"),
          SAFE_REPLACEMENTS.company_keyword
        );
      });

    return safeText;
  }

  function replacementFor(type) {
    return SAFE_REPLACEMENTS[type] || "[REDACTED]";
  }

  function highestRisk(findings) {
    const order = ["critical", "high", "medium", "low"];
    for (const level of order) {
      if (findings.some((f) => f.riskLevel === level)) return level;
    }
    return "none";
  }

  window.SentinelDetectors = { scan, sanitize, replacementFor, highestRisk };
})();
