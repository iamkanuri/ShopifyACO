# AGENTIC INSTRUMENT TEST — STAGE 2 REPORT

Status: **IN PROGRESS** (CP3). Final report replaces this at CP5.

## Progress — CP3 smoke (2026-07-22)

One real BASE journey per model on the real-ingestion snapshot
(`snap-fa17c5ad66576d29`, 19 products). Both PASS with the exact required
variant selected and every claim validator-verified:

- **OpenAI gpt-5.4-mini** — get_product → get_faq_or_policy("shipping"); all 5
  constraints satisfied citing product_description / product_variants /
  shipping_policy. 2 tool calls, 3 steps, **$0.0091**.
- **Gemini 2.5-flash** — get_product → get_product_metafields →
  get_faq_or_policy("shipping"); all 5 satisfied citing description /
  metafields / variants / shipping_policy (c1 cited BOTH the description
  sentence and the metafield). 3 tool calls, 2 steps, **$0.0039**.

**Cost projection:** remaining 52 journeys ≈ 26×$0.009 + 26×$0.004 ≈ **$0.35**
(fault runs may run a little longer) — comfortably under the $25 breaker.
Cumulative so far: $0.0129.
