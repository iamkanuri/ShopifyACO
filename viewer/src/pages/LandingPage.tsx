import { useState } from "react";
import { navigate } from "../router";
import { ConnectShopify } from "../components/ConnectShopify";
import { peerSentence } from "../peerSentence";
import { readHeroArtifact, type HeroArtifact, type HeroArtifactRow } from "../heroArtifact";
import {
  BEFORE_AFTER,
  CATEGORY_BREAK,
  COFFEE_STANDARD_URL,
  CREDIBILITY,
  DELIVERABLES,
  DEMONSTRATION,
  ENGINE_VALIDATION,
  EXAMPLE_TEST_URL,
  FAQ,
  HERO,
  HERO_ARTIFACT,
  HERO_ROWS,
  PILOT,
  REAL_EXAMPLE,
  RESULT_GLYPH,
  STANDARD_SECTION,
  STANDARDS_INDEX_URL,
  TEST_EXPLAINED,
  WORKFLOW,
  type ResultState,
} from "../copy";

// ===========================================================================
// THE PUBLIC FRONT DOOR (v4.3). Four rules hold this page together.
//
//   • THE READER IS AN AGENCY PRINCIPAL, and the order is the argument: what they
//     hand a client, how the work runs, what the test actually reads, a complete
//     real result, the rerun contract, why this is not monitoring, how the engine
//     is validated, and only THEN the rigor. Nothing is removed from the site —
//     the standards section that used to lead is now the bridge at the end, which
//     is where a sceptic goes looking rather than where a buyer starts.
//
//   • EVERY STRING LIVES IN ../copy.ts, so the real claim linter can run over it in
//     test/siteCopy.test.ts. The site that sells claim discipline passes its own check.
//
//   • EVERY FIGURE COMES FROM AN ARTIFACT. Counts, verdicts, quotes, entry ids, the
//     content hash and the peer denominators are read from `readHeroArtifact()`, which
//     the server derives from the pinned klatchcoffee.com replay. Nothing on this page
//     is a typed number. The concept this design was drawn from invented failing
//     verdicts for a real, named roaster; a fabricated result about a real business is
//     the one class of false statement this project treats as unrecoverable.
//
//   • NO ARTIFACT ⇒ NO SECTION. Every artifact-backed block returns null when the
//     payload is missing, rather than falling back to a placeholder. A hero that
//     invents a plausible result when the real one failed to load would look completely
//     normal, which is exactly why it must not exist.
// ===========================================================================

/** The state glyph. Colour is the other half of the signal and neither carries it
 *  alone — that is what keeps the four states readable in greyscale and to a
 *  colourblind reader. */
function Glyph({ state }: { state: ResultState }) {
  return <span className={`v43-glyph v43-${state}`} aria-hidden>{RESULT_GLYPH[state]}</span>;
}

/** One executed requirement, as the page shows it: the buyer's question, the verdict,
 *  the store's own sentence where there is one, how the rest of the sample did, and the
 *  entry id that makes the whole row checkable. */
function EvidenceRow({ row, compact = false, className }: { row: HeroArtifactRow; compact?: boolean; className?: string }) {
  const passed = row.state === "proven" || row.state === "neutral";
  return (
    <li className={`v43-row v43-row-${row.state}${className ? ` ${className}` : ""}`}>
      <p className="v43-row-q">
        <Glyph state={row.state} />
        <span>{row.question}</span>
      </p>
      {!compact && <p className="v43-row-detail">{row.detail}</p>}
      {!compact && row.quote && (
        <blockquote className="v43-quote">
          &ldquo;{row.quote}&rdquo;
          <cite>
            Read from {row.surface}
            {row.surfaceUrl && (
              <>
                {" — "}
                <a href={row.surfaceUrl} target="_blank" rel="noopener noreferrer">{row.surfaceUrl}</a>
              </>
            )}
          </cite>
        </blockquote>
      )}
      {/* ⚠️ NEVER "of 100". Five of the ten measured coffee entries were asked of fewer
          than 100 products and one could only be DECIDED on 74 of the 100 it was asked.
          `peerSentence` is the ONE implementation that turns a peer record into a
          sentence, shared with the server-side result renderers. */}
      {row.peer && <p className="v43-peer">{peerSentence(row.peer, passed)}</p>}
      {row.entryId && (
        <p className="v43-cite">
          <a href={row.entryUrl ?? "#"}>{row.entryId}</a>
        </p>
      )}
    </li>
  );
}

/** §3.1 — the hero artifact. A short excerpt: the counts, the provenance, and the first
 *  few rows. The complete run is §3.5, so this one stays readable above the fold. */
function HeroArtifactCard({ a }: { a: HeroArtifact }) {
  return (
    <figure className="v43-artifact">
      <figcaption className="v43-artifact-head">
        <span className="v43-kicker">{HERO_ARTIFACT.kicker}</span>
        <span className="v43-artifact-store">
          {a.storeName ?? a.host} · {a.productName}
        </span>
      </figcaption>

      <dl className="v43-artifact-meta">
        <div><dt>Standard</dt><dd><a href={a.standard.url}>{a.standard.title}</a></dd></div>
        <div><dt>Content hash</dt><dd><code>{a.standard.hash.slice(0, 16)}…</code></dd></div>
        <div><dt>Result</dt><dd>
          {a.counts.pass} proven · {a.counts.notProven} not proven
          {a.counts.requiresAccess > 0 && <> · {a.counts.requiresAccess} requires store access</>}
        </dd></div>
      </dl>

      {/* v4.5 — the hero always renders `desktop` rows and CSS hides the tail below 700px;
          both count labels ship and CSS picks one. The width is never read in JS, so there
          is no resize listener, no hydration mismatch and no flash of the wrong count on
          first paint — the label and the list can never disagree, because the same media
          query decides both.
          ⚠️ This is NOT a JS-off benefit and an earlier draft of this comment said it was.
          `/` serves a separate `ssr-snapshot` body to a reader without JS and this card is
          not in it, so nothing here renders JS-off either way. Checked rather than assumed:
          the JS-off document is 16,779 characters of real content and contains no `v43-`
          markup at all. */}
      <ol className="v43-rows v43-rows-compact">
        {a.rows.slice(0, HERO_ROWS.desktop).map((r, i) => (
          <EvidenceRow
            key={r.entryId ?? r.question}
            row={r}
            compact
            className={i >= HERO_ROWS.mobile ? "v43-row-wide-only" : undefined}
          />
        ))}
      </ol>

      <p className="v43-artifact-count">
        <span className="v43-count-sm">
          {HERO_ARTIFACT.excerptPrefix} {Math.min(HERO_ROWS.mobile, a.rows.length)} of {a.rows.length} {HERO_ARTIFACT.excerptSuffix}
        </span>
        <span className="v43-count-lg">
          {HERO_ARTIFACT.excerptPrefix} {Math.min(HERO_ROWS.desktop, a.rows.length)} of {a.rows.length} {HERO_ARTIFACT.excerptSuffix}
        </span>
      </p>
      {/* ⚠️ NO CTA HERE. The hero's own form and its "run a test" button are three inches
          up the same viewport; a second call to action inside the artifact was the thing
          that made this card and the §example card read as duplicates of each other. The
          section card keeps its CTA, because by then the visitor has scrolled past the
          form and the button is the only way onward. */}
      <p className="v43-legend">{HERO_ARTIFACT.legend}</p>
    </figure>
  );
}

/** §3.6 — the rerun contract. Same standard, same hash, same entry; only the store's
 *  text moves. The right-hand sentence is the STANDARD's own published accepted-evidence
 *  example and is labeled illustrative — it is not, and must never be, a client result. */
function BeforeAfter({ a }: { a: HeroArtifact }) {
  const row = a.rows.find((r) => r.state === "unproven" && r.acceptedExample);
  if (!row) return null;
  return (
    <section className="v43-section v43-band" id="rerun">
      <div className="v43-measure">
        <h2>{BEFORE_AFTER.heading}</h2>
        <p className="v43-lead">{BEFORE_AFTER.lead}</p>
      </div>

      <div className="v43-invariant">
        <span className="v43-kicker">{BEFORE_AFTER.invariant}</span>
        <dl>
          <div><dt>Standard</dt><dd><a href={a.standard.url}>{a.standard.title}</a></dd></div>
          <div><dt>Content hash</dt><dd><code>{a.standard.hash.slice(0, 16)}…</code></dd></div>
          <div><dt>Entry</dt><dd><a href={row.entryUrl ?? "#"}>{row.entryId}</a></dd></div>
        </dl>
        <p className="v43-invariant-q">&ldquo;{row.question}&rdquo;</p>
      </div>

      <div className="v43-ba">
        <div className="v43-ba-col">
          <h3>{BEFORE_AFTER.beforeLabel}</h3>
          <p className="v43-ba-verdict"><Glyph state="unproven" /> Not proven</p>
          <p className="v43-row-detail">{row.detail}</p>
        </div>
        <div className="v43-ba-arrow" aria-hidden>→</div>
        <div className="v43-ba-col">
          <h3>{BEFORE_AFTER.afterLabel}</h3>
          <p className="v43-ba-verdict"><Glyph state="proven" /> Proven</p>
          {row.acceptedForm && <p className="v43-row-detail">{row.acceptedForm}</p>}
          <blockquote className="v43-quote v43-quote-illustrative">
            &ldquo;{row.acceptedExample}&rdquo;
            <cite>Illustrative</cite>
          </blockquote>
        </div>
      </div>
      <p className="v43-note v43-measure">{BEFORE_AFTER.illustrative}</p>

      <div className="v43-measure v43-demo">
        <h3>{DEMONSTRATION.heading}</h3>
        {DEMONSTRATION.lines.map(([lead, rest]) => (
          <p key={lead}><b>{lead}</b> {rest}</p>
        ))}
        <p className="v43-note">{DEMONSTRATION.label}</p>
      </div>
    </section>
  );
}

export function LandingPage() {
  const [url, setUrl] = useState("");
  // Read once, synchronously, on first render — the server put it in the document.
  const [artifact] = useState<HeroArtifact | null>(() => readHeroArtifact());

  function run(e?: React.FormEvent) {
    e?.preventDefault();
    const q = url.trim();
    navigate(q ? `/test?url=${encodeURIComponent(q)}` : "/test");
  }

  const mailto =
    `mailto:?subject=${encodeURIComponent(PILOT.mailSubject)}&body=${encodeURIComponent(PILOT.mailBody)}`;

  return (
    <div className="landing v43">
      {/* ---------- §3.1 HERO ---------- */}
      <section className="v43-hero">
        <div className="v43-hero-copy">
          <p className="v43-eyebrow">{HERO.eyebrow}</p>
          <h1>{HERO.headline}</h1>
          <p className="v43-hero-sub">{HERO.sub}</p>

          <form className="v43-hero-form" onSubmit={run}>
            <input
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={HERO.inputPlaceholder}
              aria-label={HERO.inputLabel}
            />
            <button type="submit" className="btn btn-primary lg">{HERO.cta}</button>
          </form>
          <p className="v43-hero-micro">{HERO.micro}</p>
          <p className="v43-hero-alt">
            {/* Plain <a>: /demo is server-rendered. */}
            <a href={EXAMPLE_TEST_URL}>{HERO.ctaSecondary}</a>
          </p>

          <ul className="v43-cred">
            {CREDIBILITY.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>

        <div className="v43-hero-art">
          {artifact && <HeroArtifactCard a={artifact} />}
        </div>
      </section>

      {/* ---------- §3.2 WHAT YOUR AGENCY DELIVERS ---------- */}
      <section className="v43-section" id="deliver">
        <div className="v43-measure">
          <h2>{DELIVERABLES.heading}</h2>
          <p className="v43-lead">{DELIVERABLES.lead}</p>
        </div>
        <ol className="v43-deliver">
          {DELIVERABLES.items.map(([title, body], i) => (
            <li key={title}>
              <span className="v43-num" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- §3.3 WORKFLOW ---------- */}
      <section className="v43-section v43-band" id="workflow">
        <div className="v43-measure">
          <h2>{WORKFLOW.heading}</h2>
          <p className="v43-lead">{WORKFLOW.lead}</p>
        </div>
        <ol className="v43-rail">
          {WORKFLOW.steps.map(([t, b], i) => (
            <li key={t}>
              <span className="v43-rail-n" aria-hidden>{i + 1}</span>
              <h3>{t}</h3>
              <p>{b}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- §3.4 THE EXECUTABLE BUYER TEST, EXPLAINED ---------- */}
      <section className="v43-section" id="how">
        <div className="v43-measure">
          <h2>{TEST_EXPLAINED.heading}</h2>
          <p className="v43-lead">{TEST_EXPLAINED.lead}</p>
        </div>
        <dl className="v43-surfaces">
          {TEST_EXPLAINED.surfaces.map(([t, b]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{b}</dd>
            </div>
          ))}
        </dl>
        <div className="v43-stops v43-measure">
          <h3>{TEST_EXPLAINED.stops.lead}</h3>
          <p>{TEST_EXPLAINED.stops.body}</p>
        </div>
      </section>

      {/* ---------- §3.5 THE REAL EXAMPLE ---------- */}
      {artifact && (
        <section className="v43-section v43-band" id="example">
          <div className="v43-measure">
            <h2>{REAL_EXAMPLE.heading}</h2>
            <p className="v43-lead">{REAL_EXAMPLE.lead}</p>
          </div>

          <div className="v43-example">
            <header className="v43-example-head">
              <div>
                <p className="v43-kicker">{HERO_ARTIFACT.kicker}</p>
                <p className="v43-example-store">
                  <a href={artifact.productUrl} target="_blank" rel="noopener noreferrer">
                    {artifact.storeName ?? artifact.host}
                  </a>
                  {" — "}{artifact.productName}
                </p>
              </div>
              <dl className="v43-artifact-meta">
                <div><dt>Standard</dt><dd><a href={artifact.standard.url}>{artifact.standard.title}</a></dd></div>
                <div><dt>Content hash</dt><dd><code>{artifact.standard.hash.slice(0, 16)}…</code></dd></div>
                <div><dt>Captured</dt><dd>{artifact.capturedAt.slice(0, 10)}</dd></div>
                <div><dt>Result</dt><dd>
                  {artifact.counts.pass} proven · {artifact.counts.notProven} not proven
                  {artifact.counts.requiresAccess > 0 && <> · {artifact.counts.requiresAccess} requires access</>}
                </dd></div>
              </dl>
            </header>

            {/* v4.5 — the line that tells a reader why this card is not the hero card
                again. It names the difference the hero's own count label implies:
                complete, and with the store's own sentence under every row. */}
            <p className="v43-example-job">{REAL_EXAMPLE.job}</p>
            <p className="v43-note">{HERO_ARTIFACT.note}</p>
            <ol className="v43-rows">
              {artifact.rows.map((r) => <EvidenceRow key={r.entryId ?? r.question} row={r} />)}
            </ol>
            <p className="v43-note">{REAL_EXAMPLE.peerNote}</p>
            <p className="v43-example-foot">
              <a href={artifact.demoUrl} className="btn">{HERO_ARTIFACT.more}</a>
            </p>
          </div>
        </section>
      )}

      {/* ---------- §3.6 BEFORE / AFTER ---------- */}
      {artifact && <BeforeAfter a={artifact} />}

      {/* ---------- §3.7 DIFFERENTIATION — stacked, never a matrix ---------- */}
      <section className="v43-section" id="difference">
        <div className="v43-measure">
          <h2>{CATEGORY_BREAK.heading}</h2>
        </div>
        <div className="v43-compare">
          {CATEGORY_BREAK.columns.map((col, ci) => (
            <div key={col} className={`v43-compare-col${ci === 2 ? " v43-compare-us" : ""}`}>
              <h3>{col}</h3>
              <ul>
                {CATEGORY_BREAK.rows.map((row) => (
                  <li key={row[ci]}>{row[ci]}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <blockquote className="v43-pull v43-measure">{CATEGORY_BREAK.pull}</blockquote>
      </section>

      {/* ---------- §3.8 ENGINE VALIDATION ---------- */}
      <section className="v43-section v43-band" id="validation">
        <div className="v43-measure">
          <h2>{ENGINE_VALIDATION.heading}</h2>
          {ENGINE_VALIDATION.body.map((p) => <p key={p} className="v43-prose">{p}</p>)}
          <blockquote className="v43-pull">{ENGINE_VALIDATION.pull}</blockquote>
        </div>
      </section>

      {/* ---------- §3.9 RIGOR YOU CAN INSPECT — the bridge, sequenced after value ---------- */}
      <section className="v43-section" id="rigor">
        <div className="v43-measure">
          <h2>{STANDARD_SECTION.heading}</h2>
          {STANDARD_SECTION.body.map((p) => <p key={p} className="v43-prose">{p}</p>)}
          <blockquote className="v43-pull">{STANDARD_SECTION.pull}</blockquote>
          {STANDARD_SECTION.after.map((p) => <p key={p} className="v43-prose v43-prose-sm">{p}</p>)}
          <p className="v43-rigor-links">
            {/* Both server-rendered documents — plain <a> in every case. */}
            <a href={COFFEE_STANDARD_URL}>{HERO.readStandard}</a>
            <a href={STANDARDS_INDEX_URL}>All published standards →</a>
            <a href={`${COFFEE_STANDARD_URL}/standard.json`}>The artifact as JSON →</a>
            <a href={`${COFFEE_STANDARD_URL}#measured-error`}>The measured error rate →</a>
          </p>
        </div>
      </section>

      {/* ---------- §3.10 PILOT ---------- */}
      <section className="v43-section" id="pilot">
        <div className="v43-cta-band">
          <h2>{PILOT.heading}</h2>
          <p>{PILOT.body}</p>
          <div className="v43-cta-row">
            <button type="button" className="btn btn-primary lg" onClick={() => navigate("/test")}>
              {PILOT.primary}
            </button>
            {/* An honest mail link, not a fabricated booking flow. */}
            <a className="btn lg" href={mailto}>{PILOT.secondary}</a>
          </div>
          <p className="v43-note">{PILOT.fine}</p>
          <p className="v43-note">
            <ConnectShopify className="as-link v43-appstore" label={HERO.connect} />
          </p>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="v43-section" id="faq">
        <div className="v43-measure">
          <h2>Questions</h2>
          <div className="v43-faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
