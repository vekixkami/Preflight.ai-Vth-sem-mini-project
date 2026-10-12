"""
train_classifier.py — Preflight Layer 2 Training Pipeline

Generates synthetic Indian-business-context training data, trains a
TF-IDF + Logistic Regression classifier, prints a held-out evaluation
report, and saves a {vectorizer, model} joblib bundle.

Run:
    python models/train_classifier.py

Output:
    data/training_data.csv
    saved_models/text_classifier.joblib
"""

from __future__ import annotations

import os
import sys
import pathlib

import joblib
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = pathlib.Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
SAVED_DIR = BASE_DIR / "saved_models"
DATA_DIR.mkdir(exist_ok=True)
SAVED_DIR.mkdir(exist_ok=True)

CSV_PATH = DATA_DIR / "training_data.csv"
MODEL_PATH = SAVED_DIR / "text_classifier.joblib"

# ---------------------------------------------------------------------------
# Acceptance thresholds
# ---------------------------------------------------------------------------

TRAIN_ACCURACY_THRESHOLD = 0.85
BENCHMARK_ACCURACY_THRESHOLD = 0.80

# ---------------------------------------------------------------------------
# Training data — 200 examples per category
# ---------------------------------------------------------------------------

CONTRACT_EXAMPLES = [
    "This vendor agreement is entered into between Reliance Industries Ltd and Tata Consultancy Services Pvt Ltd for supply of IT infrastructure services effective from April 1 2024.",
    "The non-disclosure agreement between Infosys Ltd and Wipro Technologies requires both parties to maintain confidentiality of shared technical specifications for a period of three years.",
    "Service level agreement between HDFC Bank and Oracle Financial Services stipulates 99.9 percent uptime with penalties of 5 lakh rupees per hour of breach.",
    "This master services contract between Mahindra and Mahindra Ltd and Bosch India Ltd governs the supply of automotive components to the Pune assembly plant.",
    "Consulting agreement executed between McKinsey and Company India and Larsen and Toubro Ltd for a strategy engagement valued at 3.2 crore rupees over six months.",
    "The software licensing agreement grants Bajaj Auto Ltd a non-exclusive right to use the ERP platform developed by SAP India for a term of five years.",
    "Lease agreement between DLF Commercial Developers and Flipkart Internet Pvt Ltd for 40000 square feet of office space in Bengaluru at a monthly rent of 85 lakh.",
    "This employment contract for senior vice president role at Hindustan Unilever Ltd includes a fixed component of 1.8 crore per annum plus performance bonus.",
    "Outsourcing agreement between State Bank of India and Tata Consultancy Services Pvt Ltd for core banking operations maintenance and enhancement services.",
    "The partnership deed between Sharma and Associates LLP and Kapoor Consulting LLP establishes a joint venture for providing audit services to mid-market firms.",
    "Purchase order agreement between Maruti Suzuki India Ltd and Motherson Sumi Systems for supply of wiring harnesses at 12000 units per month.",
    "Franchise agreement between Jubilant Foodworks Ltd and regional franchise partners in Hyderabad covers territory exclusivity, royalty of 6 percent, and quality standards.",
    "This indemnification clause in the software development agreement protects HCL Technologies from liability arising out of third-party IP infringement claims.",
    "Distribution agreement between Asian Paints Ltd and its dealer network in Tamil Nadu establishes credit terms of 45 days and minimum offtake of 200 units monthly.",
    "The arbitration clause in this contract between Adani Ports and SEZ Ltd and Shanghai International Port Group requires disputes to be resolved under ICC rules.",
    "Maintenance and support agreement between Mphasis Ltd and Axis Bank Ltd covers 24x7 helpdesk, quarterly software upgrades, and incident response within 4 hours.",
    "This agreement between Godrej Properties Ltd and HDFC Capital Advisors for joint development of a residential project in Mumbai involves a revenue share of 60:40.",
    "The subscription agreement between Zoho Corporation Pvt Ltd and enterprise clients specifies auto-renewal terms, data portability rights, and termination notice periods.",
    "Logistics services agreement between Amazon India and Blue Dart Express Ltd governs last-mile delivery SLAs, damage liability, and reverse logistics processes.",
    "This data processing agreement between Paytm Payments Bank and its payment gateway partners ensures DPDP Act compliance and data residency within India.",
    "Memorandum of understanding between ITC Ltd and Karnataka government for setting up an agro-processing unit near Mysuru with investment of 250 crore rupees.",
    "The confidentiality clause prevents either party from disclosing proprietary pricing, customer lists, or product roadmaps shared during due diligence.",
    "Software development agreement between Persistent Systems and Deutsche Bank India for building a fixed income trading platform with a project value of 18 crore.",
    "This contract between Sun Pharmaceutical Industries and a contract research organisation in Hyderabad covers Phase II clinical trial support for 24 months.",
    "Agency agreement appointing Aon India Insurance Brokers as exclusive broker for Tata Motors Ltd fleet insurance covering 8000 vehicles across 14 states.",
    "Vendor onboarding agreement with Nykaa Fashion Pvt Ltd requires suppliers to maintain minimum 95 percent fill rate and accept return terms within 30 days.",
    "The escrow arrangement in this acquisition agreement between Zomato Ltd and a hyperlocal delivery startup protects against undisclosed liabilities post-closing.",
    "Turnkey construction contract between Shapoorji Pallonji and Company and NTPC Ltd for building a 500 MW solar power plant in Rajasthan at a fixed price of 1800 crore.",
    "This letter of intent between Ola Electric Mobility and a battery cell manufacturer in Pune outlines proposed supply volumes and pricing for lithium-ion cells.",
    "Master vendor agreement with Infosys BPM Ltd includes clauses on subcontracting restrictions, background verification requirements, and IP ownership of work products.",
    "The force majeure clause in this contract between Tata Power and Maharashtra State Electricity Distribution Company covers grid failure, floods, and government orders.",
    "Revenue sharing agreement between Times Internet Ltd and content creators specifies 70 percent creator share on premium subscription revenue.",
    "This agreement between ICICI Bank and Fincare Small Finance Bank for co-lending to MSME borrowers specifies risk sharing ratios and collection responsibilities.",
    "Maintenance contract for industrial equipment between Bharat Heavy Electricals Ltd and National Thermal Power Corporation covers scheduled maintenance and emergency repairs.",
    "The licensing and royalty agreement between Cipla Ltd and a generic pharma partner in Bangladesh grants rights to manufacture and sell specific molecules.",
    "Facility management agreement between Jones Lang LaSalle India and Embassy Office Parks REIT covers housekeeping, security, mechanical and electrical maintenance.",
    "This share purchase agreement between Sequoia Capital India and a Series B fintech startup in Bengaluru values the company at 480 crore rupees pre-money.",
    "Reseller agreement between Dell Technologies India and regional IT solution providers sets discount tiers, deal registration process, and quarterly target quotas.",
    "Content licensing agreement between Sony Pictures Entertainment India and Jio Cinema for streaming rights to a film library covers a two-year exclusive window.",
    "The limitation of liability clause in this IT services agreement caps vendor liability at three months of fees paid, excluding willful misconduct.",
    "Cloud services agreement between Microsoft Azure and Bajaj Finserv Ltd includes data sovereignty commitments, SLA credits, and disaster recovery provisions.",
    "This cooperation agreement between Reliance Jio Infocomm and a tower infrastructure company covers co-location fees, power charges, and maintenance access.",
    "Service contract between Apollo Hospitals and a medical equipment leasing company covers preventive maintenance for MRI and CT scan machines across Chennai facilities.",
    "Non-compete agreement between Swiggy and a departing senior executive restricts joining competing food delivery platforms for 12 months after exit.",
    "This agreement between SEBI-registered portfolio manager and an HNI client in Mumbai governs discretionary portfolio management for a corpus of 5 crore.",
    "The earn-out provision in this M&A agreement between Freshworks and an acquired SaaS startup ties 40 crore of the consideration to three-year revenue targets.",
    "Warehousing and logistics agreement between Myntra Fashion Brands and Delhivery Ltd covers order fulfilment SLAs, inventory reconciliation, and damage norms.",
    "This technical assistance agreement between Bharat Electronics Ltd and an Israeli defence company covers know-how transfer and joint production of radar systems.",
    "Franchise development agreement between Burger King India and a master franchisee in Pune requires opening 15 restaurants within 3 years with minimum capital of 8 crore.",
    "The assignment clause in this software contract between Mindtree Ltd and an insurance company prohibits transfer of rights to third parties without written consent.",
]

FINANCIAL_REPORT_EXAMPLES = [
    "Tata Consultancy Services Q3 FY2024 revenue stood at 60583 crore rupees, up 4.5 percent year-on-year, with EBIT margin of 24.2 percent.",
    "Infosys full year FY2023 net profit was 24108 crore, operating cash flow conversion at 101 percent, with headcount of 343234 employees.",
    "HDFC Bank balance sheet as of March 31 2024 shows total assets of 36 lakh crore, net NPA ratio of 0.33 percent, and capital adequacy ratio of 18.8 percent.",
    "Reliance Industries consolidated EBITDA for FY2024 was 178677 crore rupees with net debt reduced to 114721 crore after rights issue proceeds.",
    "Bajaj Finance Q2 FY2024 AUM grew to 330615 crore, net interest income was 8838 crore, and gross NPA stood at 0.91 percent.",
    "Zomato quarterly P&L shows food delivery GOV of 9635 crore in Q3 FY24, adjusted EBITDA positive at 227 crore, revenue from operations at 3288 crore.",
    "Axis Bank FY2024 annual report shows net interest margin of 4.11 percent, return on equity of 18.4 percent, and branch network of 5377.",
    "Wipro IT services segment revenue for FY2023 was 89389 crore with operating margin of 16.3 percent and free cash flow of 10756 crore.",
    "Asian Paints standalone revenue for FY2024 was 34490 crore, EBITDA margin at 18.7 percent, volume growth of 6.2 percent in decorative segment.",
    "Maruti Suzuki FY2024 net sales were 141845 crore, PAT of 13488 crore, with domestic market share of 42 percent and 20 lakh vehicles produced.",
    "Kotak Mahindra Bank Q4 FY2024 net interest income was 6909 crore, provisions and contingencies 601 crore, return on assets 2.40 percent.",
    "HCL Technologies revenue in FY2024 crossed 1 lakh crore for the first time, with product and platforms business contributing 23 percent of revenue.",
    "Sun Pharmaceutical FY2023 global sales at 42320 crore, US formulations business 14200 crore, R&D spend 1998 crore representing 7.5 percent of revenue.",
    "Hindustan Unilever Q1 FY2024 results show domestic consumer business growth of 2 percent, underlying volume growth of 3 percent, EBIT margin 23.4 percent.",
    "ITC Ltd FY2024 FMCG business revenue crossed 20000 crore, cigarette segment EBIT at 15678 crore, agribusiness revenue 26432 crore.",
    "Larsen and Toubro FY2023 order book at a record 3.84 lakh crore, revenue from operations 192100 crore, international revenue 46 percent of total.",
    "Nykaa Q3 FY2024 GMV was 3340 crore, net revenue 1854 crore, adjusted EBITDA margin 5.2 percent, beauty segment contributing 80 percent of GMV.",
    "Paytm FY2024 revenue from operations grew 25 percent to 9978 crore, adjusted EBITDA loss narrowed to 559 crore, loan disbursements of 52206 crore.",
    "Adani Green Energy FY2024 EBITDA was 7753 crore, capacity addition of 2848 MW taking total operational capacity to 10934 MW.",
    "Godrej Properties FY2024 bookings reached a record 22527 crore, collections of 13054 crore, with new launches planned in Bengaluru and Pune.",
    "Interglobe Aviation IndiGo Q4 FY2024 revenue was 19573 crore, EBITDAR margin 23.4 percent, fleet of 370 aircraft with 2000 daily flights.",
    "Titan Company FY2024 jewellery segment revenue 33765 crore, watches and wearables 3847 crore, international business from Tanishq stores in USA.",
    "Dabur India FY2023 consolidated revenue 12143 crore, rural contribution 47 percent, healthcare segment grew 15 percent year-on-year.",
    "Power Finance Corporation half-year FY2024 disbursements were 110540 crore, net NPA 0.60 percent, net interest income 8976 crore.",
    "Mahanagar Gas Ltd Q2 FY2024 total volumes 3.62 MMSCMD, EBITDA 441 crore, CNG station count reached 325 in Mumbai metropolitan area.",
    "Motherson Sumi Wiring India Q3 FY24 revenue was 1768 crore, EBITDA margin 12.6 percent, order book at 47000 crore over 5 years.",
    "Mphasis FY2024 revenue 14212 crore, direct international revenue from top 10 clients grew 3.4 percent, headcount at 34985.",
    "Shriram Finance FY2024 AUM 241858 crore, gross NPA 5.53 percent, disbursements 134000 crore with used vehicle financing at 65 percent of portfolio.",
    "TVS Motor Company FY2024 revenue 35041 crore, two-wheeler domestic volumes 39.2 lakh units, electric vehicle sales grew 80 percent to 2.03 lakh units.",
    "Biocon FY2023 revenue 9350 crore, biologics segment 4640 crore growing 23 percent, research services at Syngene 3178 crore.",
    "Crompton Greaves Consumer Q3 FY24 revenue 1752 crore, ECD segment EBIT margin 14.2 percent, new products contributed 17 percent of revenue.",
    "Dixon Technologies FY2024 revenue 18142 crore, mobile and EMS segment grew 62 percent, Samsung manufacturing volume 130 lakh units.",
    "Exide Industries FY2024 net sales 14742 crore, automotive segment 61 percent of revenue, industrial segment 39 percent, capex 1200 crore.",
    "Affle India FY2024 revenue 1646 crore, CPCU revenue 1522 crore, conversions delivered 70 crore with international revenue 51 percent.",
    "Persistent Systems Q4 FY2024 revenue 2898 crore, EBIT margin 14.8 percent, total contract value of deals won 580 million USD in FY2024.",
    "Indigo Paints FY2024 revenue 1415 crore, volume growth 14 percent, gross margin expansion 170 basis points to 57.4 percent.",
    "AU Small Finance Bank Q2 FY2024 NII 1560 crore, loan book 72000 crore, GNPA 1.74 percent, deposits mobilised 73000 crore.",
    "Havells India FY2024 revenue 17351 crore, Lloyd consumer and industrial segment 4912 crore, switches and accessories 3212 crore.",
    "PVR INOX FY2024 total revenues 5874 crore, footfalls 97 million, average ticket price 264 rupees, food and beverage spend 131 rupees per head.",
    "Laurus Labs Q3 FY2024 API segment revenue 753 crore, formulations 218 crore, synthesis segment 156 crore, R&D investment 141 crore.",
    "TeamLease Services FY2024 revenue 9186 crore, general staffing headcount 2.98 lakh, net revenue per associate 3340 rupees per month.",
    "Polycab India FY2024 wires and cables revenue 16118 crore, FMEG segment 1681 crore, international business 1148 crore.",
    "Mahindra and Mahindra FY2024 auto segment revenue 90741 crore, SUV domestic volume 5.44 lakh vehicles, tractor market share 41 percent.",
    "Torrent Pharmaceuticals FY2024 consolidated revenue 10166 crore, domestic formulations 4878 crore, Germany business 1342 crore.",
    "Nippon Life India Asset Management FY2024 average AUM 373000 crore, mutual fund equity AUM 204000 crore, operating profit 625 crore.",
    "Prestige Estates Projects FY2024 pre-sales 21040 crore, collections 13020 crore, launch pipeline 58000 crore across Bengaluru, Hyderabad, Mumbai.",
    "Jubilant Foodworks FY2024 total revenue 6062 crore, Dominos India same-store sales growth 2.8 percent, new store count 232 in FY24.",
    "Kaynes Technology FY2024 revenue 1820 crore, EBITDA margin 14.1 percent, order book 7800 crore, aerospace and defence segment 22 percent.",
    "Bandhan Bank FY2024 gross loan book 131782 crore, microfinance portfolio 45 percent, net NPA declined to 1.53 percent.",
    "Bata India FY2024 revenue 3441 crore, EBITDA margin 21.3 percent, retail network 1838 stores, e-commerce contribution 12 percent of revenue.",
]

HR_DOC_EXAMPLES = [
    "Dear Priya Sharma, we are pleased to offer you the position of Senior Software Engineer at Razorpay Pvt Ltd with a fixed CTC of 28 lakh per annum effective June 1 2024.",
    "Annual performance appraisal for Arjun Mehta, Associate Product Manager at Swiggy, rating: Exceeds Expectations, increment of 18 percent, promotion to Product Manager.",
    "Payroll summary for March 2024: basic salary 85000, HRA 34000, special allowance 21000, PF deduction 10200, TDS deducted 14500, net pay 115300.",
    "Exit interview notes for Kavya Reddy, Data Scientist at Flipkart, tenure 2 years 4 months, reason for leaving: better compensation offer from a Bengaluru startup.",
    "Offer letter for Rohit Joshi, position of Finance Manager at Mahindra Finance, CTC 22 lakh per annum, joining bonus 2 lakh, reporting to CFO.",
    "Employee promotion letter for Sunita Patel confirming elevation to AVP Operations at ICICI Bank from April 1, with revised CTC of 45 lakh per annum.",
    "HR policy update: work from home allowance of 5000 per month for employees at Infosys with remote work arrangement approved before March 2023.",
    "Increment letter for Vikram Singh: based on your FY2024 performance rating of 4.2 out of 5 at Wipro, your salary is revised from 18 lakh to 21.6 lakh effective April 1.",
    "Relieving letter for Deepika Rao confirming her last working day at HCL Technologies was April 30 2024, all dues cleared, no dues certificate issued.",
    "Variable pay disbursement notice: for FY2024 Q4 target achievement of 112 percent, your incentive payout of 85000 rupees will be credited on May 15.",
    "Attendance regularisation policy: employees at Tata Motors must regularise attendance within 3 working days via SAP HCM portal with manager approval.",
    "Employee handbook update for Bajaj Auto: dress code policy, code of conduct, grievance redressal mechanism, and anti-harassment policy effective immediately.",
    "Maternity leave approval for Anjali Krishnan, Senior Analyst at Deloitte India, 26 weeks of paid maternity leave from July 15 2024, per the Maternity Benefit Act.",
    "Transfer letter for Aakash Gupta, Branch Manager at State Bank of India, transferred from Lucknow branch to Noida branch with effect from May 1 2024.",
    "Job description for Senior Data Engineer role at Paytm: 5-7 years experience, proficiency in PySpark, Kafka, and AWS, CTC range 35-45 lakh per annum.",
    "Background verification report for Sneha Iyer, joining as Legal Counsel at Tata Consultancy Services: education, employment, and criminal record checks cleared.",
    "Gratuity payment intimation for Ramesh Nair: after 7 years of service at L&T Finance, your gratuity payout of 4.76 lakh has been processed and credited.",
    "Training plan FY2024 for business analysts at Cognizant India: 40 hours mandatory learning on GenAI tools, JIRA advanced, and Agile SAFe certification.",
    "PF settlement letter for Pooja Verma: your employee provident fund claim of 3.28 lakh has been approved and will be credited to your registered bank account.",
    "Warning letter issued to Rajesh Kumar, Sales Executive at Maruti Suzuki dealer, for unauthorized absence of 9 days without prior intimation in March 2024.",
    "Performance improvement plan for Mohit Agarwal, Sr. Analyst at Accenture India: 90-day PIP with specific targets for client satisfaction and delivery quality.",
    "Offer rescission notice informing candidate that the job offer extended on March 15 has been withdrawn due to adverse findings in background verification.",
    "Employee referral bonus payout of 50000 rupees credited for successful referral of Nisha Menon who completed 6 months probation at Freshworks.",
    "Confirmation letter for Tejal Shah completing probation period of 6 months as Marketing Executive at Asian Paints, confirmed with revised CTC of 8 lakh.",
    "Relocation allowance of 1.5 lakh sanctioned for Kiran Bhat shifting from Chennai to Bengaluru for new role as Technical Lead at Mphasis.",
    "Stock option grant letter for Ananya Kapoor, Product Lead at Meesho: 4000 ESOPs granted at exercise price 450 rupees, vesting over 4 years.",
    "Full and final settlement statement for Suresh Pillai: earned leave encashment 42000, notice pay recovery 35000, gratuity 88000, net payable 95000.",
    "Bonus declaration for FY2024: all permanent employees at Godrej Consumer Products with rating 3 and above eligible for performance bonus payout in May.",
    "Flexi benefits claim for medical reimbursement under Axis Bank employee benefits policy: OPD expenses of 12500 submitted with supporting receipts.",
    "Succession planning document identifies three internal candidates for the Regional Head role at Kotak Mahindra Bank in case of vacancy.",
    "New hire onboarding checklist for Rahul Sharma joining Zomato as Senior Backend Engineer: laptop setup, access credentials, buddy assignment, and induction schedule.",
    "Promotion recommendation for Meera Nair from Deputy Manager to Manager at HDFC Life: exceeds targets consistently over 3 years, ready for next level.",
    "Leave policy update at Byju's: casual leave 12 days, sick leave 12 days, privilege leave 21 days, no carry-forward for casual and sick leave.",
    "Disciplinary enquiry notice served to Shiv Rajan for alleged disclosure of customer data to a competitor, response required within 7 days.",
    "Annual appraisal review for team of 12 software engineers at Persistent Systems: 3 rated exceptional, 7 meeting expectations, 2 on improvement plan.",
    "Retention bonus letter for Priyanka Das: to retain critical talent, a retention bonus of 8 lakh will be paid if you continue with Tech Mahindra for 18 months.",
    "CTC breakup sheet for Nikhil Bose joining Tata Digital: basic 1.2 lakh, HRA 48000, LTA 10000, medical allowance 1250, PF 14400, total CTC 29 lakh.",
    "Paternity leave policy at Infosys: 5 days paid paternity leave available to male employees within 6 months of birth or adoption of a child.",
    "Internal job posting for Finance Controller at Bajaj Finance: open for employees with minimum 3 years at band M6 and above, apply via HR portal by May 31.",
    "Compensation benchmarking report FY2024: software engineers at P50 earn 18 lakh, P75 earn 24 lakh, P90 earn 32 lakh across Bengaluru tech companies.",
    "Reimbursement claim for Anjali Singh: travel to Mumbai client site 3 days, hotel 4500 per night, meals 1000 per day, total claim 16500 rupees approved.",
    "Sexual harassment complaint filed under POSH Act: internal committee at Wipro constituted, preliminary inquiry to be completed within 30 days.",
    "Notice period buyout approved for Akash Sharma: 1.5 months remaining notice period waived by manager, full FFS to be settled within 30 days.",
    "Employee satisfaction survey results Q4 FY2024: overall engagement score 74 percent, highest in Pune centre, lowest in Hyderabad back-office team.",
    "Offer letter for Nandita Rao, position of Head of Legal at Nykaa Fashion Pvt Ltd: CTC 55 lakh, joining bonus 5 lakh, ESOPs 2000 units at 800 strike price.",
    "Variable compensation structure for sales team at ICICI Securities: base 12 lakh, monthly commission up to 3 percent on net revenue generated.",
    "Probation extension notice for Ravi Prabhu: performance during 6-month probation at HCL did not meet expectations, probation extended by 3 months.",
    "HR circular on revised conveyance allowance: effective April 1 2024, petrol reimbursement capped at 6000 per month for employees using personal vehicles.",
    "Salary revision letter for Vikram Iyer post mid-year review at Oracle India: base revised from 22 lakh to 26 lakh, effective October 1 2024.",
    "Internship offer letter for Preeti Agarwal for 6 months at Goldman Sachs India: stipend 50000 per month, based in Bengaluru, pre-placement offer eligible.",
]

SOURCE_CODE_EXAMPLES = [
    "def calculate_gst(amount, rate=0.18): return round(amount * rate, 2)\n\nif __name__ == '__main__':\n    print(calculate_gst(50000))",
    "import pandas as pd\nimport numpy as np\n\ndf = pd.read_csv('sales_data.csv')\ndf['revenue_crore'] = df['revenue'] / 1e7\nprint(df.groupby('region')['revenue_crore'].sum())",
    "SELECT c.customer_name, SUM(o.order_value) as total_spend\nFROM customers c\nJOIN orders o ON c.id = o.customer_id\nWHERE o.order_date >= '2024-01-01'\nGROUP BY c.customer_name\nHAVING SUM(o.order_value) > 100000\nORDER BY total_spend DESC;",
    "const fetchInvoices = async (orgId) => {\n  const res = await fetch(`/api/invoices?org=${orgId}`, {\n    headers: { Authorization: `Bearer ${token}` }\n  });\n  return res.json();\n};",
    "public class PaymentProcessor {\n  private static final double GST_RATE = 0.18;\n\n  public double processPayment(double amount, String method) {\n    double tax = amount * GST_RATE;\n    logger.info(\"Processing {} payment of {} + {} GST\", method, amount, tax);\n    return amount + tax;\n  }\n}",
    "#!/bin/bash\nset -e\necho 'Deploying to production server in Mumbai datacenter'\ngit pull origin main\nnpm ci\nnpm run build\npm2 restart app.json\necho 'Deploy complete'",
    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: payment-service\n  namespace: fintech-prod\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: payment-service",
    "from sklearn.linear_model import LogisticRegression\nfrom sklearn.model_selection import train_test_split\n\nX_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)\nmodel = LogisticRegression(max_iter=1000)\nmodel.fit(X_train, y_train)\nprint(f'Accuracy: {model.score(X_test, y_test):.3f}')",
    "-- Migration: add_payment_status_column\nALTER TABLE transactions ADD COLUMN payment_status VARCHAR(20) DEFAULT 'pending';\nCREATE INDEX idx_payment_status ON transactions(payment_status);\nUPDATE transactions SET payment_status = 'completed' WHERE settled_at IS NOT NULL;",
    "class OrderService:\n    def __init__(self, db_session, redis_client):\n        self.db = db_session\n        self.cache = redis_client\n\n    def get_order(self, order_id: str) -> dict:\n        cached = self.cache.get(f'order:{order_id}')\n        if cached:\n            return json.loads(cached)\n        order = self.db.query(Order).filter_by(id=order_id).first()\n        return order.to_dict()",
    "terraform {\n  required_providers {\n    aws = { source = \"hashicorp/aws\", version = \"~> 5.0\" }\n  }\n}\n\nresource \"aws_s3_bucket\" \"reports\" {\n  bucket = \"preflight-audit-logs-india\"\n  tags   = { Environment = \"production\" }\n}",
    "import React, { useState, useEffect } from 'react';\n\nfunction SalesChart({ data }) {\n  const [chartData, setChartData] = useState([]);\n  useEffect(() => {\n    setChartData(data.map(d => ({ ...d, revenue: d.revenue / 1e7 })));\n  }, [data]);\n  return <BarChart data={chartData} />;\n}",
    "fn calculate_emi(principal: f64, rate: f64, months: u32) -> f64 {\n    let monthly_rate = rate / 12.0 / 100.0;\n    let factor = (1.0 + monthly_rate).powi(months as i32);\n    principal * monthly_rate * factor / (factor - 1.0)\n}",
    "package main\n\nimport (\n    \"encoding/json\"\n    \"net/http\"\n)\n\nfunc healthHandler(w http.ResponseWriter, r *http.Request) {\n    json.NewEncoder(w).Encode(map[string]string{\"status\": \"ok\"})\n}",
    "# Dockerfile\nFROM python:3.11-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD [\"uvicorn\", \"main:app\", \"--host\", \"0.0.0.0\", \"--port\", \"8000\"]",
    "describe('PaymentService', () => {\n  it('should apply 18% GST on B2C transactions', () => {\n    const result = PaymentService.applyTax(10000, 'B2C');\n    expect(result.gst).toBe(1800);\n    expect(result.total).toBe(11800);\n  });\n});",
    "version: '3.8'\nservices:\n  api:\n    build: .\n    ports: ['8000:8000']\n    environment:\n      - DATABASE_URL=postgresql://postgres:secret@db:5432/preflight\n  db:\n    image: postgres:15\n    volumes: ['pgdata:/var/lib/postgresql/data']",
    "async def process_webhook(payload: dict, signature: str) -> bool:\n    computed = hmac.new(SECRET_KEY.encode(), json.dumps(payload).encode(), sha256).hexdigest()\n    if not hmac.compare_digest(computed, signature):\n        raise HTTPException(status_code=401, detail='Invalid signature')\n    await handle_payment_event(payload)\n    return True",
    "data class Invoice(\n    val id: String,\n    val vendorName: String,\n    val amountRupees: Long,\n    val gstNumber: String,\n    val invoiceDate: LocalDate\n)",
    "GRANT SELECT, INSERT ON orders TO app_user;\nGRANT SELECT ON products TO readonly_user;\nREVOKE DELETE ON customers FROM dev_user;\nCREATE ROLE audit_role;\nGRANT audit_role TO analyst_user;",
    "def send_otp(phone_number: str) -> bool:\n    otp = ''.join([str(random.randint(0, 9)) for _ in range(6)])\n    redis.setex(f'otp:{phone_number}', 300, otp)\n    msg91_client.send_sms(phone_number, f'Your OTP is {otp}. Valid for 5 minutes.')\n    return True",
    "curl -X POST https://api.razorpay.com/v1/orders \\\n  -u key_id:key_secret \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"amount\": 50000, \"currency\": \"INR\", \"receipt\": \"order_rcpt_001\"}'",
    "class UserRepository:\n    def find_by_pan(self, pan: str) -> Optional[User]:\n        return self.session.execute(\n            select(User).where(User.pan_number == pan)\n        ).scalar_one_or_none()",
    "export const formatCurrency = (amount: number, currency = 'INR'): string => {\n  return new Intl.NumberFormat('en-IN', {\n    style: 'currency',\n    currency,\n    minimumFractionDigits: 2,\n  }).format(amount);\n};",
    "@app.route('/api/v2/classify', methods=['POST'])\n@jwt_required()\ndef classify_text():\n    data = request.get_json()\n    if not data or 'text' not in data:\n        return jsonify({'error': 'text field required'}), 422\n    result = classifier.predict(data['text'])\n    return jsonify(result)",
    "import boto3\n\ns3 = boto3.client('s3', region_name='ap-south-1')\ns3.upload_file('report.pdf', 'preflight-reports-india', f'audits/{date.today()}/report.pdf')\nprint('Audit report uploaded to S3 Mumbai')",
    "type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed';\n\ninterface Transaction {\n  id: string;\n  amount: number;\n  currency: 'INR';\n  status: PaymentStatus;\n  upiId?: string;\n  createdAt: Date;\n}",
    "def retry_with_backoff(func, max_retries=3, base_delay=1.0):\n    for attempt in range(max_retries):\n        try:\n            return func()\n        except Exception as e:\n            if attempt == max_retries - 1:\n                raise\n            time.sleep(base_delay * (2 ** attempt))",
    "name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: pip install -r requirements.txt\n      - run: pytest tests/ -v --tb=short",
    "SELECT DATE_TRUNC('month', created_at) as month,\n       COUNT(*) as total_orders,\n       SUM(order_value) as revenue,\n       AVG(order_value) as avg_order\nFROM orders\nWHERE status = 'delivered'\nGROUP BY 1\nORDER BY 1 DESC;",
    "abstract class BaseRepository<T, ID> {\n    protected abstract findById(id: ID): Promise<T | null>;\n    protected abstract save(entity: T): Promise<T>;\n    protected abstract delete(id: ID): Promise<void>;\n}",
    "logging.config.dictConfig({\n    'version': 1,\n    'handlers': {\n        'console': {'class': 'logging.StreamHandler'},\n        'file': {'class': 'logging.FileHandler', 'filename': '/var/log/preflight/app.log'}\n    },\n    'root': {'level': 'INFO', 'handlers': ['console', 'file']}\n})",
    "helm upgrade --install preflight-backend ./charts/backend \\\n  --namespace production \\\n  --set image.tag=$CI_COMMIT_SHA \\\n  --set replicaCount=3 \\\n  --wait --timeout 5m",
    "from celery import Celery\n\napp = Celery('tasks', broker='redis://localhost:6379/0')\n\n@app.task(bind=True, max_retries=3)\ndef send_invoice_email(self, invoice_id: str):\n    try:\n        invoice = Invoice.get(invoice_id)\n        mailer.send(invoice.email, render_template('invoice.html', invoice=invoice))\n    except Exception as exc:\n        raise self.retry(exc=exc, countdown=60)",
    "interface KYCDocument {\n  documentType: 'aadhaar' | 'pan' | 'passport' | 'driving_license';\n  documentNumber: string;\n  verified: boolean;\n  verifiedAt?: Date;\n  verifiedBy: string;\n}",
    "def validate_gstin(gstin: str) -> bool:\n    pattern = r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'\n    return bool(re.match(pattern, gstin))\n\n# Checksum validation\ndef compute_checksum(gstin: str) -> str:\n    chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'\n    # ... checksum logic",
    "pipeline:\n  stages:\n    - build\n    - test\n    - deploy\n  build:\n    script: docker build -t registry.internal/preflight-api:${CI_COMMIT_SHORT_SHA} .\n  test:\n    script: python -m pytest tests/ --cov=src --cov-report=xml",
    "const useInvoicePolling = (invoiceId: string) => {\n  const [status, setStatus] = useState<string>('pending');\n  useEffect(() => {\n    const interval = setInterval(async () => {\n      const data = await fetchInvoiceStatus(invoiceId);\n      setStatus(data.status);\n      if (data.status === 'paid') clearInterval(interval);\n    }, 3000);\n    return () => clearInterval(interval);\n  }, [invoiceId]);\n  return status;\n};",
    "# config.yaml\ndatabase:\n  host: db.internal.preflight.in\n  port: 5432\n  name: preflight_production\n  pool_size: 20\n  max_overflow: 40\nredis:\n  host: cache.internal.preflight.in\n  port: 6379\n  db: 0",
    "CREATE TABLE audit_logs (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  org_id VARCHAR(50) NOT NULL,\n  user_id VARCHAR(50),\n  action VARCHAR(100) NOT NULL,\n  resource TEXT,\n  timestamp TIMESTAMPTZ DEFAULT NOW(),\n  ip_address INET\n);",
    "// middleware/auth.go\nfunc JWTMiddleware(next http.Handler) http.Handler {\n    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {\n        token := r.Header.Get(\"Authorization\")\n        if _, err := validateJWT(token); err != nil {\n            http.Error(w, \"Unauthorized\", 401)\n            return\n        }\n        next.ServeHTTP(w, r)\n    })\n}",
    "class EmiCalculator:\n    @staticmethod\n    def calculate(principal: float, annual_rate: float, months: int) -> float:\n        monthly_rate = annual_rate / 100 / 12\n        return principal * monthly_rate * (1 + monthly_rate)**months / ((1 + monthly_rate)**months - 1)",
    "import redis\nr = redis.Redis(host='cache.internal', port=6379, db=0)\ndef cache_result(key: str, value: str, ttl: int = 300):\n    r.setex(key, ttl, value)",
    "npm run build -- --mode production && scp -r dist/ deploy@10.0.1.20:/var/www/html/",
    "for row in cursor.execute('SELECT id, name, amount FROM invoices WHERE status=?', ('pending',)):\n    process_invoice(row['id'], row['amount'])",
    "public interface PaymentGateway {\n    PaymentResponse charge(PaymentRequest request) throws PaymentException;\n    RefundResponse refund(String transactionId, long amountPaise);\n}",
    "import { createSlice, PayloadAction } from '@reduxjs/toolkit';\nconst cartSlice = createSlice({\n  name: 'cart',\n  initialState: [] as CartItem[],\n  reducers: { addItem: (state, action: PayloadAction<CartItem>) => { state.push(action.payload); } }\n});",
    "from pydantic import BaseModel, validator\nclass AadhaarInput(BaseModel):\n    number: str\n    @validator('number')\n    def must_be_12_digits(cls, v):\n        if not v.isdigit() or len(v) != 12:\n            raise ValueError('Invalid Aadhaar')\n        return v",
    "git log --oneline --since='2024-01-01' --author='Rahul' | wc -l\ngit diff main..feature/payment-v2 --stat",
    "server {\n    listen 443 ssl;\n    server_name api.preflight.in;\n    ssl_certificate /etc/letsencrypt/live/api.preflight.in/fullchain.pem;\n    location / { proxy_pass http://127.0.0.1:8000; }\n}",
]

STRATEGY_DOC_EXAMPLES = [
    "Q4 FY2025 strategic priorities for Zomato: accelerate Blinkit to 1000 dark stores, expand Hyperpure to Tier 2 cities, improve delivery partner earnings.",
    "Competitive analysis of UPI payment market: PhonePe holds 47 percent share, Google Pay 37 percent, Paytm 12 percent. NPCI cap at 30 percent creates strategic risk.",
    "Board presentation for Reliance Retail five-year roadmap: reach 10 lakh crore GMV by FY2029, integrate JioMart with offline stores, launch loyalty program.",
    "Go-to-market strategy for launching Tata Neu super app in Tier 2 India: partner with Tata Motors service centres, Croma stores, and Big Bazaar outlets.",
    "SWOT analysis of Ola Electric: strength – first mover advantage and manufacturing scale, weakness – service quality, opportunity – FAME III subsidies, threat – Chinese competition.",
    "Market entry strategy for Byju's in Gulf Cooperation Council markets: partner with local telecom operators, adapt curriculum for Arabic, target premium schools first.",
    "Three-year growth plan for Meesho social commerce: increase supplier base to 2 million, reduce logistics cost to 40 rupees per shipment, expand to 700 districts.",
    "Product roadmap FY2025 for CRED: launch CRED Pay for offline merchant payments, CRED Mint P2P lending at scale, CRED Garage auto services verticle.",
    "Cost optimization strategy for IndiGo FY2025: fuel hedging at 40 percent of consumption, reduce ground handling costs by 15 percent, optimize aircraft turnaround to 25 minutes.",
    "Digital transformation roadmap for State Bank of India: migrate 60 percent of transactions to YONO, reduce branch costs by 20 percent, achieve 10 crore active digital users.",
    "Pricing strategy memo for Zepto: maintain aggressive 10-minute delivery promise, absorb delivery costs until dark store density reaches profitability threshold of 1500 orders per day.",
    "M&A strategy for HCL Technologies FY2026: target product engineering companies in EU, focus on industrial IoT and automotive software, deal size 500-1500 crore.",
    "Revenue diversification strategy for Naukri JobsAhead parent Info Edge: expand 99acres into managed rentals, launch Shiksha test prep platform, double Zomato stake.",
    "Annual operating plan FY2025 for Bajaj Finance: grow AUM to 5 lakh crore, launch credit card product, expand to 600 new cities, hire 15000 frontline staff.",
    "Strategic review of Paytm business units: retain payments and financial services, spin off entertainment ticketing, explore strategic sale of Paytm Mall.",
    "Five-year vision document for HDFC Bank: become most valuable bank in Asia by market cap, achieve 20 percent ROE, maintain NPA below 1 percent of advances.",
    "Market expansion strategy for Delhivery: enter B2C cross-border shipping from India, acquire last-mile companies in Southeast Asia, build air freight network.",
    "Competitive positioning document for Freshworks against Zendesk and Salesforce in India mid-market: differentiate on price, local language support, and SME focus.",
    "Sustainability strategy for ITC Limited: net zero by 2050, 100 percent renewable electricity by 2030, plastic neutrality by 2027, watershed positive since 2007.",
    "Brand strategy memo for Mahindra: reposition as premium SUV manufacturer globally, target 50000 export units, partner with Volkswagen on electric platform.",
    "Regional expansion plan for Lenskart: open 500 stores in Tier 3 cities, launch in Indonesia and Middle East, target 1 crore eye tests annually through mobile vision camps.",
    "Digital strategy for ICICI Lombard: migrate 80 percent of claims to automated processing, launch embedded insurance on Amazon and Flipkart, target 35 percent market share.",
    "New vertical strategy for Swiggy: Instamart to reach 30 cities with 10-minute grocery delivery, launch cloud kitchen owned brands, expand Swiggy Genie.",
    "Partnership strategy for Zerodha: integrate with Smallcase for thematic investing, partner with direct mutual funds to retain AUM on platform, launch research products.",
    "Innovation pipeline for Biocon: 12 new biosimilar launches globally by 2027, enter peptide drug space, establish cell and gene therapy platform by 2030.",
    "Growth strategy for PolicyBazaar: expand health insurance renewal business, launch employee benefits B2B platform, enter Southeast Asia market with term life products.",
    "Network expansion strategy for Indigo: 10 new international routes by FY2026 including London and Melbourne, increase fleet to 600 aircraft, codeshare with Lufthansa.",
    "Platform strategy document for PharmEasy: integrate diagnostic labs with medicine delivery, build chronic disease management program for 50 lakh patients.",
    "FY2026 strategic goals for Vedanta: separate zinc, aluminium, and iron ore businesses into independently listed entities, reduce net debt to 1.5x EBITDA.",
    "Omnichannel strategy for Titan: drive 30 percent of Tanishq sales through digital channel, launch made-to-order jewellery online, integrate Helios watches in airport stores.",
    "International expansion strategy for Persistent Systems: grow BFSI vertical in UK by 40 percent, hire 500 engineers in Poland for nearshore delivery, acquire a Dutch digital agency.",
    "Enterprise AI strategy for Wipro: train 50000 employees on generative AI, launch 20 proprietary AI agents for client industries, target 1 billion USD in AI revenue.",
    "Customer acquisition strategy for AU Small Finance Bank: target salaried segment in Tier 2 cities with salary account, cross-sell FDs and insurance within 90 days.",
    "Channel strategy memo for Havells India: grow exclusive dealer network from 4000 to 6000 outlets, launch 100 Havells Galaxy premium showrooms in metros.",
    "Funding strategy for a Series C fintech startup: raise 200 crore to build credit scoring infrastructure, target strategic investment from HDFC Bank, plan for IPO in 2027.",
    "Crisis management strategy for e-commerce brand after supply chain disruption: activate backup suppliers in Ahmedabad, communicate proactively to 50000 affected customers.",
    "Key account management strategy for SAP India: dedicate 3-person teams to top 20 accounts, quarterly executive business reviews, target 20 percent expansion revenue.",
    "Pricing strategy for SaaS startup competing with Zoho: freemium tier with 5 users, professional at 2000 per month per 10 users, enterprise custom pricing above 100 users.",
    "AI-first product strategy for Razorpay: build fraud detection ML model for 100 million transactions per day, launch automated reconciliation for enterprise clients.",
    "IPO readiness roadmap for a B2B logistics company: appoint CFO, migrate to Ind AS reporting, hire Big Four auditor, target IPO in 18 months at 5000 crore valuation.",
    "FY2025 sales strategy for Larsen and Toubro construction: focus on data centre projects, increase order wins from defence sector, expand in Middle East markets.",
    "Talent strategy for a Bengaluru deep tech startup: hire 20 ML engineers from IITs, offer ESOPs at 1 percent cliff vesting, build applied research team.",
    "Regulatory strategy document for a NBFC applying for SFB licence: timeline for meeting net worth requirements, geographic coverage plan, product diversification roadmap.",
    "Content strategy for Sharechat: grow Moj short video MAU to 250 million, launch creator monetization program, invest 500 crore in original Tamil and Telugu content.",
    "Market penetration strategy for DriveU driver-on-demand in Tier 2 cities: partner with used car dealers, launch subscription plans for daily commuters.",
    "Cross-sell strategy for Kotak Mahindra Bank: offer home loan to 30 percent of savings account customers, life insurance to salary account holders, upsell to wealth management.",
    "FY2026 operational strategy for Swiggy: achieve unit economics profitability in 50 cities, reduce delivery time from 35 to 28 minutes, launch premium delivery tier.",
    "Ecosystem strategy for Tata Neu: integrate Tata Motors, Tata Housing, Air Asia India and Starbucks into unified rewards programme, target 10 crore active users.",
    "Vendor consolidation strategy for a Mumbai-based bank: reduce IT vendors from 80 to 25, negotiate volume discounts, standardise on AWS and Oracle infrastructure.",
    "Brand architecture strategy for Godrej Group after demerger: separate consumer goods, real estate, and professional products into distinct brand identities.",
    "Regional language strategy for a Bengaluru startup: localise product in 8 Indian languages, hire content teams in Chennai, Hyderabad and Ahmedabad, target 200 crore rural users.",
]

CUSTOMER_DATA_EXAMPLES = [
    "Customer account list export from Salesforce: Rahul Gupta, Axis Bank, Mumbai, deal value 45 lakh, stage: negotiation, close date April 30 2024.",
    "CRM export Q4 FY2024: 1200 enterprise leads, 340 converted, average deal size 12 lakh, churn rate 8 percent, NPS score 62 for Bengaluru region.",
    "Client contact database for Kotak Securities: Anita Sharma, CFO Godrej Properties, mobile 9820xxxxx, email anita@godrej.com, last contact March 15 2024.",
    "Prospect list for Mumbai insurance team: 45 HNI clients with investable surplus above 2 crore, introduction through CA network, warm leads from wealth conference.",
    "Customer segmentation report: Tier A clients with revenue above 50 lakh per year represent 8 percent of base but contribute 62 percent of HDFC Life premium income.",
    "Key account contact sheet for Oracle India sales team: 12 decision makers at Infosys, 8 at TCS, 15 at HCL with names, titles, phone numbers, and renewal dates.",
    "Churn risk report: 230 customers with declining order frequency in last 90 days, total ARR at risk 3.8 crore, recommended interventions by customer success team.",
    "Lead nurture list for Pune fintech startup: 890 CFOs of mid-market manufacturing companies, sourced from industry conference, open rate 18 percent on last email.",
    "Customer lifetime value analysis: top 500 Zomato Gold members in Hyderabad, average monthly spend 3200 rupees, average tenure 28 months, churn probability 12 percent.",
    "Client feedback survey results for Persistent Systems consulting practice: 18 of 22 clients rated delivery excellent, 3 satisfaction issues flagged at Pune account.",
    "Regional dealer master data: 2340 active distributors of Asian Paints across Rajasthan, contact names, credit limits ranging 2 lakh to 50 lakh, outstanding dues.",
    "Patient database export for Apollo Hospitals Chennai: 12000 patients with chronic conditions, last visit date, assigned doctor, and recommended follow-up schedule.",
    "School district contact list for Byju's sales team: 450 school principals in Lucknow with enrollment size, decision-maker details, and proposed subscription package.",
    "Investor CRM for a Mumbai VC fund: 200 LPs with commitment amounts, distribution history, preferred sectors, and annual meeting schedule.",
    "Retail store list for Marico distribution: 15000 kirana stores in Delhi NCR with FMCG monthly offtake data, priority retailer flags, and field executive assignments.",
    "E-commerce customer purchase history for Myntra: 5000 high-value customers with lifetime spend above 50000, last 10 orders, preferred brands, and return rate.",
    "B2B sales pipeline for Freshworks India: 45 mid-enterprise deals, contact names at each account, sales stage, expected close quarter, and deal value from 10 to 80 lakh.",
    "Insurance policyholder master for LIC branch Chandigarh: 8000 active policy holders, sum assured, premium due dates, nominee details, and agent code.",
    "Fleet customer database for HPCL petroleum: 340 transport companies in Gujarat with annual fuel consumption, credit facility amount, and account manager details.",
    "Retention call list for Vodafone Idea postpaid B2B: 1200 corporate accounts with MRC above 10000, number of SIMs, contract end dates, and churn probability score.",
    "School client list for edtech startup: 85 CBSE schools in Bengaluru enrolled in digital learning platform, student count, renewal month, and principal contact.",
    "Wholesale customer export for a Pune pharma distributor: 560 chemist shops with monthly purchase value, credit limit, last order date, and outstanding amount.",
    "Broker data for ICICI Securities: 1200 sub-brokers in Maharashtra with client count, monthly brokerage revenue, and assets under advice.",
    "Customer complaint log for Tata Nexon owners in Chennai: 120 complaints in last 6 months, issue type, resolution time, escalation status, and service centre.",
    "Recurring deposit customer file for Federal Bank: 4500 RD customers, monthly instalment, maturity date, auto-renewal preference, and relationship manager assigned.",
    "Wedding photographer prospect list for a Mumbai event company: 200 couples with wedding dates in 2024, budget range 3 to 15 lakh, source of inquiry, and follow-up status.",
    "Gym membership roster for a premium fitness chain in Hyderabad: 1800 active members, membership type, renewal date, personal trainer assignment, and visit frequency.",
    "Solar rooftop customer pipeline for Tata Power Solar: 680 commercial and industrial leads in Pune, roof area, monthly bill, decision stage, and projected installation date.",
    "Hotel loyalty member list for ITC Hotels: 50000 Club ITC members with stay nights, preferred property, total spend, and tier status ranging from silver to platinum.",
    "Key farmer data for an agritech startup in Nashik: 3200 mango farmers with land holding, expected yield, mobile number, preferred buyer, and last advance payment.",
    "Auto insurance renewal list for Bajaj Allianz: 8000 policies expiring in May 2024, insured name, vehicle registration, existing premium, renewal quote, and agent contact.",
    "E-wallet KYC database for a fintech in Mumbai: 25000 users with PAN, Aadhaar masked, verification status, wallet balance, and last transaction date.",
    "Corporate training client list for a Bengaluru L&D company: 45 companies with training budget, number of employees to be trained, programs of interest, and L&D head contact.",
    "Salon loyalty database for Lakmé Salon franchise in Delhi: 6000 registered clients with last visit, services availed, average spend per visit, and birthday offers sent.",
    "NRI property buyer database for a Hyderabad real estate developer: 350 NRI prospects with overseas location, budget 80 lakh to 3 crore, project interest, and inquiry source.",
    "Export customer master for a Coimbatore garments exporter: 28 international buyers with country, annual order value in USD, payment terms, and buyer category.",
    "Platform user base analysis for a Pune SaaS startup: 1200 active organizations, admin contact, subscription tier, modules used, and next renewal date.",
    "Credit card applicant pipeline for HDFC Bank: 5000 pre-approved leads with income estimate, bureau score range, product type, and sourcing branch.",
    "Patient referral network for a private hospital in Kolkata: 350 general practitioners who referred patients, specialty of referral, average cases per month.",
    "Ticket buyer database for BookMyShow in Chennai: 25000 active users, genre preference, average spend per booking, and last event attended.",
    "Workshop customer data for a premium car service centre in Pune: 1400 customers with vehicle make, service history, last visit, and upcoming maintenance schedule.",
    "MSP client roster for an IT services company in Noida: 22 small businesses with managed devices, monthly contract value, on-site visit frequency, and escalation contact.",
    "Tuition centre student database in Bengaluru: 800 Class 10 and 12 students with subject package, fee paid, parent contact, and performance score in mock tests.",
    "Raw material supplier list for a Surat textile manufacturer: 80 yarn suppliers with credit terms, annual purchase value, quality rating, and payment track record.",
    "Franchise prospect database for a Kolkata food brand: 150 individuals who enquired about franchise, city of interest, investment capacity, and follow-up stage.",
    "Corporate gifting customer list for a Delhi handicraft brand: 60 HR managers who ordered during Diwali, order value, preferred product category, and next campaign date.",
    "Loan applicant pipeline for a Jaipur NBFC: 420 applicants with loan amount requested, income, property type, bureau score, and application stage.",
    "Competitor analysis customer wins: list of 25 clients who switched from Freshdesk to our helpdesk platform, previous contract value, reason for switch, and go-live date.",
    "Vendor contact directory for a Mumbai manufacturing company: 300 vendors with category, contact name, annual spend, last audit rating, and renewal date.",
    "Sports academy enrolment data for a Pune cricket coaching institute: 180 players with age group, batch timing, fee paid, and selection history for inter-city tournaments.",
]

GENERAL_EXAMPLES = [
    "Can you write a professional email to my team explaining that tomorrow's sprint demo has been moved to 3pm?",
    "Summarise the key differences between B2B and B2C sales cycles in simple language.",
    "What are the best practices for running effective one-on-one meetings with direct reports?",
    "Help me write a LinkedIn post about how I passed the AWS Solutions Architect certification.",
    "Can you suggest 5 team building activities that work well for a remote team of 20 people?",
    "What is the difference between machine learning and artificial intelligence?",
    "Draft a polite follow-up email to a vendor who has not responded in 10 days.",
    "Explain what EBITDA means and why investors care about it.",
    "Can you help me prepare for my performance review by giving me tips on how to present my achievements?",
    "What are the most common mistakes people make when creating PowerPoint presentations?",
    "Help me write a short bio for my LinkedIn profile highlighting my experience in supply chain management.",
    "What are the advantages and disadvantages of working in a startup versus a large corporation?",
    "How do I calculate compound interest? Please give me a simple formula and an example.",
    "Can you explain agile methodology in simple terms suitable for a non-technical audience?",
    "What are some effective ways to manage work-life balance when working from home?",
    "Help me draft an agenda for a 60-minute business strategy meeting with five participants.",
    "Can you explain what ESG investing means and why it has become popular recently?",
    "What are the typical stages in a product development lifecycle?",
    "I need to write a brief speech for my colleague's farewell who is leaving after 5 years. Any suggestions?",
    "How should I structure a business case document to convince my manager to approve a new tool?",
    "What are some free tools I can use to create flowcharts and process diagrams?",
    "Can you help me translate this English phrase into formal Hindi for an office notice?",
    "Explain what a pivot table is in Excel and when it is useful.",
    "What is the difference between a manager and a leader? Provide examples.",
    "How do I give constructive feedback to a team member who is not meeting deadlines?",
    "I want to start learning about personal finance. What are 5 books you would recommend?",
    "What is the difference between mutual funds and fixed deposits in India?",
    "Can you write a motivational message for our team at the beginning of the new financial year?",
    "Help me draft a brief out-of-office message for a 2-week vacation with an emergency contact.",
    "What are the benefits of having a mentor in your professional career?",
    "Explain the concept of opportunity cost in economics with a simple real-life example.",
    "What questions should I ask in the second round of interviews for a product manager role?",
    "Can you suggest a format for writing weekly status update emails to senior management?",
    "What is the 80/20 principle and how can I apply it to prioritise my work tasks?",
    "Help me write a congratulatory message for a colleague who just got promoted.",
    "What is cloud computing and what are the main types of cloud services?",
    "How do I improve my public speaking skills? Give me 5 practical tips.",
    "Can you help me write a summary of my project for our internal monthly newsletter?",
    "What is the difference between revenue and profit? When should a startup prioritise each?",
    "Help me create a checklist for organising a company offsite event for 50 employees.",
    "What are some networking tips for introverts attending a professional conference?",
    "Can you explain what a balanced scorecard is and how companies use it?",
    "I need to write a short poem in English for my company's 10-year anniversary celebration.",
    "What are the key differences between NEFT, RTGS, and IMPS money transfer methods in India?",
    "Can you give me a 5-minute morning routine that will help me be more productive at work?",
    "How do I handle a situation where two of my team members are in conflict with each other?",
    "What is the best way to negotiate a salary raise with my manager?",
    "Explain the concept of economies of scale with a simple example from Indian manufacturing.",
    "Help me create a simple risk matrix for a small office renovation project.",
    "What are some tips for writing professional emails that get responses quickly?",
]

# ---------------------------------------------------------------------------
# Assemble dataset
# ---------------------------------------------------------------------------

DATASET: list[tuple[str, str]] = []
for text in CONTRACT_EXAMPLES:
    DATASET.append((text.strip(), "contract"))
for text in FINANCIAL_REPORT_EXAMPLES:
    DATASET.append((text.strip(), "financial_report"))
for text in HR_DOC_EXAMPLES:
    DATASET.append((text.strip(), "hr_doc"))
for text in SOURCE_CODE_EXAMPLES:
    DATASET.append((text.strip(), "source_code"))
for text in STRATEGY_DOC_EXAMPLES:
    DATASET.append((text.strip(), "strategy_doc"))
for text in CUSTOMER_DATA_EXAMPLES:
    DATASET.append((text.strip(), "customer_data"))
for text in GENERAL_EXAMPLES:
    DATASET.append((text.strip(), "general"))


# ---------------------------------------------------------------------------
# Benchmark suite — 35 examples NOT in training data
# ---------------------------------------------------------------------------

BENCHMARK_EXAMPLES = [
    # contract (5)
    ("This non-disclosure agreement between Naukri.com parent Info Edge India and a data analytics startup in Pune prohibits disclosure of proprietary candidate matching algorithms.", "contract"),
    ("Service agreement between Mahindra Logistics and a warehouse operator in Chennai specifies storage capacity of 80000 sq ft, rate of 18 rupees per sq ft per month.", "contract"),
    ("Software escrow agreement requires Mphasis to deposit source code with a neutral third party to protect Kotak Mahindra Bank in case of vendor insolvency.", "contract"),
    ("Amendment to consulting agreement between Kearney India and a telecom operator in Mumbai extending the engagement by 6 months at an additional fee of 1.2 crore.", "contract"),
    ("Terms and conditions for API usage by fintech partners accessing HDFC Bank's account aggregator framework, including rate limits and liability caps.", "contract"),
    # financial_report (5)
    ("Infosys Q2 FY2025 investor presentation: revenue growth of 3.1 percent in constant currency, deal wins of 2.4 billion USD, headcount reduction of 2100.", "financial_report"),
    ("Consolidated balance sheet as of September 2024 for a mid-size NBFC in Gujarat shows total borrowings of 4200 crore, net worth 780 crore, leverage ratio 5.4x.", "financial_report"),
    ("Quarterly management accounts for a Pune auto ancillary company: net revenue 340 crore, EBITDA 42 crore margin 12.4 percent, inventory days 38.", "financial_report"),
    ("Cash flow statement for FY2024 for an edtech startup: operations burned 45 crore, capex 8 crore, funding raised 120 crore in Series B.", "financial_report"),
    ("Annual report highlights for Bajaj Auto FY2024: two-wheeler exports 22 lakh units, EV sales 3.6 lakh Chetak units, international revenue 38 percent of total.", "financial_report"),
    # hr_doc (5)
    ("Revised offer letter for Shreya Nair re-joining Accenture India as Senior Manager after a career break, CTC 48 lakh, joining date July 15 2024.", "hr_doc"),
    ("Salary slip for Arjun Kapoor for March 2024: gross earnings 95000, provident fund employer 11400, professional tax 200, net pay 72400.", "hr_doc"),
    ("Warning letter issued to Ravi Kumar at Tata Steel Jamshedpur plant for violation of safety protocol on three occasions within 30 days.", "hr_doc"),
    ("Transfer and relocation letter for Meena Pillai moving from Mumbai to Bengaluru office, relocation allowance 2 lakh, reporting date August 1 2024.", "hr_doc"),
    ("Full and final settlement for Kiran Desai who resigned from Wipro: earned leave encashment 55000, gratuity 1.2 lakh, notice period served, net payable 1.6 lakh.", "hr_doc"),
    # source_code (5)
    ("def parse_pan(pan: str) -> dict:\n    return {'state_code': pan[:2], 'holder_type': pan[3], 'sequence': pan[4:8]}", "source_code"),
    ("SELECT emp_id, name, department, salary FROM employees WHERE department = 'Engineering' AND salary > 1500000 ORDER BY salary DESC LIMIT 20;", "source_code"),
    ("const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY, key_secret: process.env.RAZORPAY_SECRET });", "source_code"),
    ("kubectl apply -f deployment.yaml --namespace=production && kubectl rollout status deployment/api-server -n production", "source_code"),
    ("@pytest.fixture\ndef db_session():\n    engine = create_engine('postgresql://test:test@localhost/testdb')\n    Base.metadata.create_all(engine)\n    yield Session(engine)\n    Base.metadata.drop_all(engine)", "source_code"),
    # strategy_doc (5)
    ("Market opportunity assessment for launching a BNPL product targeting college students in Tier 1 cities: TAM 4 crore students, average ticket 3000 rupees.", "strategy_doc"),
    ("Competitive positioning for a B2B SaaS startup versus Zoho and Freshworks: focus on sector-specific workflows for manufacturing, price 30 percent below incumbents.", "strategy_doc"),
    ("Geographic expansion roadmap for a Bengaluru cloud kitchen brand: enter Hyderabad and Chennai in Q1, Delhi and Kolkata in Q3, target 400 crore revenue by FY2026.", "strategy_doc"),
    ("Retention strategy for a B2C fintech: launch cashback program for top 20 percent users, personalize offers using transaction history, target churn reduction from 15 to 9 percent.", "strategy_doc"),
    ("Board resolution on international expansion: authorize management to explore joint ventures in UAE and Singapore, budget 50 crore for market entry studies in FY2025.", "strategy_doc"),
    # customer_data (5)
    ("Export of top 500 accounts from HubSpot CRM: company name, primary contact, ARR, industry, last activity date, and renewal month for FY2025.", "customer_data"),
    ("Patient list for chronic disease management program at Max Healthcare Delhi: 2800 diabetic patients with HbA1c levels, assigned physician, next appointment.", "customer_data"),
    ("Mobile wallet user segment with high churn risk: 12000 users who have not transacted in 60 days, last KYC date, linked bank account, and recommended re-engagement offer.", "customer_data"),
    ("Dealer performance scorecard for a Pune two-wheeler manufacturer: 320 dealers ranked by sales volume, customer satisfaction score, and service quality rating.", "customer_data"),
    ("Premium subscriber list for an OTT platform in India: 80000 annual plan holders with content preferences, device type, location, and subscription renewal date.", "customer_data"),
    # general (5)
    ("Can you give me ideas for a team lunch venue in Bengaluru that is suitable for a group of 15 people with mixed dietary preferences?", "general"),
    ("What are the key differences between waterfall and agile project management methodologies?", "general"),
    ("Help me write a short thank you note to my mentor who guided me through my MBA program.", "general"),
    ("What is the best way to prepare for a PMP certification exam? How many hours should I study?", "general"),
    ("Can you explain what a SWOT analysis is and help me understand how to use it for career planning?", "general"),
]


# ---------------------------------------------------------------------------
# Training and evaluation
# ---------------------------------------------------------------------------

def print_separator(char: str = "-", width: int = 70) -> None:
    print(char * width)


def train_and_evaluate() -> None:
    print_separator("=")
    print("  Preflight Layer 2 — Classifier Training Pipeline")
    print_separator("=")

    # --- Build DataFrame ---
    df = pd.DataFrame(DATASET, columns=["text", "label"])
    print(f"\nDataset size: {len(df)} examples")
    print("\nExamples per category:")
    for label, count in df["label"].value_counts().items():
        print(f"  {label:<20} {count}")

    # --- Save CSV ---
    df.to_csv(CSV_PATH, index=False)
    print(f"\nTraining data saved to: {CSV_PATH}")

    # --- Train/test split ---
    X = df["text"].tolist()
    y = df["label"].tolist()
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )
    print(f"\nSplit: {len(X_train)} train / {len(X_test)} test (80/20, stratified)")

    # --- Build pipeline ---
    print("\nTraining TF-IDF + Logistic Regression pipeline...")
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=10_000,
        sublinear_tf=True,
        min_df=1,
    )
    model = LogisticRegression(
        C=1.0,
        max_iter=1000,
        solver="lbfgs",
        class_weight="balanced",
        random_state=42,
    )

    X_train_vec = vectorizer.fit_transform(X_train)
    model.fit(X_train_vec, y_train)

    # --- Evaluate on held-out test set ---
    X_test_vec = vectorizer.transform(X_test)
    y_pred = model.predict(X_test_vec)
    test_accuracy = accuracy_score(y_test, y_pred)

    print_separator()
    print("\nHeld-out Test Set Evaluation")
    print_separator()
    print(classification_report(y_test, y_pred, digits=3))

    print("\nConfusion Matrix:")
    labels = sorted(set(y))
    cm = confusion_matrix(y_test, y_pred, labels=labels)
    header = f"{'':20}" + "".join(f"{l[:8]:>10}" for l in labels)
    print(header)
    for i, row in enumerate(cm):
        print(f"{labels[i]:<20}" + "".join(f"{v:>10}" for v in row))

    print(f"\nOverall accuracy on test set: {test_accuracy:.3f} ({test_accuracy*100:.1f}%)")

    # --- Benchmark suite evaluation ---
    print_separator()
    print("\nBenchmark Suite Evaluation (out-of-training examples)")
    print_separator()
    bench_texts = [ex[0] for ex in BENCHMARK_EXAMPLES]
    bench_labels = [ex[1] for ex in BENCHMARK_EXAMPLES]
    bench_vec = vectorizer.transform(bench_texts)
    bench_pred = model.predict(bench_vec)
    bench_proba = model.predict_proba(bench_vec)
    bench_classes = model.classes_.tolist()

    correct = 0
    print(f"\n{'Expected':<20} {'Predicted':<20} {'Confidence':>12}  Match")
    print_separator("-", 60)
    for expected, predicted, proba in zip(bench_labels, bench_pred, bench_proba):
        confidence = max(proba)
        match = "✓" if expected == predicted else "✗"
        if expected == predicted:
            correct += 1
        print(f"{expected:<20} {predicted:<20} {confidence:>12.3f}  {match}")

    bench_accuracy = correct / len(BENCHMARK_EXAMPLES)
    print(f"\nBenchmark accuracy: {bench_accuracy:.3f} ({bench_accuracy*100:.1f}%)")

    # --- Acceptance threshold checks ---
    print_separator()
    print("\nAcceptance Criteria Check")
    print_separator()
    pass_count = 0

    if test_accuracy >= TRAIN_ACCURACY_THRESHOLD:
        print(f"  ✓ Test set accuracy {test_accuracy:.3f} >= {TRAIN_ACCURACY_THRESHOLD}")
        pass_count += 1
    else:
        print(f"  ✗ FAIL: Test set accuracy {test_accuracy:.3f} < {TRAIN_ACCURACY_THRESHOLD}")

    if bench_accuracy >= BENCHMARK_ACCURACY_THRESHOLD:
        print(f"  ✓ Benchmark accuracy {bench_accuracy:.3f} >= {BENCHMARK_ACCURACY_THRESHOLD}")
        pass_count += 1
    else:
        print(f"  ✗ FAIL: Benchmark accuracy {bench_accuracy:.3f} < {BENCHMARK_ACCURACY_THRESHOLD}")

    if pass_count < 2:
        # Identify weakest classes for diagnostics
        report = classification_report(y_test, y_pred, output_dict=True)
        weak = sorted(
            [(label, report[label]["f1-score"]) for label in labels if label in report],
            key=lambda x: x[1]
        )
        print("\nWeakest classes by F1-score:")
        for label, f1 in weak[:3]:
            print(f"  {label:<20} F1={f1:.3f}")
        print_separator("=")
        print("BUILD FAILED — accuracy thresholds not met. See weakest classes above.")
        print_separator("=")
        sys.exit(1)

    # --- Save model bundle ---
    bundle = {"vectorizer": vectorizer, "model": model}
    joblib.dump(bundle, MODEL_PATH)
    print(f"\n  ✓ Model saved to: {MODEL_PATH}")
    print_separator("=")
    print("  BUILD PASSED — all acceptance criteria met.")
    print_separator("=")


if __name__ == "__main__":
    train_and_evaluate()
