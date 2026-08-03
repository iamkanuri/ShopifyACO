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
// ⚠️ NUMBERS. This module states STRUCTURAL counts only (42 entries, the tier split),
// read off the published standard. It states NO measured figure — no bound, no row count,
// no defect count — and it must not start. The viewer bundle imports nothing from `src/`
// and cannot reach the registry or the fitness sidecar, so any measurement typed here is a
// literal that goes false the next time the audit improves. Two such paragraphs shipped and
// were live until v4.1: "162 requirements … Ten of those passes were wrong" against an
// artifact reading 160 and 7, and "507 rows … found eighteen" against 483 and 11. Both are
// now argued without figures and point at the page that derives them.
//
// The VERSION label is derived from COFFEE_STANDARD_URL (see below). Four places here said
// v1.0 while the link resolved to v1.3.
//
// Historical note, kept because it explains the shape of this file: counts below were
// originally read off standards/coffee/v1.0/standard.json
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
export const COFFEE_STANDARD_URL = "/standards/coffee/1.3";

/**
 * The standard's version label, DERIVED from the URL above and never typed again.
 *
 * ⚠️ FOUR PLACES IN THIS FILE SAID "v1.0" WHILE THE LINK RESOLVED TO v1.3, and no lint
 * could see it: a stale version label contains no banned word and no false token — it is a
 * true sentence about an older document, rendered beside a link to a newer one. The same
 * shape rotted `COFFEE_STANDARD_URL` itself one release earlier. The viewer bundle imports
 * nothing from `src/`, so it cannot ask the registry; deriving from the one constant a
 * test already pins against `currentOf("coffee")` is the next best thing, and it means the
 * label cannot disagree with the href it sits next to.
 */
export const COFFEE_STANDARD_VERSION = `v${COFFEE_STANDARD_URL.split("/").pop()}`;
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
  eyebrow: "AI COMMERCE QA FOR ECOMMERCE AGENCIES",
  headline: "Test whether your clients' product pages can support an AI shopping task.",
  sub:
    "AisleLens runs defined buyer tests against real storefront evidence. See what the store can answer, where the evidence runs out, what your agency can correct, and whether the same test passes after the change.",
  inputLabel: "Shopify product URL",
  inputPlaceholder: "Paste a Shopify product URL",
  cta: "Run a real test",
  ctaSecondary: "See a complete example →",
  micro: "One product. One buying task. Every requirement proven, not proven, or requires store access — with the sentence that decided it.",
  seeExample: "See an example test →",
  readStandard: `Read Coffee Standard ${COFFEE_STANDARD_VERSION} →`,
  connect: "Get it on the Shopify App Store →",
} as const;

/**
 * THE CREDIBILITY STRIP — five things, and every one of them is backed by an artifact
 * a reader can open. That constraint is the whole point of the strip: it sits directly
 * under the headline, which is where a page is most tempted to say something it cannot
 * show.
 *
 * ⚠️ "No ranking promises" IS THE OBVIOUS FIFTH ITEM AND IT CANNOT BE WRITTEN THAT WAY.
 * `ranking` is on the permanently-banned list in test/siteCopy.test.ts — it is the
 * vocabulary of the category this product is not in, and the ban has no exception for
 * using the word to disown it. The claim survives; the word does not.
 */
export const CREDIBILITY = [
  "Published criteria, before the test runs",
  "An exact evidence trace for every result",
  "A published error bound, with its method",
  "Reruns that repeat exactly",
  "No promises about assistant behaviour",
] as const;

/** The BETA badge beside the wordmark. Honest and staying: no second party has applied
 *  a standard of ours, and `independently_applied` is `false` in the artifact itself. */
export const BETA_BADGE = "BETA";

/**
 * THE HERO ARTIFACT'S FRAMING. The numbers, rows, quotes, entry ids and hash are NOT
 * here — they are derived at request time from the pinned Klatch run and injected by
 * the server (see src/server/heroArtifact.ts). What lives here is only the prose that
 * frames them, so the claim linter can still see it.
 *
 * ⚠️ THE CONCEPT THIS PAGE WAS DRAWN FROM INVENTED FAILING VERDICTS FOR A REAL, NAMED
 * ROASTER. A fabricated result about a real business is the one class of false statement
 * this project treats as unrecoverable, and a hero is the worst place to put one because
 * it is the part of the page that travels. Everything in the hero artifact is the real
 * replayed result on klatchcoffee.com, whose every passing row was individually
 * adjudicated in the v3.2 audit.
 */
export const HERO_ARTIFACT = {
  kicker: "A REAL RESULT, ON A REAL STORE",
  note: "Replayed offline from a frozen capture of the live page, against the published standard named above. Every row links to the entry it executes.",
  legend: "✓ proven · ✕ not proven · – no blocking evidence · ○ requires store access",
  more: "Read the complete test →",
} as const;

/** §3.2 — what an agency hands its client. Deliverables, not features. */
export const DELIVERABLES = {
  heading: "What your agency hands the client.",
  lead: "Six artifacts, all of them checkable by someone who was not in the room.",
  items: [
    [
      "A client-ready evidence audit",
      "Every requirement in the standard, with the store's own sentence beside it and the surface that sentence was read from. Nothing to take on trust.",
    ],
    [
      "The exact buyer questions the store cannot answer",
      "Not a category of weakness — the specific questions, quoted from a published standard, that public evidence could not settle on this page.",
    ],
    [
      "A line between what the store controls and what it does not",
      "Some failures are a missing sentence on a product page. Some are outside the store entirely. The report says which, and refuses to propose an edit it cannot justify.",
    ],
    [
      "Corrections tied to the assertion that failed",
      "Each proposed change names the requirement it is meant to satisfy and the evidence form the standard accepts for it. Reviewed and approved by you, and reversible.",
    ],
    [
      "A before-and-after rerun",
      "The identical test, same standard, same content hash, run again after the change — reported either way, including when nothing moved.",
    ],
    [
      "A regression baseline you keep",
      "A requirement that passes becomes a check that keeps running, so a theme update or a catalog edit that undoes the work is visible rather than silent.",
    ],
  ] as ReadonlyArray<readonly [string, string]>,
} as const;

/** §3.3 — the workflow. Five steps, one concrete sentence each. */
export const WORKFLOW = {
  heading: "Test · Trace · Correct · Rerun · Retain",
  lead: "The same five steps on every client, in the same order, with an artifact at each one.",
  steps: [
    ["Test", "A published buying standard for the category is executed against the client's live product page."],
    ["Trace", "Every result names the surface it was read from and quotes the sentence that decided it, or states that no sentence existed."],
    ["Correct", "The failures the store controls get a proposed, reversible change, tied to the requirement it is meant to satisfy."],
    ["Rerun", "The identical test runs again against the same version and content hash, so the question cannot have moved between the two runs."],
    ["Retain", "The passing test stays as a regression check, and reports when a later change takes it back."],
  ] as ReadonlyArray<readonly [string, string]>,
} as const;

/** §3.4 — what the test actually reads, and where it stops. */
export const TEST_EXPLAINED = {
  heading: "What an executable buyer test actually does.",
  lead: "A buying task becomes a list of assertions. Each assertion is settled from evidence that is retrieved, quoted and attributed — or it is not settled, and the result says so.",
  surfaces: [
    ["Product description", "The readable copy a shopper sees, sentence by sentence."],
    ["Options and variants", "The purchasable option list, and whether the matching variant is actually available."],
    ["Structured data", "The JSON-LD product node — identifiers, offers, availability, category."],
    ["Policy pages", "Shipping and returns, fetched separately and attributed separately."],
    ["Page metadata", "Title, canonical, description — the machine-facing summary of the page."],
    ["Authorized store data", "Only with a connected store, and only where public data provably cannot settle the question."],
  ] as ReadonlyArray<readonly [string, string]>,
  stops: {
    lead: "And where it stops.",
    body:
      "The evaluator is deterministic: it matches evidence, it does not reason about the product. A requirement with no retrievable sentence behind it is reported as not proven, never inferred from context, never softened into a maybe. A requirement that public data cannot settle at all is reported as requires store access — a third state that exists so the first two stay honest.",
  },
} as const;

/** §3.5 — the real example. Prose only; every figure is derived from the artifact. */
export const REAL_EXAMPLE = {
  heading: "One real store, every row, nothing selected for effect.",
  lead: "This is the complete result the published standard produces on a real coffee product page — not an excerpt chosen to flatter either side. Each row cites the entry it executes, at a version and a content hash that still resolve.",
  peerNote: "Where the standard has published a measurement for an entry, the row says how the rest of the sample did on the same question — with the number of stores that question could actually be decided on, which is not always the whole sample.",
} as const;

/**
 * §3.6 — before and after. THE CONTRACT, NOT A CLIENT RESULT.
 *
 * ⚠️ WHAT THIS SECTION IS AND IS NOT. The only matched before/after pair this project
 * holds end to end is the v2.1 CP3 live walk on a Shopify DEVELOPMENT store, and it is
 * described as exactly that in DEMONSTRATION below. So this section renders the
 * CONTRACT: the same standard, the same content hash, the same entry id, before and
 * after — where the only thing that changes is the store's text. The "after" sentence
 * is not written here and is not invented: it is the accepted-evidence EXAMPLE the
 * standard itself publishes for that entry, and it is labeled illustrative on the page.
 * The point a visitor has to leave with is that the result moved because the evidence
 * moved, and not because the question did.
 */
export const BEFORE_AFTER = {
  heading: "The result moves when the evidence moves. Never when the question does.",
  lead: "Same standard. Same version. Same content hash. Same entry id. The only difference between the two columns is a sentence on the product page.",
  beforeLabel: "Before — the page as it is today",
  afterLabel: "After — the page with the evidence the standard accepts",
  illustrative:
    "The right-hand sentence is illustrative: it is the accepted-evidence example the standard itself publishes for this entry, not text from any store. The left-hand column is the real current result.",
  invariant: "Unchanged across the rerun:",
} as const;

/** §3.8 — how the engine is validated. All of it is on the record. */
export const ENGINE_VALIDATION = {
  heading: "The engine improves by finding where it was wrong.",
  body: [
    "A test engine that is never measured against itself is a rubric with a user interface. So this one is run against large samples of real storefronts, and then every row it passed is read individually against that store's full page text — not sampled, not spot-checked. The passes that turn out to be wrong are counted, named, and published as an error bound with the sample and the method beside it.",
    "Each confirmed wrong pass becomes a named defect class and a pinned case in an adversarial corpus, which fails in both directions: fix the defect and its case fails until the record is updated, reintroduce it and the case fails again. Defects we have chosen not to close are numbered, published with their measured cost, and left visible rather than quietly carried.",
    "The bound has moved several times, and every move so far has come from the audit getting better rather than the engine getting worse — including one occasion when a figure we had published about ourselves turned out to measure what that audit had thought to look for, rather than the error rate. That correction is on the record too, at the version where it was made.",
  ],
  pull: "AI buyers treat your store like an API. We test it like one.",
} as const;

/** §3.10 — the pilot. Honest mechanics only: a real mail link, no fabricated booking. */
export const PILOT = {
  heading: "Run it on one client.",
  body:
    "The fastest way to judge this is to point it at a page you already know well and see whether the result matches what you would have said yourself. That takes one URL and no account. If you want to scope a category standard or a client engagement, say so and a person answers.",
  primary: "Run a real test",
  secondary: "Ask about an agency pilot",
  mailSubject: "Agency pilot",
  mailBody:
    "Hi — I run an ecommerce agency and I'd like to scope a pilot.\n\nClients / category:\nNumber of product pages:\nWhat I'd want out of it:\n",
  fine: "No account is needed for a test. A pilot is a conversation, not a checkout.",
} as const;

/** The rasterised line on /og/default.png — the share image for the landing page and
 *  every utility page.
 *
 *  ⚠️ IT LIVES HERE SO A SWEEP CAN READ IT. v3.3 found this card rendering
 *  `ChatGPT · Gemini · Perplexity` under a heading reading PUBLISHED BUYING STANDARDS,
 *  advertising the product this one replaced — and every copy check in the repo passed,
 *  because they all read SOURCE STRINGS and no absence sweep over source can see a
 *  phrase rasterised into a PNG. The card now imports this constant, and this constant
 *  is in PUBLIC_MARKETING_STRINGS, so the linter and the banned-vocabulary check reach
 *  the share image for the first time. */
export const OG_DEFAULT_LINE = "Executable buyer tests, against the evidence your store publishes.";

/** Section 2 — the standard. This is the lead argument, not a feature. */
export const STANDARD_SECTION = {
  heading: "The standard is public before the test runs.",
  body: [
    `A buying standard is the set of questions a competent buyer in a category actually needs settled — and, for each one, what counts as evidence, what does not, and which surface decides when two of them disagree. AisleLens Coffee Standard ${COFFEE_STANDARD_VERSION} carries 42 such entries at a fixed version and content hash, so a result cites the exact contract it ran under and that citation still resolves a year later. Every entry is readable at its own URL, before you buy anything and before a test is run.`,
    "Ten of the 42 are executable against a public product page today. The other 32 are written down with the reason each one is not: 16 should be executable and the engine cannot reach them yet, each naming its own gap; 11 are real buyer questions that public data cannot adjudicate at all; and 5 are questions the engine can run and public data can settle, for which this standard has not yet written the binding and put it through the adversarial pass — recorded as unbound rather than quietly dropped.",
  ],
  pull: "We publish what we cannot test, and why.",
  after: [
    "Ten of forty-two is the honest ratio. A standard that listed only its own strengths would be marketing, and the second number is the one a merchant needs in order to know what a passing result did not cover.",
    // ⚠️ THE SAMPLE SIZES CAME OUT AT v4.3, AND THE PARAGRAPH USED TO CONTRADICT ITSELF
    // INSIDE THREE SENTENCES. It read "run against 100 real coffee products across 77
    // storefronts" and then, two sentences later, "we do not restate those figures here:
    // this page cannot derive them." Both halves cannot be true. The module header states
    // the rule — STRUCTURAL counts only, no measurement — and v4.1 already pulled two
    // paragraphs for breaking it; this one survived because the numbers it typed happened
    // to be right on the day, which is exactly what makes the class invisible. The
    // argument does not need them, and the page it points at generates them.
    "A category standard is fitness-measured on its own category before we publish an error rate for it. It has been run against real coffee products on real storefronts, and every single requirement it passed was then read individually against that store's full page text — not sampled. The passes that turned out to be wrong are counted, and the measured upper bound on the error rate a coffee roaster should expect is published on the standard's own page with the sample size, the method and the defect classes behind it. We do not restate those figures here: this page cannot derive them, and a number typed beside a generated one is how a page goes quietly false.",
    "The same discipline corrected a number we had published about ourselves. Our broad, non-category sample had been audited row by row and reported zero errors. Checking one defect class mechanically — a product identifier that is really the store's own internal id — found errors in that same sample that no reader could have caught, because that row shows the merchant no quote to be suspicious of. The figure had not been an error rate. It was a measurement of what that audit had thought to look for. The bound has moved three times since, each time because the audit got better, and every move is on the record.",
  ],
} as const;

/** §3.7 — the category break. The contrast IS the pitch.
 *  Rendered STACKED, not as a grid table: three columns of five rows is unreadable on a
 *  phone and reads as a feature matrix on a desktop, which is the genre this section
 *  exists to leave. The JS-off snapshot keeps a real <table>, because a comparison of
 *  three things across five dimensions is exactly what table semantics are for and a
 *  machine reader benefits from the structure a sighted reader does not need. */
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

// ⚠️ `HOW_IT_WORKS` WAS RETIRED HERE AT v4.3, DELIBERATELY, AND ONE OF ITS CLAIMS
// SURVIVES ELSEWHERE. Its five paragraph-length steps are replaced by two sections that
// each do one job: WORKFLOW states the five steps in one concrete sentence apiece (§3.3),
// and TEST_EXPLAINED carries the detail about surfaces and stopping conditions (§3.4).
// Running both would have said the same thing twice at different lengths.
//
// Its `note` — that shopping questions observed across external AI systems can seed
// executable store tests — is a real capability and is NOT deleted from the site: it is
// the fourth FAQ answer, which states it as an input rather than as the product. That is
// the right altitude for it on a page whose §3.7 argument is precisely that observation
// and execution are different things.

/** §3.6, second half — the demonstration. Labeled for exactly what it is.
 *
 *  This is the ONE matched before/after pair this project holds end to end, and it is a
 *  Shopify DEVELOPMENT store, not a client. It sits under the contract diagram rather
 *  than replacing it: the diagram shows what a rerun holds fixed, this shows that a rerun
 *  has actually been walked through in full, and the label says which is which. */
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
  OG_DEFAULT_LINE,
  ...Object.values(HERO),
  ...CREDIBILITY,
  BETA_BADGE,
  ...Object.values(HERO_ARTIFACT),
  DELIVERABLES.heading,
  DELIVERABLES.lead,
  ...DELIVERABLES.items.flat(),
  WORKFLOW.heading,
  WORKFLOW.lead,
  ...WORKFLOW.steps.flat(),
  TEST_EXPLAINED.heading,
  TEST_EXPLAINED.lead,
  ...TEST_EXPLAINED.surfaces.flat(),
  TEST_EXPLAINED.stops.lead,
  TEST_EXPLAINED.stops.body,
  REAL_EXAMPLE.heading,
  REAL_EXAMPLE.lead,
  REAL_EXAMPLE.peerNote,
  ...Object.values(BEFORE_AFTER),
  ENGINE_VALIDATION.heading,
  ...ENGINE_VALIDATION.body,
  ENGINE_VALIDATION.pull,
  STANDARD_SECTION.heading,
  ...STANDARD_SECTION.body,
  STANDARD_SECTION.pull,
  ...STANDARD_SECTION.after,
  CATEGORY_BREAK.heading,
  ...CATEGORY_BREAK.columns,
  ...CATEGORY_BREAK.rows.flat(),
  CATEGORY_BREAK.pull,
  DEMONSTRATION.heading,
  ...DEMONSTRATION.lines.flat(),
  DEMONSTRATION.label,
  DEMONSTRATION.cta,
  PILOT.heading,
  PILOT.body,
  PILOT.primary,
  PILOT.secondary,
  PILOT.mailSubject,
  PILOT.mailBody,
  PILOT.fine,
  ...FAQ.flat(),
  ...FOOTER.externalLinks.map(([, label]) => label),
  ...FOOTER.links.map(([, label]) => label),
  FOOTER.contact,
  FOOTER.fine,
];
