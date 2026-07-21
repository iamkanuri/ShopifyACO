# AGENTIC INSTRUMENT TEST — STAGE 1 REPORT

Status: **IN PROGRESS** (CP2). Final report replaces this section at CP5.

## Progress — CP2: first real traces (2026-07-21)

Two real journeys (OpenAI `gpt-5.4-mini`, tool-calling, temperature 0) against the
pinned snapshots. Raw traces confirm the agent calls the store tools and searches
the surfaces rather than answering from priors.

### BASE journey (`run-mrulzyqz-aaed7a3a`) → adjudicated **PASS**, model declared PASS

```
1  TOOL_CALLED  get_product              {"productId":"gid://shopify/Product/1001"}
2  TOOL_RESULT  get_product              refs=5
4  TOOL_CALLED  get_product_metafields   {"productId":"gid://shopify/Product/1001"}
5  TOOL_RESULT  get_product_metafields   refs=2
7  TOOL_CALLED  get_faq_or_policy        {"topic":"materials"}
8  TOOL_RESULT  get_faq_or_policy        refs=0   (explicit absent-surface result)
9  TOOL_CALLED  search_store             {"query":"gid://shopify/Product/1001 aluminum free cookware"}
10 TOOL_RESULT  search_store             refs=1
11 CONSTRAINT_CHECKED aluminum-free = satisfied,
   claimed evidence: ev-6d512d39d0fb3cf3 (description sentence), ev-81f40c4bee9b0095 (custom.aluminum_free=true)
12 DECISION_MADE adjudicated=PASS, declared=PASS, selected=gid://shopify/Product/1001
```

Both claimed evidence ids were verified by the deterministic validator: returned by
tools in THIS run, on the pinned snapshot, on acceptable surfaces, non-negated term
match / attribute-keyed metafield = true. Cost $0.0038, 4 tool calls, 2 model steps.

### FAULTY journey (`run-mrum0hyz-f39ffc9c`) → adjudicated **MISSING_EVIDENCE**, model declared MISSING_EVIDENCE

```
1  TOOL_CALLED  get_product              {"productId":"gid://shopify/Product/1001"}
4  TOOL_CALLED  get_product_metafields   {"productId":"gid://shopify/Product/1001"}
7  TOOL_CALLED  get_faq_or_policy        {"topic":"materials"}
9  TOOL_CALLED  search_store             {"query":"aluminum free cookware product 1001"}
11 CONSTRAINT_CHECKED aluminum-free = unresolvable
12 DECISION_MADE adjudicated=MISSING_EVIDENCE, declared=MISSING_EVIDENCE
```

Agent's own explanation (verbatim): *"The product metafield shows material =
ceramic, but there is no direct evidence stating that the product is aluminum-free.
The store snapshot also exposes no FAQ/policy or structured data surface to confirm
this attribute."* — it refused to infer aluminum-free from "ceramic". Cost $0.0054,
4 tool calls, 3 model steps.

Cumulative estimated spend so far: **$0.0092** (breaker: $25).

Snapshots: BASE `snap-0b747b1ec8e6a143`, FAULTY `snap-aa0945aa82e7d5b7`,
RESTORED `snap-b584dab5794ecf14` (BASE and RESTORED share a content hash — the
restore is the exact inverse of the mutation — but carry distinct opaque ids).
