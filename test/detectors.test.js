const assert = require("node:assert/strict");

global.window = {};
global.chrome = { storage: { local: { get: (_keys, cb) => cb({ companyKeywords: ["Project Falcon"] }) } } };
require("../src/detectors.js");

async function expectType(text, type) {
  const findings = await window.SentinelDetectors.scan(text);
  assert(findings.some((finding) => finding.type === type), `${type} not detected in: ${text}`);
  const sanitized = await window.SentinelDetectors.sanitize(text);
  assert(!sanitized.includes(text), `${type} was detected but not replaced`);
}

(async () => {
  await expectType("27ABCDE1234F1Z5", "gst");
  await expectType("Call +91 9876543210", "phone");
  await expectType("Account Number: 1234567890123456", "bank_account");
  await expectType("SBIN0001234", "ifsc");
  await expectType("password = 'correct-horse-123'", "hardcoded_password");
  await expectType("Please review payroll.xlsx", "file_reference");
  await expectType("Project Falcon launch notes", "company_keyword");
  await expectType("const customerSecret = fetchSecret();", "source_code");

  const gstFindings = await window.SentinelDetectors.scan("27ABCDE1234F1Z5");
  assert(!gstFindings.some((finding) => finding.type === "phone"), "GSTIN misclassified as phone");
  const awsValue = "AKIAIOSFODNN7EXAMPLE";
  const awsFindings = await window.SentinelDetectors.scan(awsValue);
  const awsFinding = awsFindings.find((finding) => finding.type === "aws_key");
  assert.equal(awsFinding.detected, awsValue, "details view needs the exact locally detected value");
  assert.equal(window.SentinelDetectors.replacementFor("aws_key"), "[REDACTED_AWS_KEY]");

  const dbUrl = "postgresql://admin:Password123@prod-db.company.com:5432/app";
  const dbFindings = await window.SentinelDetectors.scan(dbUrl);
  assert.deepEqual(
    dbFindings.map((finding) => finding.type),
    ["db_url"],
    "credentials embedded in a DB URL must not be misclassified as email addresses"
  );

  const envApiKey = "API_KEY=sk_test_123456789abcdef";
  const envApiFindings = await window.SentinelDetectors.scan(envApiKey);
  assert.deepEqual(
    envApiFindings.map((finding) => finding.type),
    ["env_content"],
    "an API key inside an env assignment must produce one broad finding"
  );

  const envAwsKey = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
  const envAwsFindings = await window.SentinelDetectors.scan(envAwsKey);
  assert.deepEqual(
    envAwsFindings.map((finding) => finding.type),
    ["env_content"],
    "an AWS key inside an env assignment must produce one broad finding"
  );

  const standaloneEmailFindings = await window.SentinelDetectors.scan("Contact security@company.com");
  assert(
    standaloneEmailFindings.some((finding) => finding.type === "email"),
    "ordinary email addresses must still be detected"
  );

  // Regression: PAN must match regardless of case, same as GST already does.
  await expectType("PAN: zxcvb9876q", "pan");
  await expectType("PAN: ZxCvB9876q", "pan");

  // Regression: bracketed country code, e.g. "(+91)-9876543210", must not
  // get split so the match falls back to starting at the trailing dash.
  const bracketPhone = "(+91)-9876543210";
  const bracketFindings = await window.SentinelDetectors.scan(bracketPhone);
  const bracketPhoneFinding = bracketFindings.find((finding) => finding.type === "phone");
  assert(bracketPhoneFinding, "phone number in (+91)-XXXXXXXXXX format must be detected");
  assert.equal(
    bracketPhoneFinding.detected,
    bracketPhone,
    "bracketed country code must not be dropped or truncated"
  );

  // Regression: confirm the phone fix didn't loosen the prefix check —
  // 10-digit numbers not starting with 6-9 still must not match.
  const invalidMobileFindings = await window.SentinelDetectors.scan("Ref number: 5876543210");
  assert(
    !invalidMobileFindings.some((finding) => finding.type === "phone"),
    "10-digit numbers not starting with 6-9 must not be flagged as Indian mobile numbers"
  );

  console.log("detectors: all tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
