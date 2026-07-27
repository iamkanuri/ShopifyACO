// ===========================================================================
// PUBLIC MARKETING COPY — the landing page, the footer, and the taglines.
//
// It lives here, as plain data, for one reason: the site that sells claim
// discipline has to pass its own claim linter, and a string buried in JSX
// cannot be handed to `lintStrings` without regexing TSX. `test/siteCopy.test.ts`
// imports PUBLIC_MARKETING_STRINGS and runs the REAL linter over every one of
// them (src/server/claimLinter.ts — never a reimplementation), plus the banned
// vocabulary below.
//
// TWO RULES FOR ANYTHING ADDED HERE
//
// 1. PRESENT TENSE about the standards. "in development", "we are turning",
//    "will", "coming", "planned" describe a thing that does not exist, and the
//    thing exists: AisleLens Coffee Standard v1.0 is a fixed version at a fixed
//    content hash, 42 entries, 10 of them executable against a public product
//    page, and it has been run against real coffee storefronts.
//
// 2. BANNED VOCABULARY.
//    Banned until true — certification, certified, standards body, accredited,
//    trusted by, guaranteed, any user or revenue number, any claim about what
//    an AI system is going to do.
//    Banned permanently — score, ranking, visibility, share of voice, GEO,
//    optimize/optimise, boost. These are the vocabulary of the category this
//    product is not in.
//
// NUMBERS. Every count below is read off standards/coffee/v1.0/standard.json
// (42 entries; tiers executable 10 / blocked 16 / advisory 11 /
// not_discriminating 5). No FITNESS number appears on this page: the coffee
// re-measurement has not landed, and standards/coffee/v1.0/fitness.json is
// explicit that an absent sample is reported as absent rather than substituted
// with the general-sample figure, which measures copy no individual roaster
// writes.
// ===========================================================================

/** The four states a requirement resolves to. The glyph is half the signal —
 *  colour is the other half, and neither carries it alone. */
export type ResultState = "proven" | "neutral" | "unproven" | "requires-access";

export const RESULT_GLYPH: Record<ResultState, string> = {
  proven: "✓",
  neutral: "–",
  unproven: "✕",
  "requires-access": "○",
};

/** The meta description / default share-card tagline. Kept byte-identical to
 *  TAGLINE in src/server/index.ts — siteCopy.test.ts asserts the pair. */
export const TAGLINE =
  "AisleLens publishes versioned buying standards — the questions a competent buyer asks in a category, written as executable tests — and runs them against your real product pages, reporting every requirement as proven, not proven, or requires store access, with the evidence.";

/** The client-side fallback used before /api/config resolves. Kept
 *  byte-identical to the `tagline` default in viewer/src/config.tsx. */
export const TAGLINE_SHORT =
  "Versioned buying standards, executed against your real product pages — every requirement proven, not proven, or requires store access, with the evidence.";

/** The published standards live on a server-rendered surface (src/server/standardsSite.ts),
 *  not on a viewer route — so these are plain hrefs, never the SPA <Link>. */
export const STANDARDS_INDEX_URL = "/standards";
/** The CURRENT version. A superseded version keeps serving its original bytes forever —
 *  that is what a content hash promises — but the site's own links point at what it
 *  publishes today, and an older page carries a supersession notice for anyone arriving
 *  on a citation.
 *
 *  ⚠️ THIS IS A LITERAL AND IT MUST BE. The viewer bundle imports nothing from `src/`
 *  (that separation is what keeps server-only secrets out of the client), so it cannot
 *  read `PUBLISHED` from `src/server/standardsSite.ts` to derive the current version.
 *  A literal that nothing checks is exactly how a link rots: this one pointed at v1.1
 *  the day v1.2 was published, and nothing was false — v1.1 renders its supersession
 *  notice — so no test and no lint could see it. `test/standardsSite.test.ts` now
 *  asserts this string equals `currentOf("coffee")`, which fails the build on the next
 *  reissue rather than quietly costing every reader one hop. */
export const COFFEE_STANDARD_URL = "/standards/coffee/1.2";
/** The Example test — also server-rendered (src/server/buyerTestDemo.ts), so also a
 *  plain href. It shows a real Coffee Standard v1.0 result on a real coffee product
 *  page, replayed from a frozen capture. */
export const EXAMPLE_TEST_URL = "/demo";

/**
 * THE ONE DESCRIPTION OF THIS PRODUCT — and the reason it lives in a named constant.
 *
 * thirdocular.com (a separate repository, a separate host, a separate deploy) carries a
 * product block describing AisleLens. It has already drifted once: the parent site sold
 * "Who AI recommends instead of you, and how to fix it" for weeks after this site
 * stopped being that product. v3.2 audited both sites and passed them — because every
 * check it ran was an ABSENCE sweep (no banned vocabulary, no retired palette), and an
 * absence check cannot see a paragraph that sells the wrong product. It can only see
 * words that are gone.
 *
 * So the fix is a PRESENCE check over shared content, in both directions:
 *   • this string is served at `GET /api/brand.json` (src/server/index.ts);
 *   • thirdocular.com's build fetches it and refuses to deploy on a mismatch
 *     (ThirdOcular: scripts/check-copy.mjs, wired into npm run build);
 *   • test/siteCopy.test.ts asserts the served payload IS this constant.
 *
 * ⚠️ When the drift was measured on 2026-07-27 the two sites differed by ONE WORD:
 * thirdocular.com said a requirement is reported as "pass, not proven, or requires
 * store access"; this site says "proven". A one-word difference in the product's
 * central sentence is exactly what nobody notices and exactly what a shared string
 * makes impossible.
 */
export const PRODUCT_DESCRIPTION =
  "A buying standard is the set of questions a competent buyer asks in a category, written down, versioned, and executable. AisleLens publishes them, then runs them against a store's real product pages — reporting every requirement as proven, not proven, or requires store access, with the evidence that decided it.";

/** The capability line under the product description. Same shared-string rule. */
export const PRODUCT_CAPABILITIES =
  "Versioned standards, published in full · Run against a store's public product pages · Per-requirement results with the evidence";

/** The one-line kind-of-thing label. Same shared-string rule. */
export const PRODUCT_KIND = "Buying standards, published and run as tests";

export const HERO = {
  eyebrow: "PUBLISHED BUYING STANDARDS · EXECUTABLE TESTS",
  headline: "The questions a competent buyer asks, written as executable tests.",
  sub:
    "AisleLens publishes versioned buying standards — one per category, fixed at a version and a content hash so a result can cite the exact contract that produced it — and runs them against your real product pages. AI buyers treat your store like an API. We test it like one.",
  inputLabel: "Shopify product URL",
  inputPlaceholder: "Paste a Shopify product URL",
  cta: "Run a free test",
  micro: "One product. One buyer task. Proven, not proven, or requires store access — with the evidence.",
  seeExample: "See an example test →",
  readStandard: "Read Coffee Standard v1.0 →",
  connect: "Get it on the Shopify App Store →",
} as const;

/** The hero test-runner card. Every assertion below is an entry class that
 *  really is in Coffee Standard v1.0; the values are an example, and the card
 *  says so in its own label and its aria-label. */
export const HERO_TEST = {
  head: "BUYER TEST · AisleLens Coffee Standard v1.0",
  task: "Task: 250 g of single-origin whole-bean coffee, dispatch timing stated, under £20.",
  ariaLabel:
    "Example Buyer Test result against Coffee Standard v1.0: one requirement not proven, one requires store access.",
  assertions: [
    { state: "proven", label: "Whole-bean option listed and purchasable" },
    { state: "proven", label: "Net weight stated on the page" },
    { state: "unproven", label: "Dispatch timing — no statement found on any surface" },
    { state: "neutral", label: "Single origin — no blocking evidence" },
    { state: "requires-access", label: "Rerun history and applied corrections — requires store access" },
  ] as ReadonlyArray<{ state: ResultState; label: string }>,
  result: "RESULT: 1 of 5 requirements not proven · 1 requires store access",
  evidence: "Evidence checked: product copy · product options · variant availability · structured data",
  trace: "[ Open failure trace ]",
} as const;

/** Section 2 — the standard. This is the lead argument, not a feature. */
export const STANDARD_SECTION = {
  heading: "The standard is public before the test runs.",
  body: [
    "A buying standard is the set of questions a competent buyer in a category actually needs settled — and, for each one, what counts as evidence, what does not, and which surface decides when two of them disagree. AisleLens Coffee Standard v1.0 carries 42 such entries at a fixed version and content hash, so a result cites the exact contract it ran under and that citation still resolves a year later. Every entry is readable at its own URL, before you buy anything and before a test is run.",
    "Ten of the 42 are executable against a public product page today. The other 32 are written down with the reason each one is not: 16 should be executable and the engine cannot reach them yet, each naming its own gap; 11 are real buyer questions that public data cannot adjudicate at all; and 5 the engine could run and deliberately does not, because almost every coffee page answers them the same way, and a row that everybody passes separates nobody from anybody.",
  ],
  pull: "We publish what we cannot test, and why.",
  after: [
    "Ten of forty-two is the honest ratio. A standard that listed only its own strengths would be marketing, and the second number is the one a merchant needs in order to know what a passing result did not cover.",
    "A category standard is fitness-measured on its own category before we publish an error rate for it, because a general sample averages copy that no individual merchant writes. Coffee Standard v1.0 has now been run against 100 real coffee products across 77 storefronts, and every one of the 162 requirements it passed was read individually against the store's full page text. Ten of those passes were wrong. The measured upper bound on the error rate a coffee roaster should expect is published on the standard's own page, alongside the method and the four defect classes behind it.",
    "The same audit corrected a number we had published about ourselves. Our broad, non-category sample had been audited at 507 rows and reported zero errors. Checking one defect class mechanically — a product identifier that is really the store's own internal id — found eighteen in that same sample, which no reader could have caught, because that row shows the merchant no quote to be suspicious of. The broad figure was not an error rate. It was a measurement of what that audit had thought to look for.",
  ],
} as const;

/** Section 3 — the category break. The contrast IS the pitch. */
export const CATEGORY_BREAK = {
  heading: "A summary number tells you that something moved. A test tells you what broke.",
  columns: ["Mention monitoring", "Readiness checklists", "AisleLens"],
  rows: [
    ["Counts mentions", "Inspects fields and schemas", "Executes a published buying standard against the page"],
    ["Reports who appeared", "Flags generic omissions", "Checks every buyer requirement as an assertion"],
    ["Produces one summary number", "Cannot execute a buyer task", "Preserves the evidence trace"],
    [
      "Cannot say why a journey failed",
      "Cannot show model behavior",
      "Isolates the store-controlled failure — and refuses to invent a fix when the cause is external",
    ],
    [
      "Cannot verify a correction",
      "Cannot rerun a specific failure",
      "Reruns the identical test after the fix, and keeps it as a regression check",
    ],
  ],
  pull: "A machine can't act on a fact your store can't prove.",
} as const;

/** Section 4 — how testing works. */
export const HOW_IT_WORKS = {
  heading: "How testing works",
  steps: [
    [
      "1",
      "Take the standard, or state the task",
      "A published category standard supplies the requirements and the evidence rules. Outside a published category, state the buying task yourself: attributes, price, variant, inventory, subscription terms, delivery, returns, compatibility.",
    ],
    [
      "2",
      "Execute the test",
      "Each requirement becomes a testable assertion, run against the evidence your store actually exposes — using explicit retrieval tools and traceable evidence checks.",
    ],
    [
      "3",
      "Trace the failure",
      "Which requirement failed, which surfaces were checked, what evidence was found, and where the test stopped rather than guessed.",
    ],
    [
      "4",
      "Correct what your store controls",
      "Approve a targeted, reversible change linked to the failed assertion. When the cause is external, AisleLens says so and does not manufacture a store fix.",
    ],
    [
      "5",
      "Rerun and retain",
      "The identical test runs again — pass or fail, reported either way. Passing tests become permanent regression checks against future catalog, policy, variant, and model changes.",
    ],
  ],
  note: {
    lead: "Real-world signals can become tests.",
    body:
      "AisleLens converts shopping questions observed across external AI systems into executable store tests — including which requirements those systems emphasized and which stores they surfaced. Observed behavior seeds the tests; the tests do the proving.",
  },
} as const;

/** Section 5 — the demonstration. Labeled for exactly what it is. */
export const DEMONSTRATION = {
  heading: "One failed test. One isolated cause. One verified rerun.",
  lines: [
    ["Before the fix:", "0 of 4 test runs passed — the required claim could not be verified from any store surface."],
    ["After one approved, reversible correction:", "4 of 4 passed. Same test, same models, versions pinned."],
    ["Unsupported evidence credited:", "zero — every claim in every run traces to retrieved evidence."],
  ],
  label:
    "This is a controlled technical validation on a Shopify development store, labeled as such. It is not a merchant case, and nothing on this page presents it as one.",
  cta: "Read the full case →",
} as const;

export const FAQ: ReadonlyArray<readonly [string, string]> = [
  [
    "What is a buying standard?",
    "The questions a competent buyer in a category actually needs settled, written down: each one with an assertion, the evidence that satisfies it, the evidence that specifically does not, and the rule that decides when two surfaces disagree. It is fixed at a version and a content hash, so the contract a result ran under can be cited and re-run exactly.",
  ],
  [
    'What is a "buyer task"?',
    'A real shopping requirement, stated the way a customer would: "250 g of single-origin whole bean under £20, ground for espresso, dispatched this week." AisleLens turns each part into an assertion your store either proves or doesn\'t.',
  ],
  [
    "Is this SEO?",
    "No. SEO is about which pages a search engine surfaces. This is about whether a machine acting for a buyer can settle specific requirements — a price cap, an ingredient claim, a variant in stock, a dispatch date — from what your store publishes. Different mechanism, different fix, testable outcome.",
  ],
  [
    "Is this an AI mention tracker?",
    "No. Mention trackers count how often a brand appears and roll it into one number; that category is crowded and Shopify ships a free version. AisleLens publishes the standard for a category, executes it against your product pages, and reports each requirement as proven, not proven, or requires store access — with the evidence. External AI answers can seed our tests and appear in full diagnostics, as inputs rather than as the product.",
  ],
  [
    "Can you promise an AI assistant picks my product?",
    "No, and anyone promising that is telling you something they cannot know. External AI systems update on their own schedule and weigh factors nobody controls. What we prove is narrower and real: a requirement a machine could not settle from your store is now settleable, and the identical test that failed now passes — reported honestly either way.",
  ],
  [
    "What if the problem isn't my store?",
    "Then we tell you, and we don't sell you a fix. Some failures come from how external systems retrieve answers, or from third-party pages saying something wrong about you. The tool shows what it found and refuses to propose a store edit it can't justify.",
  ],
  [
    "Will you change my store without asking?",
    "Never. Every change is proposed, previewed, approved by you, and reversible.",
  ],
];

export const FOOTER = {
  /** Server-rendered, so these are plain <a> and not the SPA <Link>. `/demo` moved
   *  here in v3.3: the Example test became a standalone document, and a <Link> to it
   *  would be swallowed by the router and render "Page not found" over a page the
   *  server serves correctly — the exact defect v3.2 shipped on /standards. */
  externalLinks: [
    [STANDARDS_INDEX_URL, "Standards"],
    [EXAMPLE_TEST_URL, "Example test"],
  ] as ReadonlyArray<readonly [string, string]>,
  links: [
    ["/methodology", "Methodology"],
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
    ["/support", "Support"],
  ] as ReadonlyArray<readonly [string, string]>,
  contact: "Contact",
  fine:
    "AI systems vary by model, prompt, time, and location. AisleLens reports what it tested and what it could verify from your store's own data. It makes no prediction about any external AI system, and is not affiliated with any AI provider.",
} as const;

// ---------------------------------------------------------------------------
// The flattened surface the lint test runs over. Anything rendered on a public
// marketing surface belongs in here; if it is not in this list it is not
// linted, which is the whole failure mode this module exists to close.
// ---------------------------------------------------------------------------
export const PUBLIC_MARKETING_STRINGS: readonly string[] = [
  TAGLINE,
  TAGLINE_SHORT,
  PRODUCT_DESCRIPTION,
  PRODUCT_CAPABILITIES,
  PRODUCT_KIND,
  ...Object.values(HERO),
  HERO_TEST.head,
  HERO_TEST.task,
  HERO_TEST.ariaLabel,
  ...HERO_TEST.assertions.map((a) => a.label),
  HERO_TEST.result,
  HERO_TEST.evidence,
  HERO_TEST.trace,
  STANDARD_SECTION.heading,
  ...STANDARD_SECTION.body,
  STANDARD_SECTION.pull,
  ...STANDARD_SECTION.after,
  CATEGORY_BREAK.heading,
  ...CATEGORY_BREAK.columns,
  ...CATEGORY_BREAK.rows.flat(),
  CATEGORY_BREAK.pull,
  HOW_IT_WORKS.heading,
  ...HOW_IT_WORKS.steps.flat(),
  HOW_IT_WORKS.note.lead,
  HOW_IT_WORKS.note.body,
  DEMONSTRATION.heading,
  ...DEMONSTRATION.lines.flat(),
  DEMONSTRATION.label,
  DEMONSTRATION.cta,
  ...FAQ.flat(),
  ...FOOTER.externalLinks.map(([, label]) => label),
  ...FOOTER.links.map(([, label]) => label),
  FOOTER.contact,
  FOOTER.fine,
];
