// ===========================================================================
// PDF TEXT EXTRACTION, zero dependencies.
//
// WHY THIS EXISTS RATHER THAN TRUSTING innerText. CP-2 asks for a proof "rendered",
// and `innerText` under print emulation is layout-derived but it is still the DOM.
// The artifact an agency actually forwards is the PDF, so the assertion that matters
// is about the PDF's bytes. Both legs are run; they must agree.
//
// HOW. Chrome writes FlateDecode content streams and embeds a ToUnicode CMap per
// subset font, so glyph codes are mappable. We scan objects, inflate streams, walk
// `BT…ET` text blocks tracking the current font via `Tf`, and decode `Tj`/`TJ`/`'`/`"`
// strings through that font's CMap.
//
// ⚠️ THIS EXTRACTOR IS ITSELF AN INSTRUMENT AND IS CANARIED BEFORE IT IS BELIEVED.
// An extractor that silently returns "" reads exactly like a page with no text — the
// flattering-direction failure. `selfTest()` requires a string known to be on the page
// AND requires a string known to be absent, and refuses to report on any PDF where the
// positive control is missing.
import zlib from "node:zlib";

/** Byte-level scan for `N G obj … endobj`. Deliberately not an xref parse: a linearised
 *  or object-stream PDF still yields its objects this way, and we need no ordering. */
function* objects(buf) {
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  const s = buf.toString("latin1");
  let m;
  while ((m = re.exec(s))) {
    const start = m.index;
    const end = s.indexOf("endobj", re.lastIndex);
    if (end === -1) continue;
    yield { num: Number(m[1]), start, headEnd: re.lastIndex, end, raw: s.slice(start, end) };
  }
}

function streamBytes(buf, obj) {
  const s = buf.toString("latin1");
  const sIdx = s.indexOf("stream", obj.headEnd);
  if (sIdx === -1 || sIdx > obj.end) return null;
  let dataStart = sIdx + "stream".length;
  if (s[dataStart] === "\r") dataStart++;
  if (s[dataStart] === "\n") dataStart++;
  const eIdx = s.indexOf("endstream", dataStart);
  if (eIdx === -1) return null;
  const raw = buf.subarray(dataStart, eIdx);
  const dict = s.slice(obj.headEnd, sIdx);
  if (/\/FlateDecode/.test(dict)) {
    try { return zlib.inflateSync(raw); } catch {
      try { return zlib.inflateRawSync(raw); } catch { return null; }
    }
  }
  return raw;
}

/** Parse a ToUnicode CMap into code -> string. Handles bfchar and bfrange. */
function parseCMap(text) {
  const map = new Map();
  const hexToStr = (h) => {
    let out = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const cu = parseInt(h.slice(i, i + 4), 16);
      if (!Number.isNaN(cu)) out += String.fromCharCode(cu);
    }
    return out;
  };
  for (const blk of text.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(parseInt(m[1], 16), hexToStr(m[2]));
    }
  }
  for (const blk of text.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      const base = parseInt(m[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + (c - lo)));
    }
  }
  return map;
}

/** Decode a PDF literal/hex string into raw character codes. */
function decodeStringToken(tok) {
  if (tok.startsWith("<")) {
    const h = tok.slice(1, -1).replace(/[^0-9A-Fa-f]/g, "");
    const out = [];
    for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2).padEnd(2, "0"), 16));
    return out;
  }
  const body = tok.slice(1, -1);
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\") {
      const n = body[++i];
      const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
      if (n in esc) out.push(esc[n]);
      else if (/[0-7]/.test(n)) {
        let oct = n;
        while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? "")) oct += body[++i];
        out.push(parseInt(oct, 8));
      } else out.push(n.charCodeAt(0));
    } else out.push(ch.charCodeAt(0));
  }
  return out;
}

/**
 * Extract all text from a PDF buffer.
 *
 * Two-byte vs one-byte codes: Chrome's subset fonts are almost always composite
 * (Identity-H, 2-byte codes). We decide per font from its CMap's own key range rather
 * than assuming, and fall back to 1-byte when a 2-byte read produces nothing mapped.
 */
export function extractText(buf) {
  const fontMaps = new Map();   // object number -> Map(code -> str)
  const objs = [...objects(buf)];
  const byNum = new Map(objs.map((o) => [o.num, o]));

  // 1. Every ToUnicode CMap in the file, keyed by its own object number.
  for (const o of objs) {
    const data = streamBytes(buf, o);
    if (!data) continue;
    const txt = data.toString("latin1");
    if (txt.includes("beginbfchar") || txt.includes("beginbfrange")) {
      fontMaps.set(o.num, parseCMap(txt));
    }
  }
  // 2. Font object -> its ToUnicode CMap.
  const nameToMap = new Map();
  for (const o of objs) {
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(o.raw);
    if (!tu) continue;
    const m = fontMaps.get(Number(tu[1]));
    if (m) nameToMap.set(o.num, m);
  }

  /**
   * 3. PER-PAGE resource dictionaries.
   *
   * ⚠️ A GLOBAL `/F1 -> font` MAP IS WRONG AND FAILS EXACTLY WHERE IT MATTERS. Each page
   * carries its own /Resources /Font dict, and Chrome reuses the same short names across
   * pages for different fonts — so a single global map keeps whichever binding it saw last
   * and silently decodes another page's glyphs through the wrong CMap. Measured on
   * /standards/coffee/1.3: 4 of 142 items read "absent from the PDF" while plainly present,
   * and every one broke at a `<code>` run — the monospace face. That is the worst possible
   * blind spot for this project, because `<code>` is where entry ids, content hashes and
   * quoted evidence live.
   */
  const readFontDict = (dictText) => {
    const map = new Map();
    const fontIdx = dictText.indexOf("/Font");
    if (fontIdx === -1) return map;
    // /Font may be inline (<< … >>) or an indirect reference.
    const indirect = /^\s*(\d+)\s+\d+\s+R/.exec(dictText.slice(fontIdx + 5));
    const body = indirect ? (byNum.get(Number(indirect[1]))?.raw ?? "") : dictText.slice(fontIdx);
    for (const m of body.matchAll(/\/([A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const fm = nameToMap.get(Number(m[2]));
      if (fm) map.set(m[1], fm);
    }
    return map;
  };

  // content-stream object number -> that page's name->CMap map
  const streamFonts = new Map();
  const pageOrder = [];
  for (const o of objs) {
    if (!/\/Type\s*\/Page\b/.test(o.raw) || /\/Type\s*\/Pages\b/.test(o.raw)) continue;
    const resIdx = o.raw.indexOf("/Resources");
    let dictText = resIdx === -1 ? "" : o.raw.slice(resIdx + "/Resources".length);
    const resIndirect = /^\s*(\d+)\s+\d+\s+R/.exec(dictText);
    if (resIndirect) dictText = byNum.get(Number(resIndirect[1]))?.raw ?? "";
    const fonts = readFontDict(dictText);
    const contents = /\/Contents\s+(?:(\d+)\s+\d+\s+R|\[([^\]]*)\])/.exec(o.raw);
    if (!contents) continue;
    const nums = contents[1]
      ? [Number(contents[1])]
      : [...contents[2].matchAll(/(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1]));
    for (const n of nums) { streamFonts.set(n, fonts); pageOrder.push(n); }
  }

  // Single-font documents: if nothing linked, use the only map we found.
  const soleMap = fontMaps.size === 1 ? [...fontMaps.values()][0] : null;

  // 4. Walk content streams IN PAGE ORDER, each with its own font table. Page order
  //    matters because a needle may span a page boundary and file order need not match.
  const walk = pageOrder.length
    ? pageOrder.map((n) => byNum.get(n)).filter(Boolean)
    : objs;
  let out = "";
  for (const o of walk) {
    const data = streamBytes(buf, o);
    if (!data) continue;
    const s = data.toString("latin1");
    if (!/\bBT\b/.test(s) || !/\b(Tj|TJ)\b/.test(s)) continue;

    const pageFonts = streamFonts.get(o.num) ?? null;
    let cur = soleMap;
    const tokenRe = /\/([A-Za-z0-9_.+-]+)\s+[\d.]+\s+Tf|\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b|\bET\b|\bTf\b/g;
    let m;
    while ((m = tokenRe.exec(s))) {
      const tok = m[0];
      if (m[1] !== undefined) { cur = pageFonts?.get(m[1]) ?? soleMap ?? cur; continue; }
      // ⚠️ `Td` IS NOT A LINE BREAK. Chrome emits it for kerning inside a word, so
      // treating it as one shattered "ALWAYS" into "AL W A YS" and the positive
      // control could not be found in a PDF that plainly contained it. Only the
      // explicit next-line and end-of-block operators separate.
      if (tok === "T*" || tok === "ET") { out += "\n"; continue; }
      if (tok === "Td" || tok === "TD") continue;
      if (tok[0] !== "(" && tok[0] !== "<") continue;
      const codes = decodeStringToken(tok);
      if (!cur) { out += codes.map((c) => String.fromCharCode(c)).join(""); continue; }
      // Prefer 2-byte if the map is keyed above 0xFF or the 2-byte read maps better.
      const two = [];
      for (let i = 0; i + 1 < codes.length; i += 2) two.push((codes[i] << 8) | codes[i + 1]);
      const hit2 = two.filter((c) => cur.has(c)).length;
      const hit1 = codes.filter((c) => cur.has(c)).length;
      const use = hit2 >= hit1 ? two : codes;
      out += use.map((c) => cur.get(c) ?? "").join("");
    }
    out += "\n";
  }
  return out;
}

/**
 * Containment, WHITESPACE-INSENSITIVE ON BOTH SIDES.
 *
 * A PDF has no word boundaries — only glyph positions. Chrome breaks a line wherever
 * it wraps and kerns inside words, so the same sentence can come back with spaces
 * missing, spaces added, or both. Collapsing whitespace is not enough; it has to be
 * removed. The cost is that "the cat" would match "thec at", which is a real but tiny
 * false-positive risk on the long evidence sentences this is used for — and it is
 * bounded by `selfTest`, which requires a negative control to be ABSENT before any
 * result from this function is believed.
 */
export function pdfHas(text, needle) {
  const n = (s) => s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/\s+/g, "").toLowerCase();
  return n(text).includes(n(needle));
}

/**
 * REFUSE TO REPORT ON AN UNVALIDATED EXTRACTOR.
 * `mustFind` is a string known to be rendered; `mustNotFind` is a string known to be
 * absent. Both are required — an extractor that returns the whole file as latin1 noise
 * would pass the positive control alone.
 */
export function selfTest(text, mustFind, mustNotFind) {
  const ok = pdfHas(text, mustFind) && !pdfHas(text, mustNotFind);
  return {
    extractor_live: ok,
    positive_control_found: pdfHas(text, mustFind),
    negative_control_absent: !pdfHas(text, mustNotFind),
    chars_extracted: text.replace(/\s+/g, " ").trim().length,
  };
}
