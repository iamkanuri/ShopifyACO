// The hero artifact, executed. Every figure the landing page will show, and proof the
// peer join lands on rows rather than looking like a standard with no measurement.
import { heroArtifact, heroArtifactScript } from "../../src/server/heroArtifact.js";
import { peerSentence } from "../../viewer/src/peerSentence.js";

const a = await heroArtifact();
console.log(`store        ${a.storeName} (${a.host})`);
console.log(`product      ${a.productName}`);
console.log(`standard     ${a.standard.title}`);
console.log(`hash         ${a.standard.hash.slice(0, 16)}…`);
console.log(`counts       ${JSON.stringify(a.counts)}`);
console.log(`capturedAt   ${a.capturedAt}`);
console.log("");

let withPeer = 0, withEntryUrl = 0, withQuote = 0, withAccepted = 0;
for (const r of a.rows) {
  if (r.peer) withPeer++;
  if (r.entryUrl) withEntryUrl++;
  if (r.quote) withQuote++;
  if (r.acceptedExample) withAccepted++;
  const passed = r.state === "proven" || r.state === "neutral";
  console.log(`${r.state.padEnd(16)} ${r.question}`);
  console.log(`   entry  ${r.entryId}  →  ${r.entryUrl}`);
  console.log(`   detail ${r.detail.slice(0, 100)}`);
  if (r.quote) console.log(`   quote  "${r.quote.slice(0, 90)}"  [${r.surface}]`);
  console.log(`   peer   ${r.peer ? peerSentence(r.peer, passed) : "(none)"}`);
  if (r.acceptedExample) console.log(`   would  ${JSON.stringify(r.acceptedExample)}`);
  console.log("");
}

console.log("=".repeat(78));
console.log(`rows                      ${a.rows.length}`);
console.log(`rows with a peer line     ${withPeer}/${a.rows.length}   <- v4.1 shipped 0/10 for a release`);
console.log(`rows with an entry URL    ${withEntryUrl}/${a.rows.length}`);
console.log(`rows with a store quote   ${withQuote}/${a.rows.length}`);
console.log(`rows with an accepted eg  ${withAccepted}/${a.rows.length}`);

// The serialised block must round-trip and must carry no raw `<`.
const script = heroArtifactScript(a);
const body = script.slice(script.indexOf(">") + 1, script.lastIndexOf("<"));
let parsed: unknown = null;
try { parsed = JSON.parse(body); } catch (e) { console.log(`PARSE FAILED: ${(e as Error).message}`); }
const rawAngle = /[<>]/.test(body);
console.log(`script round-trips        ${!!parsed && (parsed as { rows: unknown[] }).rows.length === a.rows.length}`);
console.log(`script has a raw < or >   ${rawAngle}  (must be false)`);
console.log(`script bytes              ${script.length}`);

const ok = withPeer === a.rows.length && withEntryUrl === a.rows.length && !!parsed && !rawAngle;
console.log(`completion: ${ok ? "VERIFIED_CLEAN" : "DEFECTS_FOUND"}`);
process.exit(ok ? 0 : 1);
