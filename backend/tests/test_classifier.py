"""
tests/test_classifier.py — Classifier unit and integration tests

Tests require the trained model to exist:
    python models/train_classifier.py

Run:
    cd backend
    .venv/bin/python -m pytest tests/test_classifier.py -v
"""

from __future__ import annotations

import sys
import os
import pathlib

# Ensure backend root is on the path
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

import pytest
from models.text_classifier import predict, ClassifyResult, CONTENT_TYPES
from main import _compute_risk

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SENSITIVE_TYPES = {
    "contract", "financial_report", "hr_doc",
    "source_code", "strategy_doc", "customer_data",
}
ALL_TYPES = set(CONTENT_TYPES)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def assert_result_valid(result: ClassifyResult) -> None:
    """Assert all structural invariants of a ClassifyResult."""
    assert result.content_type in ALL_TYPES, (
        f"content_type '{result.content_type}' not in {ALL_TYPES}"
    )
    assert 0.0 <= result.confidence <= 1.0, (
        f"confidence {result.confidence} out of [0,1]"
    )
    assert set(result.all_scores.keys()) == ALL_TYPES, (
        f"all_scores keys mismatch: {set(result.all_scores.keys())}"
    )
    total = sum(result.all_scores.values())
    assert abs(total - 1.0) < 0.002, f"all_scores sum {total} not ≈ 1.0"
    assert abs(result.confidence - result.all_scores[result.content_type]) < 1e-6, (
        "confidence != all_scores[content_type]"
    )


# ---------------------------------------------------------------------------
# Structural invariant tests
# ---------------------------------------------------------------------------

class TestClassifyResultInvariants:

    def test_contract_prompt_returns_valid_result(self):
        text = (
            "This service agreement between Tata Consultancy Services Pvt Ltd and "
            "HDFC Bank governs IT outsourcing for 5 years at a value of 80 crore."
        )
        result = predict(text)
        assert_result_valid(result)

    def test_source_code_prompt_returns_valid_result(self):
        text = (
            "def calculate_gst(amount, rate=0.18):\n"
            "    return round(amount * rate, 2)\n"
            "print(calculate_gst(50000))"
        )
        result = predict(text)
        assert_result_valid(result)

    def test_general_prompt_returns_valid_result(self):
        text = "Can you help me write a professional email to reschedule a meeting?"
        result = predict(text)
        assert_result_valid(result)

    def test_financial_prompt_returns_valid_result(self):
        text = (
            "Infosys Q3 FY2024 revenue was 38318 crore, EBIT margin 20.5 percent, "
            "headcount 317240, attrition 12.9 percent."
        )
        result = predict(text)
        assert_result_valid(result)

    def test_hr_doc_prompt_returns_valid_result(self):
        text = (
            "Dear Ananya Sharma, we are pleased to offer you the role of Senior Analyst "
            "at Wipro Ltd with a CTC of 18 lakh per annum effective April 1 2024."
        )
        result = predict(text)
        assert_result_valid(result)

    def test_strategy_doc_prompt_returns_valid_result(self):
        text = (
            "Five-year growth plan for Meesho: expand supplier base to 2 million, "
            "reduce logistics cost to 40 rupees per shipment, enter Southeast Asia market."
        )
        result = predict(text)
        assert_result_valid(result)

    def test_customer_data_prompt_returns_valid_result(self):
        text = (
            "CRM export for Q4: 450 enterprise leads in Mumbai, average deal size 12 lakh, "
            "contact names and renewal dates included."
        )
        result = predict(text)
        assert_result_valid(result)

    def test_all_scores_has_exactly_seven_keys(self):
        result = predict("Hello, can you help me plan a team outing?")
        assert len(result.all_scores) == 7

    def test_probabilities_sum_to_one(self):
        result = predict("SELECT * FROM orders WHERE status = 'pending';")
        total = sum(result.all_scores.values())
        assert abs(total - 1.0) < 0.002

    def test_confidence_equals_all_scores_top(self):
        result = predict("Non-disclosure agreement signed between two parties in Mumbai.")
        assert abs(result.confidence - result.all_scores[result.content_type]) < 1e-6

    def test_empty_ish_text_does_not_crash(self):
        result = predict("a")
        assert_result_valid(result)

    def test_unicode_text_does_not_crash(self):
        result = predict("राजस्व 5 करोड़ रुपये है। कृपया इसे समझाएं।")
        assert_result_valid(result)

    def test_long_text_does_not_crash(self):
        text = "This is a test prompt for a vendor agreement. " * 400
        result = predict(text[:20_000])
        assert_result_valid(result)

    def test_returns_classify_result_type(self):
        result = predict("What is the best way to manage a remote team?")
        assert isinstance(result, ClassifyResult)


# ---------------------------------------------------------------------------
# Content type accuracy tests (realistic examples)
# ---------------------------------------------------------------------------

class TestContentTypeAccuracy:

    REALISTIC_CASES = [
        # (text, expected_label)
        (
            "This vendor agreement between Reliance Industries Ltd and Bosch India Ltd "
            "governs supply of automotive components at a value of 45 crore per year.",
            "contract",
        ),
        (
            "Employee offer letter for Rohit Mehta joining Bajaj Auto Ltd as Finance Manager "
            "with CTC of 22 lakh per annum and a joining bonus of 2 lakh.",
            "hr_doc",
        ),
        (
            "Zomato Q3 FY2024 revenue was 3288 crore, adjusted EBITDA 227 crore positive, "
            "food delivery GOV 9635 crore.",
            "financial_report",
        ),
        (
            "import pandas as pd\ndf = pd.read_csv('sales.csv')\ndf['total'] = df['qty'] * df['price']",
            "source_code",
        ),
        (
            "Five-year strategic roadmap for Ola Electric: reach 2 lakh EV sales per month, "
            "expand charging network to 50000 points, enter European market by 2027.",
            "strategy_doc",
        ),
        (
            "CRM export with 1200 enterprise leads, contact names, deal values from 5 to 80 lakh, "
            "renewal dates, and account manager assignments.",
            "customer_data",
        ),
        (
            "Can you suggest some tips for writing a more compelling executive summary?",
            "general",
        ),
        (
            "SELECT employee_id, name, salary FROM employees ORDER BY salary DESC LIMIT 10;",
            "source_code",
        ),
        (
            "Non-disclosure agreement requires both parties to keep product roadmaps confidential "
            "for 3 years under penalty of 10 lakh per breach.",
            "contract",
        ),
        (
            "Payroll for October 2024: basic 90000, HRA 36000, PF deduction 10800, net pay 96200.",
            "hr_doc",
        ),
    ]

    @pytest.mark.parametrize("text,expected", REALISTIC_CASES)
    def test_realistic_example_correct_label(self, text, expected):
        result = predict(text)
        assert result.content_type == expected, (
            f"Expected '{expected}', got '{result.content_type}' "
            f"(confidence={result.confidence:.3f})\nText: {text[:80]}..."
        )

    def test_contract_text_not_classified_as_general(self):
        text = (
            "Master services agreement between Infosys Ltd and State Bank of India for "
            "core banking operations, SLA 99.9 percent, penalty 5 lakh per hour breach."
        )
        result = predict(text)
        assert result.content_type != "general"

    def test_source_code_not_classified_as_financial(self):
        text = "def compute_emi(p, r, n):\n    r = r/12/100\n    return p * r * (1+r)**n / ((1+r)**n - 1)"
        result = predict(text)
        assert result.content_type == "source_code"

    def test_general_non_sensitive_classified_correctly(self):
        texts = [
            "What are some effective team building activities for remote teams?",
            "Help me draft a thank you note for a departing colleague.",
            "Explain compound interest with a simple example.",
        ]
        for text in texts:
            result = predict(text)
            assert result.content_type == "general", (
                f"Expected 'general', got '{result.content_type}' for: {text[:60]}"
            )

    def test_financial_report_contains_crore_amounts(self):
        text = (
            "HDFC Bank Q4 FY2024 net interest income was 29076 crore, net NPA 0.33 percent, "
            "total advances 25 lakh crore, capital adequacy ratio 18.8 percent."
        )
        result = predict(text)
        assert result.content_type == "financial_report"

    def test_hr_doc_offer_letter(self):
        text = (
            "Dear Priya Reddy, this is to confirm your appointment as Senior Product Manager "
            "at Freshworks with a fixed annual CTC of 32 lakh effective June 1 2024."
        )
        result = predict(text)
        assert result.content_type == "hr_doc"

    def test_customer_data_crm_export(self):
        text = (
            "Export from Salesforce: 800 accounts with contact name, ARR, last activity, "
            "renewal month, and assigned customer success manager."
        )
        result = predict(text)
        assert result.content_type == "customer_data"

    def test_strategy_doc_roadmap(self):
        text = (
            "FY2026 strategic priorities for Bajaj Finance: grow AUM to 5 lakh crore, "
            "launch credit card, expand to 600 new cities, hire 15000 frontline staff."
        )
        result = predict(text)
        assert result.content_type == "strategy_doc"


# ---------------------------------------------------------------------------
# Confidence and scoring tests
# ---------------------------------------------------------------------------

class TestConfidenceScoring:

    def test_confidence_is_in_range(self):
        for text in [
            "This agreement is entered into between two parties.",
            "def hello(): return 'world'",
            "Can you help me write an email?",
        ]:
            result = predict(text)
            assert 0.0 <= result.confidence <= 1.0

    def test_all_scores_values_are_non_negative(self):
        result = predict("Quarterly revenue report shows EBITDA of 450 crore.")
        for cls, score in result.all_scores.items():
            assert score >= 0.0, f"Negative score for {cls}: {score}"

    def test_all_scores_values_are_at_most_one(self):
        result = predict("Annual performance appraisal for Rahul Singh.")
        for cls, score in result.all_scores.items():
            assert score <= 1.0 + 1e-6, f"Score > 1 for {cls}: {score}"

    def test_top_score_equals_confidence(self):
        result = predict("Create a Python function to validate GSTIN.")
        max_score = max(result.all_scores.values())
        assert abs(result.confidence - max_score) < 1e-6


class TestRiskScoring:

    def test_agreement_prompt_with_legal_terms_is_high_risk_contract(self):
        text = (
            "This agreement shall commence on the effective date and remain in force "
            "for 12 months. The client shall pay ₹5 lakh upon signing. Either party "
            "may terminate the agreement with 30 days written notice. All disputes "
            "shall be governed by the laws of India."
        )
        result = predict(text)
        risk_level, layer3_would_trigger = _compute_risk(
            result.content_type,
            result.confidence,
            "growth",
            text,
        )

        assert result.content_type == "contract"
        assert risk_level == "high"
        assert layer3_would_trigger is False


# ---------------------------------------------------------------------------
# Benchmark accuracy test (must achieve >= 80%)
# ---------------------------------------------------------------------------

BENCHMARK_EXAMPLES = [
    ("This non-disclosure agreement between Naukri.com and a data analytics startup prohibits disclosure of proprietary algorithms.", "contract"),
    ("Service agreement between Mahindra Logistics and a warehouse operator in Chennai at 18 rupees per sq ft per month.", "contract"),
    ("Amendment to consulting agreement extending engagement by 6 months at an additional fee of 1.2 crore.", "contract"),
    ("Infosys Q2 FY2025 revenue growth 3.1 percent constant currency, deal wins 2.4 billion USD.", "financial_report"),
    ("Balance sheet for a mid-size NBFC in Gujarat: total borrowings 4200 crore, net worth 780 crore.", "financial_report"),
    ("Cash flow statement FY2024 edtech startup: operations burned 45 crore, Series B raised 120 crore.", "financial_report"),
    ("Salary slip for March 2024: gross earnings 95000, PF employer 11400, professional tax 200, net pay 72400.", "hr_doc"),
    ("Warning letter to Ravi Kumar at Tata Steel for safety protocol violation on three occasions.", "hr_doc"),
    ("Transfer letter for Meena Pillai from Mumbai to Bengaluru, relocation allowance 2 lakh.", "hr_doc"),
    ("def parse_pan(pan: str) -> dict:\n    return {'state_code': pan[:2], 'holder_type': pan[3]}", "source_code"),
    ("SELECT emp_id, name, salary FROM employees WHERE department = 'Engineering' ORDER BY salary DESC;", "source_code"),
    ("kubectl apply -f deployment.yaml --namespace=production && kubectl rollout status deployment/api", "source_code"),
    ("Market opportunity assessment for BNPL targeting college students: TAM 4 crore students, ticket 3000.", "strategy_doc"),
    ("Geographic expansion roadmap for a Bengaluru cloud kitchen: enter Hyderabad and Chennai Q1.", "strategy_doc"),
    ("Board resolution authorizing international expansion in UAE and Singapore, budget 50 crore.", "strategy_doc"),
    ("Export of top 500 accounts from HubSpot CRM: ARR, industry, last activity, renewal month.", "customer_data"),
    ("Mobile wallet users with high churn risk: 12000 users not transacting in 60 days.", "customer_data"),
    ("Premium subscriber list for an OTT platform: 80000 annual plan holders with renewal dates.", "customer_data"),
    ("Can you give me ideas for a team lunch venue in Bengaluru for 15 people?", "general"),
    ("What are the key differences between waterfall and agile project management?", "general"),
    ("Help me write a short thank you note to my mentor who guided me through my MBA.", "general"),
    ("What is the best way to prepare for a PMP certification exam?", "general"),
    ("Explain what a SWOT analysis is and how to use it for career planning.", "general"),
    ("Quarterly management accounts: net revenue 340 crore, EBITDA 42 crore, margin 12.4 percent.", "financial_report"),
    ("Revised offer letter for re-joining Accenture India as Senior Manager, CTC 48 lakh.", "hr_doc"),
    ("const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY });", "source_code"),
    ("Competitive positioning for B2B SaaS startup: focus on manufacturing workflows, price 30 percent below Zoho.", "strategy_doc"),
    ("Dealer performance scorecard: 320 dealers ranked by sales volume and customer satisfaction.", "customer_data"),
    ("Patient list for chronic disease management: 2800 diabetic patients with HbA1c and physician.", "customer_data"),
    ("This non-compete agreement restricts the departing executive from joining competitors for 12 months.", "contract"),
]


class TestBenchmarkAccuracy:

    def test_benchmark_suite_achieves_80_percent(self):
        correct = 0
        failures = []
        for text, expected in BENCHMARK_EXAMPLES:
            result = predict(text)
            if result.content_type == expected:
                correct += 1
            else:
                failures.append((expected, result.content_type, text[:60]))

        accuracy = correct / len(BENCHMARK_EXAMPLES)
        if failures:
            failure_msgs = "\n".join(
                f"  expected={e}, got={g}: {t}..." for e, g, t in failures
            )
            print(f"\nMisclassified {len(failures)} benchmark examples:\n{failure_msgs}")

        assert accuracy >= 0.80, (
            f"Benchmark accuracy {accuracy:.3f} is below required 0.80 "
            f"({correct}/{len(BENCHMARK_EXAMPLES)} correct)"
        )
