# OUTREACH PACK — the first ten agency conversations

**What this is:** the strategy, selection criteria, and message templates for 10–15 agency
contacts. `{DERIVED:…}` placeholders get filled by the v4.1 session from real artifacts —
no number in a sent message may be hand-typed. **What this is not:** a launch. It is the
P(G) measurement — the one term your framework says has killed every prior idea, finally
measured directly.

---

## 0. The posture

You are not selling. You are showing an agency something checkable about *their own
client* and asking one research question. That framing is honest (it's true), it converts
the conversation from pitch to peer review, and it survives your no-cold-SMB rule: this is
B2B outreach to a dozen named principals with client-specific findings attached, not
volume email to merchants.

**The one question the entire exercise exists to answer:**
> "What would this need to output for you to put it in a client deliverable?"

Their answers ARE the measurement. Everything else is delivery mechanism.

---

## 1. Two tracks — lead with the one that matches the agency

**Track A — the standard story (coffee/food-bev clients).** Full stack: published,
versioned, citable standard → executable test → peer benchmark against 100 real stores →
published error rate. This is the complete product and the strongest story. Use when the
agency has a coffee, food, beverage, or CPG client in their public portfolio.

**Track B — the findings story (any Shopify client).** No benchmark, no standard — just
two or three concrete, checkable findings from the general engine: an identifier an AI
can't match to anything, a claim with no evidence sentence behind it, a price that doesn't
parse the way an agent reads it. Honest sentence: *"conformance testing with a published
error rate."* Use for every other Shopify-focused agency.

**Never** imply an executable standard exists outside coffee. The moment one does, Track B
agencies get the upgrade email — which is a reason to talk to them now, not later.

---

## 2. Who — selection criteria for the first list

Build a list of 10–15. An agency qualifies when it hits at least three of:

1. **Shopify-centric** — in the Shopify Partners directory, or "Shopify" is on their
   homepage above the fold.
2. **Writes audit-shaped deliverables** — CRO teardowns, SEO audits, "site health"
   reports. They already sell documents; you make their documents defensible.
3. **Names clients publicly** — a portfolio/case-study page you can pull a store from.
   This is what makes the message specific instead of cold.
4. **5–50 people** — big enough to have retainer clients, small enough that a principal
   reads their own inbox.
5. **Publishes teardowns or has an audit productized** — these people already believe in
   the format; you're upgrading their instrument, not changing their religion.
6. **Bonus:** any public writing about AI shopping, answer engines, AEO/GEO — they've
   pre-sold themselves on the problem.

Where to look: Shopify Partners directory (filter: CRO/SEO/development), searches for
"Shopify CRO agency" / "Shopify SEO audit", LinkedIn for principals posting Shopify
teardowns, and the agencies whose names appear in DTC brand case studies.

**Disqualify:** pure ad-buying shops, enterprise SIs, agencies with no visible clients.

---

## 3. The message

Short. Founder to principal. Findings first, product second, ask last. Sent after running
their named client through the instrument.

> **Subject:** {CLIENT_BRAND} — 3 things an AI can't get from their product pages
>
> Hi {NAME} — I build conformance tests for AI commerce (solo founder, engineer at heart).
> I ran {CLIENT_BRAND} — saw them in your portfolio — against {TRACK_A: "a published
> buying standard for {CATEGORY}" | TRACK_B: "a set of machine-buyer conformance checks"}.
>
> Three findings, each checkable on their live page in ~30 seconds:
> - {DERIVED: finding 1 — one sentence + the evidence quote or the absence}
> - {DERIVED: finding 2}
> - {DERIVED: finding 3}
>
> {TRACK_A only: "For context: {DERIVED: X} of 100 {CATEGORY} stores we measured state
> this on-page — so this is a peer gap, not a nitpick."}
>
> The part that's unusual: we publish our own error rate ({DERIVED: current bound}, method
> public), version every standard, and every verdict carries the exact sentence it rests
> on — built so it can survive a client pushing back on it.
>
> I'm doing 5 conversations with agencies who write audit deliverables before deciding
> what to build next. 20 minutes: I'll run any client you pick live, and I want one answer
> from you — what would this need to output to go into a deliverable you'd sign?
>
> Full result for {CLIENT_BRAND}: {DERIVED: result URL}
> How it works under the hood, if anyone technical wants to kick it: {DERIVED: methodology URL}

**Rules:** every claim checkable; no urgency theater; no feature lists; one link above the
fold, one below. If a finding turns out weak when derived, swap it — never inflate it.

**Follow-up:** exactly one, +5 business days, two lines, attach the one-pager PDF. Then stop.

---

## 4. The call (20 minutes, run it like a user study)

- **0–5** — live run on a client THEY name. Say nothing while it loads. Watch where their
  eyes go and what they ask first; that's your information, not your talking time.
- **5–15** — their deliverable reality: what goes in a client audit today, how findings
  get challenged, what "defensible" means to them, what they'd pay for vs. bundle free.
- **15–20** — THE question, verbatim. Then, if warm, the design-partner offer:
  **"Pick the category. We'll author and publish the standard for your client's vertical —
  you get first citation and input on the buyer questions."** (Category #2's roadmap
  should be chosen by a customer, not guessed.)

**Signal taxonomy — write down which one you heard:**
- *"Can it output X / integrate with Y"* → real pull; X is the roadmap.
- *"How much / can we white-label"* → strongest possible signal; get specifics.
- *"Cool, send me info"* → polite no; count it as a no.
- *"My clients don't ask about AI"* → market-timing data; ask what WOULD trigger it.
- Silence on the error-rate disclosure vs. leaning in → tells you if the moat is legible.

**Success criterion, decided in advance:** 10–15 sends → 3–5 calls. Two or more agencies
naming a concrete output they'd pay for or bundle = build signal (P(G) > 0, finally
measured). Zero = the answer is information too, and it cost two weeks, not two years.

---

## 5. Manual checklist (you, not Claude)

- [ ] **Partner dashboard, 2 minutes:** if the AisleLens app is publicly listed with the
      retired AI-visibility copy — unlist it until rebuilt. Nobody is confused by an app
      they can't find. (Repo inventory couldn't see listing state; only you can.)
- [ ] Confirm `CONTACT_EMAIL`/reply-to on the domain actually receives mail.
- [ ] Build the 10–15 list against §2; for each, pick the portfolio client to run.
- [ ] Send 3–5 per week, personally, from your own address. No sequences, no tools.
- [ ] After each call: write the signal-taxonomy line within the hour, verbatim quotes.
- [ ] After 5 calls: bring the notes back — we turn their answers into the v4.2+ roadmap
      (or the honest decision the other way).

## 6. Guardrails

No cold merchant email, ever (the EventGravity/COI tombstone stands — agencies only). No
claim beyond what a page can verify in 30 seconds. Track A language never applied to a
Track B agency. The error rate is a feature — never hide it, never apologize for it. And
if nerves spike before send: reread the findings you're sending. Every one is a sentence
they can check themselves. You are the only person in this market who can say that.
