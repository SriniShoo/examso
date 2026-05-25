// ExamSo — single-file frontend.
//
// Sections (search // §N to jump):
//   §2 Constants               §3 Storage              §4 Helpers
//   §5 Schema validator        §6 Rich text (KaTeX + sanitised HTML/MathML/SVG)
//   §7 Audio                   §8 Toast                §9 Icons + Combobox
//  §10 State + delegation     §11 Pages               §12 Bootstrap

// §2 ────────────────────────────────────────────────────────────────────────

const STANDARDS = ["Easy", "Medium", "Hard", "Olympiad", "IIT"];
const SUBJECTS = ["Mathematics", "Science", "Social Studies", "Physics", "Chemistry", "Biology", "English", "Hindi", "Computer Science"];
const GRADES = ["Pre-KG", "KG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

// Event delegation tables. Populated by every section; consulted by the
// listeners in §10. Declared up here so section order doesn't constrain
// initialisation.
const ACTIONS = {};
const CHANGES = {};
const INPUTS = {};
const OPTION_IDS = ["a", "b", "c", "d"];
const OPTION_LETTER = { a: "A", b: "B", c: "C", d: "D" };
const HISTORY_LIMIT = 200;
const TOTAL_QUESTION_CAP = 100;
const ALERT_15 = 15 * 60;
const ALERT_5 = 5 * 60;
const ALERT_END = 10;

const KEYS = {
  studentName: "examso.student.name",
  history: "examso.history",
  draft: "examso.draft.config",
  candidateJson: "examso.candidate.json",
  session: "examso.session.active",
};

const DEFAULT_CONFIG = {
  studentName: "",
  grade: "8",
  subject: "Mathematics",
  topics: [],
  standard: "Medium",
  durationMinutes: 30,
  sections: ["Section A — Fundamentals"],
  questionsPerSection: 15,
  correctMarks: 4,
  wrongMarks: -1,
  unattemptedMarks: 0,
};

// §3 ────────────────────────────────────────────────────────────────────────

const local = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch (err) {
      if (err && err.name === "QuotaExceededError") {
        pruneHistory(20);
        try { localStorage.setItem(key, value); return true; }
        catch (e2) { console.error("storage quota exceeded", e2); return false; }
      }
      console.error("storage write failed", err);
      return false;
    }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch (e) { console.error("sessionStorage failed", e); } },
  remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
};

function readHistory() {
  const raw = local.get(KEYS.history);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeHistory(list) {
  list.sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  while (list.length > HISTORY_LIMIT) list.pop();
  local.set(KEYS.history, JSON.stringify(list));
}

function pruneHistory(toRemove) {
  const list = readHistory().sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
  list.splice(0, toRemove);
  local.set(KEYS.history, JSON.stringify(list));
}

function appendAttempt(record) {
  const list = readHistory();
  list.push(record);
  writeHistory(list);
}

function clearHistory() { local.remove(KEYS.history); }

function readStudentName() { return local.get(KEYS.studentName) ?? ""; }
function writeStudentName(name) { local.set(KEYS.studentName, name); }

function readDraft() {
  const raw = local.get(KEYS.draft);
  if (!raw) return { ...DEFAULT_CONFIG };
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function writeDraft(cfg) {
  const { studentName: _ignore, ...persistable } = cfg;
  local.set(KEYS.draft, JSON.stringify(persistable));
}

function readSession() {
  const raw = session.get(KEYS.session);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function writeSession(s) { session.set(KEYS.session, JSON.stringify(s)); }
function clearSession() { session.remove(KEYS.session); }

// §4 ────────────────────────────────────────────────────────────────────────

function formatTime(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDurationLong(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function formatDate(iso) {
  try { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(new Date(iso)); }
  catch { return iso; }
}
function formatDateTime(iso) {
  try { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch { return iso; }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function uniqueId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function paperHash(paper) {
  const json = JSON.stringify(normalize(paper));
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function shortHash(h) { return h.slice(0, 8); }

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, normalize(v)]),
    );
  }
  return value;
}

// §5 ────────────────────────────────────────────────────────────────────────
// Strict validator: we repair only transport artefacts (chat-UI typography
// quirks, code-fence wrappers). LLM mistakes — especially backslash
// under-escaping — surface as errors so the student can paste the message
// back to the LLM and get a corrected paper.

function normalizeTransport(raw) {
  return raw
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/\u00A0/g, " ");
}

function stripCodeFence(raw) {
  const t = raw.trim();
  const fence = /^```(?:json|jsonc)?\s*\n?([\s\S]*?)\n?```$/i;
  const m = t.match(fence);
  return m ? m[1].trim() : t;
}

function detectArtefacts(raw) {
  const t = raw.trim();
  if (!t) return "Paste your paper JSON to continue.";
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first === -1 || last === -1) return "This doesn't look like JSON. Paste an object that starts with `{` and ends with `}`.";
  if (first > 0 || last < t.length - 1) return "Your input has text outside the JSON. Remove anything before `{` or after `}`.";
  return null;
}

// Map JSON.parse messages to actionable feedback. A bad-escape error is
// almost always an under-escaped LaTeX backslash; we say so out loud so the
// student can ask the LLM to fix it.
function explainParseError(err, source) {
  const msg = String(err?.message || err);
  const offsetMatch = msg.match(/position (\d+)/i);
  const offset = offsetMatch ? Number(offsetMatch[1]) : -1;
  const around = offset >= 0 ? source.slice(Math.max(0, offset - 12), offset + 12) : "";

  if (/bad escaped character|invalid escape|unexpected token '\\'/i.test(msg)) {
    return [
      `Bad escape near “${around}”. JSON requires every backslash to be doubled.`,
      "Inside JSON strings, LaTeX commands like \\frac, \\hline, \\begin must be written as \\\\frac, \\\\hline, \\\\begin. Paste this message to your LLM and ask it to fix the backslash escaping.",
    ];
  }
  return [`Not valid JSON. ${msg}${around ? ` (near “${around}”)` : ""}`];
}

function validatePaper(raw) {
  const fenced = stripCodeFence(raw);
  const cleaned = normalizeTransport(fenced);
  const artefact = detectArtefacts(cleaned);
  if (artefact) return { ok: false, issues: [{ path: "", message: artefact }] };

  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    const [headline, ...details] = explainParseError(e, cleaned);
    return {
      ok: false,
      issues: [{ path: "(json)", message: headline }, ...details.map((m) => ({ path: "", message: m }))],
    };
  }

  const issues = [];
  const push = (path, message) => issues.push({ path, message });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const isStr = (v, min = 1) => typeof v === "string" && v.length >= min;
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const isInt = (v) => isNum(v) && Number.isInteger(v);

  if (!isObj(parsed)) return { ok: false, issues: [{ path: "", message: "Top-level value must be an object." }] };

  if (parsed.schemaVersion !== 1) push("schemaVersion", "Only schemaVersion 1 is supported.");

  const m = parsed.metadata;
  if (!isObj(m)) push("metadata", "Required object.");
  else {
    if (!isStr(m.title)) push("metadata.title", "Required string.");
    if (!isStr(m.grade)) push("metadata.grade", "Required string.");
    if (!isStr(m.subject)) push("metadata.subject", "Required string.");
    if (m.topics !== undefined && !Array.isArray(m.topics)) push("metadata.topics", "Must be an array of strings.");
    else if (Array.isArray(m.topics) && m.topics.some((t) => typeof t !== "string")) push("metadata.topics", "Each topic must be a string.");
    if (!STANDARDS.includes(m.standard)) push("metadata.standard", `Must be one of ${STANDARDS.join(", ")}.`);
    if (!SUBJECTS.includes(m.subject)) push("metadata.subject", `Must be one of ${SUBJECTS.join(", ")}.`);
    if (!isInt(m.durationMinutes) || m.durationMinutes < 1 || m.durationMinutes > 600) push("metadata.durationMinutes", "Must be an integer in 1..600.");
    if (!isObj(m.scoring) || !isNum(m.scoring.correct) || !isNum(m.scoring.wrong) || !isNum(m.scoring.unattempted)) {
      push("metadata.scoring", "Must be { correct: number, wrong: number, unattempted: number }.");
    }
  }

  if (!Array.isArray(parsed.sections) || parsed.sections.length < 1) {
    push("sections", "Must be a non-empty array.");
  } else {
    let totalQuestions = 0;
    const sectionIds = new Set();
    parsed.sections.forEach((sec, sIdx) => {
      const base = `sections[${sIdx}]`;
      if (!isObj(sec)) { push(base, "Must be an object."); return; }
      if (!isStr(sec.id)) push(`${base}.id`, "Required string.");
      if (sectionIds.has(sec.id)) push(`${base}.id`, "Section ids must be unique.");
      sectionIds.add(sec.id);
      if (!isStr(sec.title)) push(`${base}.title`, "Required string.");
      if (!Array.isArray(sec.questions) || sec.questions.length < 1) {
        push(`${base}.questions`, "Each section needs at least one question.");
        return;
      }
      const qIds = new Set();
      sec.questions.forEach((q, qIdx) => {
        const qb = `${base}.questions[${qIdx}]`;
        if (!isObj(q)) { push(qb, "Must be an object."); return; }
        if (!isStr(q.id)) push(`${qb}.id`, "Required string.");
        if (qIds.has(q.id)) push(`${qb}.id`, "Question ids must be unique within a section.");
        qIds.add(q.id);
        if (!isStr(q.text)) push(`${qb}.text`, "Required string.");
        if (!Array.isArray(q.options) || q.options.length !== 4) {
          push(`${qb}.options`, "Must be an array of exactly 4 options.");
        } else {
          const optIds = q.options.map((o) => (o && typeof o.id === "string" ? o.id.trim().toLowerCase() : ""));
          q.options.forEach((opt, oi) => {
            const ob = `${qb}.options[${oi}]`;
            if (!isObj(opt)) { push(ob, "Must be an object."); return; }
            const id = typeof opt.id === "string" ? opt.id.trim().toLowerCase() : "";
            if (!OPTION_IDS.includes(id)) push(`${ob}.id`, `Option id must be one of ${OPTION_IDS.join(", ")} (case-insensitive).`);
            opt.id = id;
            if (!isStr(opt.text)) push(`${ob}.text`, "Required string.");
          });
          const uniqueIds = new Set(optIds);
          if (uniqueIds.size !== 4 || !OPTION_IDS.every((x) => uniqueIds.has(x))) {
            push(`${qb}.options`, "Option ids must be exactly a, b, c, d with no duplicates.");
          }
        }
        const ans = typeof q.answer === "string" ? q.answer.trim().toLowerCase() : "";
        if (!OPTION_IDS.includes(ans)) push(`${qb}.answer`, "Must be one of a, b, c, d.");
        else q.answer = ans;
        if (q.explanation !== undefined && typeof q.explanation !== "string") push(`${qb}.explanation`, "Must be a string.");
        totalQuestions++;
      });
    });
    if (totalQuestions > TOTAL_QUESTION_CAP) {
      push("sections", `Total questions (${totalQuestions}) exceeds the ExamSo cap of ${TOTAL_QUESTION_CAP}.`);
    }
    if (totalQuestions < 1) push("sections", "Paper must contain at least one question.");
  }

  if (issues.length) return { ok: false, issues };

  // Ensure defaults so the renderers don't have to guard.
  parsed.metadata.topics = parsed.metadata.topics ?? [];
  parsed.metadata.instructions = parsed.metadata.instructions ?? "";
  parsed.sections.forEach((s) => {
    s.instructions = s.instructions ?? "";
    s.questions.forEach((q) => { q.explanation = q.explanation ?? ""; });
  });

  return { ok: true, paper: parsed, issues: [] };
}

// §6 ────────────────────────────────────────────────────────────────────────
// LaTeX (KaTeX) for math, native MathML as fallback, inline SVG for diagrams,
// a small HTML subset for prose and tables. Disallowed tags are unwrapped to
// their text content; on*= handlers and external URLs are stripped.

const ALLOWED = {
  p: ["class"], br: [],
  strong: [], em: [], b: [], i: [],
  ul: [], ol: [], li: [],
  code: [], span: ["class"],
  table: [], thead: [], tbody: [], tfoot: [], caption: [],
  tr: [], th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"],

  math: ["display", "xmlns"],
  mrow: [], mi: ["mathvariant"], mn: [], mo: ["stretchy", "fence", "separator"],
  mtext: [], ms: [], mspace: ["width"],
  msqrt: [], mroot: [],
  mfrac: ["linethickness"], msub: [], msup: [], msubsup: [],
  munder: [], mover: [], munderover: [],
  mtable: [], mtr: [], mtd: [],
  semantics: [], annotation: ["encoding"], "annotation-xml": ["encoding"],
  mfenced: ["open", "close", "separators"],

  svg: ["viewBox", "width", "height", "xmlns", "preserveAspectRatio", "fill", "stroke", "stroke-width", "role", "aria-label"],
  g: ["transform", "fill", "stroke", "stroke-width", "opacity"],
  defs: [],
  path: ["d", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "transform", "opacity"],
  rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width", "transform", "opacity"],
  circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width", "transform", "opacity"],
  ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke", "stroke-width", "transform", "opacity"],
  line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "stroke-dasharray", "transform", "opacity"],
  polyline: ["points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "transform", "opacity"],
  polygon: ["points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "transform", "opacity"],
  text: ["x", "y", "dx", "dy", "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "fill", "transform"],
  tspan: ["x", "y", "dx", "dy", "font-size", "font-weight", "fill"],
  marker: ["id", "markerWidth", "markerHeight", "refX", "refY", "orient", "viewBox"],
  use: ["x", "y", "width", "height"],   // No href/xlink:href: prevents external refs.
  symbol: ["id", "viewBox"],
  title: [], desc: [],
  mask: ["id"], pattern: ["id", "x", "y", "width", "height"],
  linearGradient: ["id", "x1", "y1", "x2", "y2", "gradientUnits"],
  radialGradient: ["id", "cx", "cy", "r", "fx", "fy", "gradientUnits"],
  stop: ["offset", "stop-color", "stop-opacity"],

  img: ["alt", "width", "height"],   // src is matched against isSafeUrl below.
};

const FORBIDDEN_TAGS = new Set(["script", "iframe", "object", "embed", "form", "style", "link", "meta", "base", "head", "html", "body", "noscript"]);

// SVG/MathML keep mixed-case attribute names through HTML parsing (viewBox,
// refX, …); we compare lowercase on both sides.
const ALLOWED_LC = Object.fromEntries(
  Object.entries(ALLOWED).map(([tag, attrs]) => [tag, new Set(attrs.map((a) => a.toLowerCase()))]),
);

function isSafeUrl(value) {
  if (typeof value !== "string") return false;
  return value.trim().toLowerCase().startsWith("data:image/");
}

function sanitizeNode(root) {
  // Snapshot children before iterating: we replace nodes during the loop.
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue;
    if (node.nodeType !== Node.ELEMENT_NODE) { node.remove(); continue; }
    const tag = node.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) { node.remove(); continue; }
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_LC, tag)) {
      // Unknown tags get unwrapped to their text so the words survive.
      node.replaceWith(document.createTextNode(node.textContent || ""));
      continue;
    }
    const allowedAttrs = ALLOWED_LC[tag];
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) { node.removeAttribute(attr.name); continue; }
      if (name === "src" || name === "href" || name === "xlink:href") {
        if (!isSafeUrl(attr.value)) node.removeAttribute(attr.name);
        continue;
      }
      if (!allowedAttrs.has(name)) node.removeAttribute(attr.name);
    }
    sanitizeNode(node);
  }
}

// Stash LaTeX segments behind opaque placeholders so the sanitiser leaves
// them untouched, sanitise the rest, then have KaTeX render the stashes
// straight into the final HTML. KaTeX output is trusted library output and
// never crosses the sanitiser, so the allow-list stays strict.
//
// The boundary characters live in the Unicode private-use area (U+E000 /
// U+E001) — the HTML parser preserves them verbatim. NULLs (U+0000)
// would be silently rewritten to U+FFFD on innerHTML round-trip, breaking
// the regex match.
//
// Placeholders are substituted by walking text nodes after sanitisation,
// not by string-replacing the serialised HTML. That way a placeholder
// that accidentally landed in an attribute value (e.g. an LLM that put
// math in <svg aria-label="…">) does not corrupt the HTML structure —
// the attribute keeps the placeholder character and the rest of the
// document still parses cleanly.
const MATH_OPEN = "\uE000";
const MATH_CLOSE = "\uE001";
const MATH_PLACEHOLDER_RE = /\uE000(\d+)\uE001/g;

function renderRich(source) {
  if (!source) return "";
  let s = String(source);
  const stashes = [];
  const stash = (display) => (_, body) => {
    stashes.push({ display, body });
    return `${MATH_OPEN}${stashes.length - 1}${MATH_CLOSE}`;
  };
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, stash(true));
  s = s.replace(/(?<!\\)\$([^\n$][^$\n]*?)\$/g, stash(false));

  // Outside of math, `\$` is the documented escape for a literal dollar sign
  // (e.g. currency: "Pay \$5"). After the math regex has had its chance
  // it's safe to drop the backslash so the user sees a clean `$`.
  s = s.replace(/\\\$/g, "$");

  s = s.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");

  const tpl = document.createElement("template");
  tpl.innerHTML = s;
  sanitizeNode(tpl.content);
  if (stashes.length) substituteMathInTextNodes(tpl.content, stashes);
  return tpl.innerHTML;
}

function substituteMathInTextNodes(root, stashes) {
  // Snapshot first: replacement mutates the parent's child list.
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      substituteOneTextNode(child, stashes);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      substituteMathInTextNodes(child, stashes);
    }
  }
}

function substituteOneTextNode(textNode, stashes) {
  const text = textNode.nodeValue;
  if (!text || !text.includes(MATH_OPEN)) return;
  const parts = text.split(MATH_PLACEHOLDER_RE);
  if (parts.length === 1) return;

  const fragment = document.createDocumentFragment();
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) fragment.appendChild(document.createTextNode(part));
    } else {
      const wrapper = document.createElement("span");
      wrapper.innerHTML = renderMath(stashes[Number(part)]);
      while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
    }
  });
  textNode.replaceWith(fragment);
}

function renderMath({ display, body }) {
  const fallback = `<code>${escapeHtml(display ? `$$${body}$$` : `$${body}$`)}</code>`;
  if (typeof window.katex === "undefined") return fallback;
  try {
    return window.katex.renderToString(body, {
      displayMode: display,
      throwOnError: false,
      output: "html",
      strict: "ignore",
    });
  } catch {
    return fallback;
  }
}

// §7 ────────────────────────────────────────────────────────────────────────

let audioCtx = null;
function ding(pitch = 880, durationMs = 90) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitch, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.5, now + durationMs / 1000);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.02);
  } catch { /* silent */ }
}

// §8 ────────────────────────────────────────────────────────────────────────

const tray = () => document.getElementById("toast-tray");
function toast(message, { tone = "default", description = "", duration = 3500 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${tone}`;
  el.innerHTML = `<div><div>${escapeHtml(message)}</div>${description ? `<div class="desc">${escapeHtml(description)}</div>` : ""}</div>`;
  tray()?.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// §9 ────────────────────────────────────────────────────────────────────────

const ICON = {
  spark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.94 14.06 12 22l2.06-7.94L22 12l-7.94-2.06L12 2l-2.06 7.94L2 12Z"/></svg>`,
  arrowRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  upload: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  award: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><polyline points="8.21 13.89 7 22 12 19 17 22 15.79 13.88"/></svg>`,
  rotate: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-7h-6v7H5a2 2 0 0 1-2-2Z"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  eraser: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m20 20-3-3"/><path d="M2.5 14.5 9 21l11.5-11.5a2.83 2.83 0 0 0 0-4l-2-2a2.83 2.83 0 0 0-4 0L2.5 14.5Z"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  printer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="3" x2="3" y2="21"/><line x1="3" y1="21" x2="21" y2="21"/><polyline points="7 14 11 10 14 13 20 7"/></svg>`,
  chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`,
  chevronRight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  send: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
};

const icon = (name, size = 16) => `<span class="icon" aria-hidden="true" style="display:inline-flex;width:${size}px;height:${size}px;">${ICON[name]}</span>`;

// Combobox: input + filterable popup with free-text fallback.
// Open state lives on the DOM (data-open) so opening/closing never
// triggers a full render and never disturbs input focus.

function combo({ name, value, options, placeholder = "", id = "" }) {
  return `
    <div class="combo" data-combo data-name="${name}">
      <input class="input combo-input" id="${id}"
             role="combobox" aria-expanded="false" aria-controls="combo-${name}-popup"
             value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"
             autocomplete="off" spellcheck="false"
             data-input="${name}" data-combo-input="${name}" />
      <button type="button" class="combo-toggle"
              data-action="combo-toggle" data-name="${name}"
              tabindex="-1" aria-label="Toggle ${escapeHtml(name)} options">
        ${icon("chevronDown", 14)}
      </button>
      <div class="combo-popup" id="combo-${name}-popup" role="listbox"
           data-combo-popup="${name}">
        ${comboOptionsHtml(name, value, options)}
      </div>
    </div>
  `;
}

function comboOptionsHtml(name, filter, options) {
  const f = (filter || "").trim().toLowerCase();
  const filtered = f ? options.filter((o) => o.toLowerCase().includes(f)) : options;
  if (filtered.length === 0) {
    return `<div class="combo-empty">No matches. Press <kbd>Enter</kbd> to use “${escapeHtml(filter)}”.</div>`;
  }
  return filtered
    .map(
      (o) => `<button type="button" class="combo-option" role="option"
              data-action="combo-select" data-name="${name}"
              data-value="${escapeHtml(o)}">${highlightMatch(o, f)}</button>`,
    )
    .join("");
}

function highlightMatch(option, filter) {
  if (!filter) return escapeHtml(option);
  const i = option.toLowerCase().indexOf(filter);
  if (i === -1) return escapeHtml(option);
  return (
    escapeHtml(option.slice(0, i)) +
    `<mark>${escapeHtml(option.slice(i, i + filter.length))}</mark>` +
    escapeHtml(option.slice(i + filter.length))
  );
}

const COMBO_OPTIONS = { "cfg-subject": SUBJECTS, "cfg-grade": GRADES };

function setComboOpen(name, open) {
  const wrapper = document.querySelector(`[data-combo][data-name="${name}"]`);
  if (!wrapper) return;
  wrapper.setAttribute("data-open", open ? "true" : "false");
  wrapper.querySelector(".combo-input")?.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeAllCombos() {
  document.querySelectorAll('[data-combo][data-open="true"]').forEach((el) => {
    el.setAttribute("data-open", "false");
    el.querySelector(".combo-input")?.setAttribute("aria-expanded", "false");
  });
}

function refreshComboPopup(name) {
  const popup = document.querySelector(`[data-combo-popup="${name}"]`);
  const input = document.querySelector(`[data-combo-input="${name}"]`);
  const opts = COMBO_OPTIONS[name];
  if (popup && input && opts) popup.innerHTML = comboOptionsHtml(name, input.value, opts);
}

ACTIONS["combo-toggle"] = (el) => {
  const name = el.dataset.name;
  const wrapper = document.querySelector(`[data-combo][data-name="${name}"]`);
  if (!wrapper) return;
  const open = wrapper.getAttribute("data-open") === "true";
  closeAllCombos();
  if (!open) {
    setComboOpen(name, true);
    wrapper.querySelector(".combo-input")?.focus();
  }
};

ACTIONS["combo-select"] = (el) => {
  const name = el.dataset.name;
  const input = document.querySelector(`[data-combo-input="${name}"]`);
  if (input) {
    input.value = el.dataset.value;
    // Replay through the registered INPUTS handler so config + prompt update.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  setComboOpen(name, false);
};

document.addEventListener("focusin", (e) => {
  const input = e.target.closest("[data-combo-input]");
  if (!input) {
    if (!e.target.closest("[data-combo]")) closeAllCombos();
    return;
  }
  closeAllCombos();
  setComboOpen(input.dataset.comboInput, true);
  refreshComboPopup(input.dataset.comboInput);
});

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest("[data-combo]")) closeAllCombos();
});

document.addEventListener("keydown", (e) => {
  const open = document.querySelector('[data-combo][data-open="true"]');
  if (!open) return;
  const name = open.getAttribute("data-name");
  if (e.key === "Escape") {
    e.preventDefault();
    closeAllCombos();
    return;
  }
  const popup = open.querySelector(".combo-popup");
  const items = popup ? Array.from(popup.querySelectorAll(".combo-option")) : [];
  const activeIdx = items.findIndex((it) => it.dataset.active === "true");
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (items.length === 0) return;
    e.preventDefault();
    const next =
      e.key === "ArrowDown"
        ? Math.min(items.length - 1, activeIdx < 0 ? 0 : activeIdx + 1)
        : Math.max(0, activeIdx < 0 ? 0 : activeIdx - 1);
    items.forEach((it, i) => it.setAttribute("data-active", i === next ? "true" : "false"));
    items[next].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (activeIdx >= 0 && items[activeIdx]) ACTIONS["combo-select"](items[activeIdx]);
    else closeAllCombos();
  }
});

// §10 ───────────────────────────────────────────────────────────────────────

const state = {
  route: routeFromHash(),
  config: readDraft(),
  jsonText: "",
  loaded: null,
  exam: null,
  lastResult: null,
  reviewFilter: "all",
  reviewSection: "all",
  paletteOpen: false,
  dashboard: { subject: "all", grade: "all", standard: "all", expanded: null },
};

state.config.studentName = readStudentName() || state.config.studentName;

function routeFromHash() {
  const h = (location.hash || "#/").replace(/^#/, "") || "/";
  return h.split("?")[0];
}

let renderScheduled = false;
function render() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    paint();
  });
}

const $app = () => document.getElementById("app");
const $brand = () => document.getElementById("brand-bar");

function paint() {
  $brand().innerHTML = renderBrandBar();
  const r = state.route;
  const out = $app();
  if (r === "/" || r === "") out.innerHTML = renderHome();
  else if (r === "/validate") renderValidate(out);
  else if (r === "/exam") renderExam(out);
  else if (r === "/result") renderResult(out);
  else if (r === "/certificate") renderCertificate(out);
  else if (r === "/dashboard") renderDashboard(out);
  else { location.hash = "#/"; return; }

  syncReviewDialog();
  document.body.classList.toggle("printing", r === "/certificate");
}

// <dialog> is rendered without `open`. showModal() promotes it to a centred
// modal with backdrop and focus trap; native close() handles Esc.
function syncReviewDialog() {
  const dlg = document.getElementById("review-dialog");
  if (!dlg || !state.exam?.showReview) return;
  if (!dlg.open) {
    try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); }
  }
  dlg.addEventListener("close", () => {
    if (state.exam) state.exam.showReview = false;
  }, { once: true });
  dlg.addEventListener("mousedown", (ev) => {
    if (ev.target === dlg) dlg.close();
  }, { once: true });
}

// Brand wordmark — `examso` with the spark dot. Used in the brand bar,
// the mobile palette drawer header, and the certificate header. Kept as a
// helper so the markup is one source of truth.
const brandWord = () =>
  `<span class="brand-word">examso<span class="brand-spark" aria-hidden></span></span>`;

function renderBrandBar() {
  if (state.route === "/certificate") return "";
  return `
    <div class="container brand-bar-inner">
      <a href="#/" class="brand">
        <img src="icon.svg" alt="" class="brand-icon" aria-hidden="true" />
        ${brandWord()}
        <span class="brand-tagline">· Exam? So?</span>
      </a>
      <nav>
        <a class="nav-link ${state.route === "/dashboard" ? "active" : ""}" href="#/dashboard">${icon("chart", 14)} My progress</a>
      </nav>
    </div>
  `;
}

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.getAttribute("data-action");
  const handler = ACTIONS[action];
  if (handler) handler(el, e);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  const handler = CHANGES[el.getAttribute("data-change")];
  if (handler) handler(el, e);
});
document.addEventListener("input", (e) => {
  const el = e.target.closest("[data-input]");
  if (!el) return;
  const handler = INPUTS[el.getAttribute("data-input")];
  if (handler) handler(el, e);
});

window.addEventListener("hashchange", () => {
  const prev = state.route;
  state.route = routeFromHash();
  if (prev === "/exam" && state.route !== "/exam") cleanupExamRuntime();
  state.paletteOpen = false;
  render();
});

function cleanupExamRuntime() {
  if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
  if (examUnloadGuard) {
    window.removeEventListener("beforeunload", examUnloadGuard);
    examUnloadGuard = null;
  }
  document.getElementById("countdown-overlay")?.remove();
  // On re-entry the timer should pick up from wall clock, not from the
  // paused tick count, so drop the in-memory exam and let session storage
  // restore it.
  if (state.exam && !state.exam.submitted) state.exam = null;
}

// §11 ───────────────────────────────────────────────────────────────────────

// ── Home ─────────────────────────────────────────────────────────────────────

// The actual prompt text lives in prompt.template.js. We just substitute
// the {{placeholders}} here. To edit the prompt, edit that file — no need
// to touch app.js.
function buildPrompt(c) {
  const tpl = window.PROMPT_TEMPLATE ?? "(prompt.template.js failed to load)";
  const fields = {
    grade: c.grade,
    subject: c.subject,
    topics: c.topics.length ? c.topics.join(", ") : "(no specific topics)",
    standard: c.standard,
    durationMinutes: c.durationMinutes,
    sectionsList: c.sections.map((s) => `"${s}"`).join(", "),
    questionsPerSection: c.questionsPerSection,
    correctMarks: c.correctMarks,
    wrongMarks: c.wrongMarks,
    unattemptedMarks: c.unattemptedMarks,
    questionCap: TOTAL_QUESTION_CAP,
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(fields, key) ? String(fields[key]) : `{{${key}}}`,
  );
}

function renderHome() {
  const c = state.config;
  const prompt = buildPrompt(c);
  const canContinue = state.jsonText.trim().length > 0 && c.studentName.trim().length > 0;
  return `
    <div class="container">
      <section class="stack">
        <div class="hero-tag">${icon("spark", 14)}<span>Bring your own paper</span></div>
      </section>

      <section class="card" style="margin-top:2rem">
        <div class="card-head">
          <div class="row-between">
            <div>
              <div class="card-title"><span class="muted">Step 1.</span> Configure the paper</div>
              <div class="card-desc">These values fill in the prompt below.</div>
            </div>
            <span class="badge badge-muted">No account · No upload</span>
          </div>
        </div>
        <div class="card-body">
          ${renderConfigForm(c)}
        </div>
      </section>

      <section style="margin-top:1.5rem">
        <div style="margin-bottom:0.75rem">
          <h3><span class="muted">Step 2.</span> Copy this prompt &amp; ask an LLM</h3>
          <p class="muted" style="font-size:0.875rem; margin-top:0.25rem">Open a fresh chat in ChatGPT, Claude, or Gemini. Paste the prompt. Copy the JSON response back here.</p>
        </div>
        <div class="prompt">
          <div class="prompt-head">
            <div>Prompt for your LLM</div>
            <button class="btn btn-soft btn-sm" data-action="copy-prompt">${icon("copy", 14)} Copy prompt</button>
          </div>
          <pre class="prompt-body" id="prompt-body">${escapeHtml(prompt)}</pre>
        </div>
      </section>

      <section class="card" style="margin-top:1.5rem">
        <div class="card-head">
          <div class="card-title"><span class="muted">Step 3.</span> Paste the JSON paper</div>
          <div class="card-desc">Only strict JSON. No markdown fences, no commentary around it.</div>
        </div>
        <div class="card-body">
          <div class="json-drop" id="json-drop">
            <textarea class="textarea" id="json-input" data-input="json" rows="10" spellcheck="false" placeholder='Paste your paper JSON here.&#10;&#10;{ &quot;schemaVersion&quot;: 1, &quot;metadata&quot;: { ... }, &quot;sections&quot;: [ ... ] }'>${escapeHtml(state.jsonText)}</textarea>
          </div>
          <div class="dropzone-meta" style="margin-top:0.5rem">
            <span>or</span>
            <button class="btn btn-secondary btn-sm" data-action="trigger-upload">${icon("upload", 14)} Upload .json</button>
            <span class="muted hide-on-mobile">— you can also drag &amp; drop the file above.</span>
            <input type="file" id="json-file" accept="application/json,.json" style="display:none" data-change="upload-json" />
          </div>
        </div>
        <div class="card-foot">
          <div class="muted" style="margin-right:auto; font-size:0.75rem">${state.jsonText.trim().length ? `${state.jsonText.length.toLocaleString()} characters` : "Awaiting JSON…"}</div>
          <button class="btn" data-action="go-validate" ${canContinue ? "" : "disabled"}>Validate &amp; preview ${icon("arrowRight")}</button>
        </div>
      </section>
    </div>
  `;
}

function renderConfigForm(c) {
  const sectionRows = c.sections
    .map(
      (s, i) => `
      <div class="row" style="display:flex;gap:0.5rem">
        <input class="input" data-input="section" data-i="${i}" value="${escapeHtml(s)}" placeholder="Section ${String.fromCharCode(65 + i)}" />
        <button class="btn btn-ghost btn-sm" data-action="remove-section" data-i="${i}" aria-label="Remove section" ${c.sections.length === 1 ? "disabled" : ""}>${icon("trash", 14)}</button>
      </div>`,
    )
    .join("");

  return `
    <div class="fields-grid">
      <div class="field">
        <label class="field-label" for="cfg-name">Student name<span class="req">*</span></label>
        <input class="input" id="cfg-name" data-input="cfg-studentName" value="${escapeHtml(c.studentName)}" placeholder="e.g. Shlok" autocomplete="off" />
      </div>
      <div class="field">
        <label class="field-label" for="cfg-grade">Grade</label>
        ${combo({ name: "cfg-grade", id: "cfg-grade", value: c.grade, options: GRADES, placeholder: "Pick or type (e.g. 5, KG)" })}
      </div>
      <div class="field">
        <label class="field-label" for="cfg-subject">Subject</label>
        ${combo({ name: "cfg-subject", id: "cfg-subject", value: c.subject, options: SUBJECTS, placeholder: "Pick or type a subject" })}
      </div>
      <div class="field">
        <label class="field-label" for="cfg-topics">Topics</label>
        <input class="input" id="cfg-topics" data-input="cfg-topics" value="${escapeHtml(c.topics.join(", "))}" placeholder="e.g. Algebra, Geometry" autocomplete="off" />
        <div class="field-hint">Comma-separated. Optional.</div>
      </div>
      <div class="field">
        <label class="field-label" for="cfg-standard">Standard</label>
        <select class="select" id="cfg-standard" data-change="cfg-standard">
          ${STANDARDS.map((s) => `<option ${s === c.standard ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label class="field-label" for="cfg-duration">Duration (minutes)</label>
        <input class="input" id="cfg-duration" type="number" min="1" max="600" data-input="cfg-duration" value="${c.durationMinutes}" />
      </div>
      <div class="field">
        <label class="field-label" for="cfg-qps">Questions per section</label>
        <input class="input" id="cfg-qps" type="number" min="1" max="100" data-input="cfg-qps" value="${c.questionsPerSection}" />
      </div>
      <div class="field">
        <label class="field-label">Marks per question</label>
        <div class="scoring-row">
          <div class="scoring-cell">
            <span class="scoring-cell-label good">Correct</span>
            <input class="input" type="number" data-input="cfg-correct" value="${c.correctMarks}" aria-label="Marks for a correct answer" />
          </div>
          <div class="scoring-cell">
            <span class="scoring-cell-label bad">Wrong</span>
            <input class="input" type="number" data-input="cfg-wrong" value="${c.wrongMarks}" aria-label="Marks for a wrong answer (negative for penalties)" />
          </div>
          <div class="scoring-cell">
            <span class="scoring-cell-label muted">Skipped</span>
            <input class="input" type="number" data-input="cfg-unatt" value="${c.unattemptedMarks}" aria-label="Marks for an unattempted question" />
          </div>
        </div>
      </div>
      <div class="field span-2">
        <label class="field-label">Sections</label>
        <div class="stack-tight">${sectionRows}</div>
        <button class="btn btn-secondary btn-sm" style="align-self:flex-start;margin-top:0.4rem" data-action="add-section">${icon("plus", 14)} Add section</button>
        <div class="field-hint">At least one section.</div>
      </div>
    </div>
  `;
}


// Imperative — avoids a re-render so focus stays in whichever field the
// student was typing in.
ACTIONS["copy-prompt"] = async (btn) => {
  const txt = document.getElementById("prompt-body")?.textContent || "";
  try {
    await navigator.clipboard.writeText(txt);
    const original = btn.innerHTML;
    btn.innerHTML = `${icon("check", 14)} Copied`;
    btn.disabled = true;
    toast("Prompt copied", {
      tone: "success",
      description: "Paste it into ChatGPT, Claude, or Gemini.",
    });
    setTimeout(() => {
      btn.innerHTML = original;
      btn.disabled = false;
    }, 1800);
  } catch {
    toast("Copy failed. Select the text and copy manually.", { tone: "error" });
  }
};

ACTIONS["trigger-upload"] = () => document.getElementById("json-file")?.click();
CHANGES["upload-json"] = async (el) => {
  const f = el.files?.[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast("File too large. JSON papers should be under 2 MB.", { tone: "error" }); return; }
  try {
    const text = await f.text();
    state.jsonText = text;
    const ta = document.getElementById("json-input");
    if (ta) ta.value = text;
    toast(`Loaded ${f.name}`, { tone: "success" });
    updateHomeFooter();
  } catch {
    toast("Could not read that file.", { tone: "error" });
  }
  el.value = "";
};

INPUTS["json"] = (el) => { state.jsonText = el.value; updateHomeFooter(); };
function updateHomeFooter() {
  // light update — no full re-render needed for keystrokes
  const meta = document.querySelector(".card-foot .muted");
  if (meta) meta.textContent = state.jsonText.trim().length ? `${state.jsonText.length.toLocaleString()} characters` : "Awaiting JSON…";
  const btn = document.querySelector('[data-action="go-validate"]');
  if (btn) btn.toggleAttribute("disabled", !(state.jsonText.trim().length > 0 && state.config.studentName.trim().length > 0));
}

INPUTS["cfg-studentName"] = (el) => { state.config.studentName = el.value; updateHomeFooter(); };
INPUTS["cfg-grade"] = (el) => { state.config.grade = el.value; persistDraftAndRefreshPrompt(); refreshComboPopup("cfg-grade"); };
INPUTS["cfg-subject"] = (el) => { state.config.subject = el.value; persistDraftAndRefreshPrompt(); refreshComboPopup("cfg-subject"); };
INPUTS["cfg-topics"] = (el) => { state.config.topics = el.value.split(",").map((t) => t.trim()).filter(Boolean); persistDraftAndRefreshPrompt(); };
INPUTS["cfg-duration"] = (el) => { state.config.durationMinutes = Number(el.value); persistDraftAndRefreshPrompt(); };
INPUTS["cfg-qps"] = (el) => { state.config.questionsPerSection = Number(el.value); persistDraftAndRefreshPrompt(); };
INPUTS["cfg-correct"] = (el) => { state.config.correctMarks = Number(el.value); persistDraftAndRefreshPrompt(); };
INPUTS["cfg-wrong"] = (el) => { state.config.wrongMarks = Number(el.value); persistDraftAndRefreshPrompt(); };
INPUTS["cfg-unatt"] = (el) => { state.config.unattemptedMarks = Number(el.value); persistDraftAndRefreshPrompt(); };
CHANGES["cfg-standard"] = (el) => { state.config.standard = el.value; persistDraftAndRefreshPrompt(); };

INPUTS["section"] = (el) => {
  const i = Number(el.dataset.i);
  state.config.sections[i] = el.value;
  persistDraftAndRefreshPrompt();
};
ACTIONS["add-section"] = () => {
  state.config.sections.push(`Section ${String.fromCharCode(65 + state.config.sections.length)}`);
  writeDraft(state.config);
  render();
};
ACTIONS["remove-section"] = (el) => {
  const i = Number(el.dataset.i);
  if (state.config.sections.length <= 1) return;
  state.config.sections.splice(i, 1);
  writeDraft(state.config);
  render();
};

function persistDraftAndRefreshPrompt() {
  writeDraft(state.config);
  const body = document.getElementById("prompt-body");
  if (body) body.textContent = buildPrompt(state.config);
}

ACTIONS["go-validate"] = () => {
  if (!state.jsonText.trim()) return;
  writeStudentName(state.config.studentName.trim());
  session.set(KEYS.candidateJson, state.jsonText);
  location.hash = "#/validate";
};

// Drag & drop — bind once after first home render below in setupOneTimeBindings()

// ── Validate ─────────────────────────────────────────────────────────────────

async function renderValidate(out) {
  out.innerHTML = `<div class="container"><div class="card"><div class="card-body muted">Checking your paper…</div></div></div>`;
  const raw = session.get(KEYS.candidateJson) || state.jsonText || "";
  const result = validatePaper(raw);
  if (!result.ok) {
    out.innerHTML = `
      <div class="container">
        <div class="card error-card fade-in">
          <div class="card-head row" style="align-items:flex-start">
            <span class="icon-circle">${icon("alert", 14)}</span>
            <div>
              <div class="card-title">We can&rsquo;t open this paper</div>
              <div class="card-desc">${escapeHtml(result.issues[0]?.message || "Unknown error.")}</div>
            </div>
          </div>
          ${result.issues.length > 1 ? `
            <div class="card-body" style="border-top:1px solid var(--line); background: var(--surface-muted)">
              <ul class="error-details" style="list-style:none; padding:0; margin:0">
                ${result.issues.slice(1).map((i) => `<li>· ${escapeHtml(i.path ? `${i.path}: ` : "")}${escapeHtml(i.message)}</li>`).join("")}
              </ul>
            </div>` : ""}
          <div class="card-foot">
            <button class="btn btn-secondary" data-action="back-home">${icon("arrowLeft", 14)} Back</button>
          </div>
        </div>
      </div>
    `;
    return;
  }
  const paper = result.paper;
  const hash = await paperHash(paper);
  state.loaded = { paper, paperHash: hash };
  const total = paper.sections.reduce((n, s) => n + s.questions.length, 0);
  const totalMarks = total * paper.metadata.scoring.correct;
  out.innerHTML = `
    <div class="container fade-in">
      <div class="card">
        <div class="card-head row" style="align-items:flex-start">
          <span class="icon-circle good">${icon("ok", 14)}</span>
          <div style="flex:1; min-width:0">
            <div class="card-title">${escapeHtml(paper.metadata.title)}</div>
            <div class="card-desc row">
              <span>Grade ${escapeHtml(paper.metadata.grade)}</span>
              <span aria-hidden>·</span>
              <span>${escapeHtml(paper.metadata.subject)}</span>
              <span aria-hidden>·</span>
              <span class="badge badge-spark">${escapeHtml(paper.metadata.standard)}</span>
              <span aria-hidden>·</span>
              <span class="mono subtle" style="font-size:0.75rem">paper ${shortHash(hash)}</span>
            </div>
          </div>
        </div>
        <div class="card-body">
          <dl class="stat-grid">
            <div><dt class="stat-label">Duration</dt><dd class="stat-value">${paper.metadata.durationMinutes} min</dd></div>
            <div><dt class="stat-label">Questions</dt><dd class="stat-value">${total}</dd></div>
            <div><dt class="stat-label">Total marks</dt><dd class="stat-value">${totalMarks}</dd></div>
            <div>
              <dt class="stat-label">Scoring</dt>
              <dd class="stat-value">+${paper.metadata.scoring.correct} / ${paper.metadata.scoring.wrong} / ${paper.metadata.scoring.unattempted}</dd>
              <dd class="stat-hint">correct / wrong / unattempted</dd>
            </div>
          </dl>
          <hr style="border:0; border-top:1px solid var(--line); margin:1.25rem 0" />
          <h3 style="font-size:0.875rem">Sections</h3>
          <ul class="section-list" style="list-style:none; padding:0; margin:0.5rem 0 0">
            ${paper.sections.map((s) => `<li><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${escapeHtml(s.title)}</span><span class="muted">${s.questions.length} ${s.questions.length === 1 ? "question" : "questions"}</span></li>`).join("")}
          </ul>
        </div>
        <div class="card-foot">
          <button class="btn btn-secondary" data-action="back-home">${icon("arrowLeft", 14)} Back</button>
          <button class="btn" data-action="start-exam">Start exam ${icon("arrowRight")}</button>
        </div>
      </div>
    </div>
  `;
}

ACTIONS["back-home"] = () => { location.hash = "#/"; };
ACTIONS["start-exam"] = () => { location.hash = "#/exam"; };

// ── Exam ─────────────────────────────────────────────────────────────────────

let examTimerId = null;
let examUnloadGuard = null;

function flatten(paper) {
  const flat = [];
  let g = 0;
  paper.sections.forEach((sec, sIdx) => {
    sec.questions.forEach((q, qIdx) => {
      flat.push({ globalIndex: g++, sectionIndex: sIdx, sectionId: sec.id, sectionTitle: sec.title, questionIndex: qIdx, question: q });
    });
  });
  return flat;
}

function ensureExamState() {
  if (state.exam) return state.exam;
  if (!state.loaded) return null;
  const { paper, paperHash: hash } = state.loaded;
  const flat = flatten(paper);
  const restored = readSession();
  const matches = restored && restored.paperHash === hash;

  const startedAt = matches ? restored.startedAt : new Date().toISOString();
  const duration = paper.metadata.durationMinutes * 60;
  const elapsed = matches ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0;
  const remainingSeconds = Math.max(0, duration - elapsed);

  const answers = matches ? { ...restored.answers } : {};
  flat.forEach((fq) => { if (!(fq.question.id in answers)) answers[fq.question.id] = null; });

  const secondsPerSection = matches ? { ...restored.secondsPerSection } : {};
  paper.sections.forEach((s) => { if (secondsPerSection[s.id] == null) secondsPerSection[s.id] = 0; });

  const marksForReview = matches ? { ...(restored.marksForReview ?? {}) } : {};

  state.exam = {
    paper, paperHash: hash, flat, startedAt,
    durationSeconds: duration, remainingSeconds,
    currentIndex: matches ? (restored.currentIndex ?? 0) : 0,
    answers, secondsPerSection, marksForReview,
    firedAlerts: { a15: remainingSeconds < ALERT_15, a5: remainingSeconds < ALERT_5, aEnd: remainingSeconds < ALERT_END },
    submitted: false,
    showReview: false,
  };
  persistExam();
  return state.exam;
}

function persistExam() {
  const e = state.exam;
  if (!e || e.submitted) return;
  writeSession({
    paper: e.paper, paperHash: e.paperHash,
    studentName: readStudentName(),
    startedAt: e.startedAt,
    remainingSeconds: e.remainingSeconds,
    currentIndex: e.currentIndex,
    answers: e.answers,
    secondsPerSection: e.secondsPerSection,
    marksForReview: e.marksForReview,
  });
}

function startExamTimer() {
  if (examTimerId) clearInterval(examTimerId);
  examTimerId = setInterval(() => {
    const e = state.exam;
    if (!e || e.submitted) return;
    e.remainingSeconds = Math.max(0, e.remainingSeconds - 1);
    const sid = e.flat[e.currentIndex]?.sectionId;
    if (sid) e.secondsPerSection[sid] = (e.secondsPerSection[sid] ?? 0) + 1;
    updateTimerDom();
    if (!e.firedAlerts.a15 && e.durationSeconds >= ALERT_15 && e.remainingSeconds <= ALERT_15) {
      e.firedAlerts.a15 = true; toast("15 minutes left", { description: "Pace yourself." });
    }
    if (!e.firedAlerts.a5 && e.durationSeconds >= ALERT_5 && e.remainingSeconds <= ALERT_5) {
      e.firedAlerts.a5 = true; toast("5 minutes left", { tone: "warn", description: "Finish strong." });
    }
    if (!e.firedAlerts.aEnd && e.remainingSeconds <= ALERT_END) e.firedAlerts.aEnd = true;
    if (e.remainingSeconds % 5 === 0) persistExam();
    if (e.remainingSeconds <= 0) submitExam();
  }, 1000);
}

function stopExamTimer() {
  if (examTimerId) { clearInterval(examTimerId); examTimerId = null; }
}

function updateTimerDom() {
  const e = state.exam;
  if (!e) return;
  const t = document.getElementById("exam-timer");
  if (t) {
    t.textContent = formatTime(e.remainingSeconds);
    t.parentElement.className = `timer ${e.remainingSeconds <= ALERT_END ? "urgent" : e.remainingSeconds <= 60 ? "warn" : ""}`;
  }
  const overlay = document.getElementById("countdown-overlay");
  if (e.remainingSeconds <= ALERT_END && e.remainingSeconds > 0) {
    if (!overlay) {
      const div = document.createElement("div");
      div.id = "countdown-overlay";
      div.className = "countdown-overlay";
      document.body.appendChild(div);
    }
    document.getElementById("countdown-overlay").textContent = String(e.remainingSeconds);
  } else if (overlay) {
    overlay.remove();
  }
}

function renderExam(out) {
  const e = ensureExamState();
  if (!e) { location.hash = "#/"; return; }

  startExamTimer();
  if (!examUnloadGuard) {
    examUnloadGuard = (ev) => { ev.preventDefault(); ev.returnValue = "Your exam is still in progress."; return ev.returnValue; };
    window.addEventListener("beforeunload", examUnloadGuard);
  }

  const fq = e.flat[e.currentIndex];
  const selected = e.answers[fq.question.id];
  const marked = !!e.marksForReview[fq.question.id];
  const isLast = e.currentIndex === e.flat.length - 1;
  const answeredCount = e.flat.filter((x) => e.answers[x.question.id]).length;
  const meta = e.paper.metadata;

  out.innerHTML = `
    <div class="container">
      <div class="exam-top">
        <div class="exam-top-meta">
          <div class="exam-top-eyebrow">
            <span>Grade ${escapeHtml(meta.grade)}</span>
            <span aria-hidden>·</span>
            <span>${escapeHtml(meta.subject)}</span>
            <span aria-hidden>·</span>
            <span>${escapeHtml(meta.standard)}</span>
          </div>
          <div class="exam-top-section">${escapeHtml(fq.sectionTitle)}</div>
        </div>
        <span class="timer ${e.remainingSeconds <= ALERT_END ? "urgent" : e.remainingSeconds <= 60 ? "warn" : ""}">
          ${icon("clock", 14)}<span id="exam-timer">${formatTime(e.remainingSeconds)}</span>
        </span>
        <button class="btn btn-secondary btn-sm" data-action="open-review">${icon("send", 14)} Submit</button>
      </div>

      <div class="exam-grid">
        <div class="card exam-card">
          <div class="exam-card-body">
            <div class="q-head">
              <span class="q-num tabnums">Question ${e.currentIndex + 1}<span class="muted"> / ${e.flat.length}</span></span>
              ${marked ? `<span class="badge badge-spark">${icon("bookmark", 11)} Marked for review</span>` : ""}
            </div>
            <div class="q-text rt">${renderRich(fq.question.text)}</div>
            <fieldset class="q-options">
              <legend class="sr-only">Options</legend>
              <ul class="options">
                ${fq.question.options.map((opt) => `
                  <li><label class="option ${selected === opt.id ? "selected" : ""}">
                    <input type="radio" name="${escapeHtml(fq.question.id)}" value="${opt.id}" ${selected === opt.id ? "checked" : ""} data-change="select-option" />
                    <span class="letter">${OPTION_LETTER[opt.id]}</span>
                    <span class="opt-text rt">${renderRich(opt.text)}</span>
                  </label></li>
                `).join("")}
              </ul>
            </fieldset>
          </div>
          <div class="exam-actions">
            <div class="group">
              <button class="btn btn-secondary btn-sm" data-action="prev" ${e.currentIndex === 0 ? "disabled" : ""}>${icon("arrowLeft", 14)} Previous</button>
              <button class="btn btn-ghost btn-sm" data-action="clear" ${selected ? "" : "disabled"}>${icon("eraser", 14)} Clear</button>
              <button class="btn btn-sm ${marked ? "btn-soft" : "btn-ghost"}" data-action="toggle-mark" aria-pressed="${marked}">${icon("bookmark", 14)} ${marked ? "Marked" : "Mark for review"}</button>
            </div>
            <div class="group">
              <button class="btn btn-sm" data-action="next">${isLast ? "Review &amp; submit" : "Next"} ${icon("arrowRight", 14)}</button>
              <button class="btn btn-secondary btn-sm btn-mobile-palette" data-action="open-palette">${icon("grid", 14)} Palette</button>
            </div>
          </div>
        </div>

        <div class="card palette-card-desktop">
          ${renderPalette(e)}
        </div>
      </div>

      ${state.paletteOpen ? `
        <div class="drawer-scrim" data-action="close-palette"></div>
        <div class="drawer">
          <div class="drawer-head">
            <span class="brand">${brandWord()}</span>
            <button class="btn btn-ghost btn-sm" data-action="close-palette" aria-label="Close palette">${icon("x", 14)}</button>
          </div>
          <div class="drawer-body">${renderPalette(e)}</div>
        </div>
      ` : ""}

      ${e.showReview ? renderReviewDialog(e, answeredCount) : ""}
    </div>
  `;
  updateTimerDom();
}

function renderPalette(e) {
  const groups = [];
  e.flat.forEach((fq) => {
    const last = groups[groups.length - 1];
    if (last && last.sectionId === fq.sectionId) last.items.push(fq);
    else groups.push({ sectionId: fq.sectionId, title: fq.sectionTitle, items: [fq] });
  });
  const answered = e.flat.filter((x) => e.answers[x.question.id]).length;
  const reviewCount = Object.values(e.marksForReview ?? {}).filter(Boolean).length;
  return `
    <div class="palette">
      <div class="palette-head">
        <h3>Questions</h3>
        <span class="muted tabnums" style="font-size:0.75rem">
          ${answered} / ${e.flat.length} answered${reviewCount ? ` · <span class="palette-review-count">${reviewCount} flagged</span>` : ""}
        </span>
      </div>
      <div class="palette-body">
        ${groups.map((g) => `
          <div class="palette-section">
            <div class="palette-title">${escapeHtml(g.title)}</div>
            <div class="palette-grid">
              ${g.items.map((fq) => {
                const cur = fq.globalIndex === e.currentIndex;
                const ans = !!e.answers[fq.question.id];
                const mark = !!e.marksForReview[fq.question.id];
                const cls = cur ? "current" : mark ? "review" : ans ? "answered" : "";
                return `<button class="palette-cell ${cls}" data-action="jump" data-i="${fq.globalIndex}" ${cur ? 'aria-current="true"' : ""} ${mark ? 'aria-label="flagged for review"' : ""}>${fq.globalIndex + 1}${mark ? '<span class="cell-flag" aria-hidden></span>' : ""}</button>`;
              }).join("")}
            </div>
          </div>
        `).join("")}
      </div>
      <div class="palette-foot">
        <span><span class="palette-legend-dot current"></span>Current</span>
        <span><span class="palette-legend-dot answered"></span>Answered</span>
        <span><span class="palette-legend-dot flagged"></span>Flagged</span>
        <span><span class="palette-legend-dot unanswered"></span>Unanswered</span>
      </div>
    </div>
  `;
}

function renderReviewDialog(e, answered) {
  const total = e.flat.length;
  const skipped = total - answered;
  // Note: no `open` attribute — paint() promotes this to a centered modal
  // by calling .showModal() after the DOM is in place.
  return `
    <dialog id="review-dialog">
      <div class="dialog-head">
        <div class="dialog-head-text">
          <div class="dialog-title">Submit your exam?</div>
          <div class="dialog-desc">Once submitted, your answers are final.</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-action="close-review" aria-label="Close">${icon("x", 14)}</button>
      </div>
      <div class="dialog-body">
        <div class="dialog-stats">
          <div class="dialog-stat"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
          <div class="dialog-stat good"><div class="stat-label">Answered</div><div class="stat-value">${answered}</div></div>
          <div class="dialog-stat ${skipped > 0 ? "bad" : ""}"><div class="stat-label">Skipped</div><div class="stat-value">${skipped}</div></div>
        </div>
        <p class="muted" style="font-size:0.875rem; margin-top:1rem">${skipped > 0 ? `You still have <strong style="color:var(--ink)">${skipped}</strong> unanswered ${skipped === 1 ? "question" : "questions"}. You can go back to answer them, or submit as is.` : "All questions answered. Ready when you are."}</p>
      </div>
      <div class="dialog-foot">
        <button class="btn btn-secondary" data-action="close-review">Go back</button>
        <button class="btn" data-action="confirm-submit">Submit exam</button>
      </div>
    </dialog>
  `;
}


CHANGES["select-option"] = (el) => {
  const e = state.exam; if (!e) return;
  const fq = e.flat[e.currentIndex];
  e.answers[fq.question.id] = el.value;
  ding(880);
  persistExam();
  render();
};
ACTIONS["clear"] = () => {
  const e = state.exam; if (!e) return;
  e.answers[e.flat[e.currentIndex].question.id] = null;
  persistExam(); render();
};
ACTIONS["toggle-mark"] = () => {
  const e = state.exam; if (!e) return;
  const id = e.flat[e.currentIndex].question.id;
  if (e.marksForReview[id]) delete e.marksForReview[id];
  else e.marksForReview[id] = true;
  persistExam(); render();
};
ACTIONS["next"] = () => {
  const e = state.exam; if (!e) return;
  if (e.currentIndex >= e.flat.length - 1) { e.showReview = true; render(); return; }
  e.currentIndex += 1; persistExam(); render();
};
ACTIONS["prev"] = () => {
  const e = state.exam; if (!e) return;
  if (e.currentIndex === 0) return;
  e.currentIndex -= 1; persistExam(); render();
};
ACTIONS["jump"] = (el) => {
  const e = state.exam; if (!e) return;
  const i = Number(el.dataset.i);
  if (i >= 0 && i < e.flat.length) { e.currentIndex = i; persistExam(); state.paletteOpen = false; render(); }
};
ACTIONS["open-palette"] = () => { state.paletteOpen = true; render(); };
ACTIONS["close-palette"] = () => { state.paletteOpen = false; render(); };
ACTIONS["open-review"] = () => { if (state.exam) { state.exam.showReview = true; render(); } };
ACTIONS["close-review"] = () => { if (state.exam) { state.exam.showReview = false; render(); } };
ACTIONS["confirm-submit"] = () => submitExam();

function submitExam() {
  const e = state.exam; if (!e || e.submitted) return;
  e.submitted = true;
  stopExamTimer();
  if (examUnloadGuard) { window.removeEventListener("beforeunload", examUnloadGuard); examUnloadGuard = null; }
  const overlay = document.getElementById("countdown-overlay"); if (overlay) overlay.remove();

  const used = e.durationSeconds - e.remainingSeconds;
  const record = scoreAttempt(e.paper, e.paperHash, e.answers, e.secondsPerSection, used);
  try { appendAttempt(record); } catch (err) { console.error(err); toast("Couldn't save attempt.", { tone: "error" }); }
  state.lastResult = record;
  clearSession();
  state.exam = null;
  location.hash = "#/result";
}

function scoreAttempt(paper, hash, answers, secondsPerSection, durationSecondsUsed) {
  const { scoring } = paper.metadata;
  const perSection = [];
  const perQuestion = [];
  let correctCount = 0, wrongCount = 0, unattemptedCount = 0, score = 0;

  for (const sec of paper.sections) {
    let sC = 0, sW = 0, sU = 0, sScore = 0;
    for (const q of sec.questions) {
      const sel = answers[q.id] ?? null;
      const attempted = sel !== null;
      const correct = attempted && sel === q.answer;
      perQuestion.push({ questionId: q.id, sectionId: sec.id, selected: sel, correct: q.answer, isCorrect: correct });
      if (!attempted) { sU++; sScore += scoring.unattempted; }
      else if (correct) { sC++; sScore += scoring.correct; }
      else { sW++; sScore += scoring.wrong; }
    }
    const total = sec.questions.length;
    const possible = total * scoring.correct;
    perSection.push({
      sectionId: sec.id, title: sec.title, totalQuestions: total,
      correctCount: sC, wrongCount: sW, unattemptedCount: sU,
      score: sScore, totalPossible: possible,
      percentage: possible > 0 ? Math.round((sScore / possible) * 1000) / 10 : 0,
      secondsSpent: secondsPerSection[sec.id] ?? 0,
    });
    correctCount += sC; wrongCount += sW; unattemptedCount += sU; score += sScore;
  }
  const totalQuestions = correctCount + wrongCount + unattemptedCount;
  const totalPossible = totalQuestions * scoring.correct;
  return {
    id: uniqueId(),
    paperHash: hash,
    paperTitle: paper.metadata.title,
    subject: paper.metadata.subject,
    grade: paper.metadata.grade,
    standard: paper.metadata.standard,
    topics: paper.metadata.topics,
    totalQuestions, correctCount, wrongCount, unattemptedCount,
    score, totalPossible,
    percentage: totalPossible > 0 ? Math.round((score / totalPossible) * 1000) / 10 : 0,
    durationMinutesAllotted: paper.metadata.durationMinutes,
    durationSecondsUsed,
    attemptedAt: new Date().toISOString(),
    perSection, perQuestion,
  };
}

// Keyboard shortcuts during exam.
window.addEventListener("keydown", (e) => {
  if (state.route !== "/exam" || !state.exam || state.exam.submitted) return;
  // While the submit-confirmation modal is open, the dialog handles its own
  // keys (Esc closes, Tab cycles within). Don't let the exam shortcuts fire.
  if (state.exam.showReview) return;
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const key = e.key;
  if (key === "?" || (e.shiftKey && key === "/")) {
    e.preventDefault();
    toast("Keyboard shortcuts", { description: "← → · Prev / Next  ·  1-4 / a-d · select  ·  Enter · Next  ·  Backspace · clear  ·  M · mark for review  ·  Esc · close" });
    return;
  }
  if (key === "ArrowLeft") { e.preventDefault(); ACTIONS.prev(); }
  else if (key === "ArrowRight" || key === "Enter") { e.preventDefault(); ACTIONS.next(); }
  else if (key === "Backspace" || key === "Delete") { e.preventDefault(); ACTIONS.clear(); }
  else if (key === "m" || key === "M") { e.preventDefault(); ACTIONS["toggle-mark"](); }
  else if (key === "Escape") {
    if (state.exam.showReview) ACTIONS["close-review"]();
    else if (state.paletteOpen) ACTIONS["close-palette"]();
  } else if (/^[1-4]$/.test(key)) {
    e.preventDefault();
    const opt = OPTION_IDS[Number(key) - 1];
    pickOption(opt);
  } else if (/^[a-dA-D]$/.test(key)) {
    e.preventDefault();
    pickOption(key.toLowerCase());
  }
});

function pickOption(optionId) {
  const e = state.exam; if (!e) return;
  const fq = e.flat[e.currentIndex];
  e.answers[fq.question.id] = optionId;
  ding(880);
  persistExam(); render();
}

// ── Result & Review ──────────────────────────────────────────────────────────

function tone(p) { return p >= 75 ? "good" : p >= 50 ? "spark" : "bad"; }
function verdict(p) {
  if (p >= 90) return "Outstanding";
  if (p >= 75) return "Strong";
  if (p >= 50) return "Steady";
  if (p >= 30) return "Keep going";
  return "Tough one — try again";
}

function renderResult(out) {
  const r = state.lastResult;
  const lp = state.loaded;
  if (!r || !lp) { location.hash = "#/"; return; }
  const t = tone(r.percentage);
  const studentName = readStudentName() || "Student";
  out.innerHTML = `
    <div class="container fade-in">
      <div class="card">
        <div class="result-hero">
          <div class="left">
            <div class="verdict">${verdict(r.percentage)}</div>
            <h1 style="margin-top:0.25rem">${escapeHtml(studentName)}, you scored <span class="tabnums">${r.score}</span><span class="muted"> / ${r.totalPossible}</span></h1>
            <p class="muted" style="margin-top:0.5rem; max-width:36rem; font-size:0.875rem">
              ${escapeHtml(lp.paper.metadata.title)} — ${escapeHtml(lp.paper.metadata.subject)}, Grade ${escapeHtml(lp.paper.metadata.grade)}, ${escapeHtml(lp.paper.metadata.standard)}.
              Finished in ${formatDurationLong(r.durationSecondsUsed)} of ${r.durationMinutesAllotted} minutes allotted.
            </p>
            <div class="row" style="margin-top:1.25rem">
              <span class="badge badge-${t}">${r.percentage.toFixed(1)}%</span>
              <span class="badge badge-good">${r.correctCount} correct</span>
              ${r.wrongCount > 0 ? `<span class="badge badge-bad">${r.wrongCount} wrong</span>` : ""}
              ${r.unattemptedCount > 0 ? `<span class="badge badge-muted">${r.unattemptedCount} skipped</span>` : ""}
            </div>
          </div>
          <div class="right">${donutSvg(r.percentage, t)}</div>
        </div>
      </div>

      <div class="row" style="margin:1.25rem 0">
        <button class="btn" data-action="go-cert">${icon("award", 14)} Download certificate</button>
        <button class="btn btn-secondary" data-action="retake">${icon("rotate", 14)} Retake</button>
        <button class="btn btn-ghost" data-action="go-home">${icon("home", 14)} Home</button>
        <span style="flex:1"></span>
        <button class="btn btn-ghost" data-action="go-dashboard">See progress ${icon("arrowRight", 14)}</button>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title">Section-wise breakdown</div>
          <div class="card-desc">Where you’re strong, where to focus.</div>
        </div>
        <div class="card-body">
          ${r.perSection.map((s) => sectionRow(s)).join("")}
        </div>
      </div>

      <div class="card" style="margin-top:1.25rem">
        <div class="card-head">
          <div class="card-title">Review the paper</div>
          <div class="card-desc">Filter to focus on what you got wrong, or look at every question.</div>
        </div>
        <div class="card-body">
          ${renderReview(lp.paper, r)}
        </div>
      </div>
    </div>
  `;
}

function donutSvg(pct, t) {
  const size = 128, stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = t === "good" ? "var(--good)" : t === "spark" ? "var(--spark)" : "var(--bad)";
  return `
    <div class="donut">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}" />
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${dash} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})" />
      </svg>
      <div class="donut-text">${pct.toFixed(0)}<small>%</small></div>
    </div>
  `;
}

function sectionRow(s) {
  const t = tone(s.percentage);
  const color = t === "good" ? "var(--good)" : t === "spark" ? "var(--spark)" : "var(--bad)";
  return `
    <div class="section-row">
      <div class="head">
        <h4 style="font-size:0.875rem; font-weight:600">${escapeHtml(s.title)}</h4>
        <span class="badge badge-${t}">${s.percentage.toFixed(1)}%</span>
      </div>
      <div class="bar"><span style="width:${Math.max(0, Math.min(100, s.percentage))}%; background:${color}"></span></div>
      <div class="stats">
        <div><span class="muted">Correct:</span> <strong class="tabnums">${s.correctCount} / ${s.totalQuestions}</strong></div>
        <div><span class="muted">Wrong:</span> <strong class="tabnums">${s.wrongCount}</strong></div>
        <div><span class="muted">Skipped:</span> <strong class="tabnums">${s.unattemptedCount}</strong></div>
        <div><span class="muted">Time:</span> <strong class="tabnums">${formatDurationLong(s.secondsSpent)}</strong></div>
      </div>
      <div class="muted" style="margin-top:0.4rem; font-size:0.78125rem">
        Score: <strong style="color:var(--ink)">${s.score}</strong> / ${s.totalPossible}
      </div>
    </div>
  `;
}

function renderReview(paper, attempt) {
  const f = state.reviewFilter;
  const sf = state.reviewSection;
  const byId = new Map(attempt.perQuestion.map((p) => [p.questionId, p]));
  const rows = [];
  let counts = { all: 0, wrong: 0, unattempted: 0, correct: 0 };
  paper.sections.forEach((sec) => {
    if (sf !== "all" && sf !== sec.id) return;
    sec.questions.forEach((q) => {
      const res = byId.get(q.id);
      if (!res) return;
      counts.all++;
      if (res.selected === null) counts.unattempted++;
      else if (res.isCorrect) counts.correct++;
      else counts.wrong++;
      const passes =
        f === "all" ||
        (f === "wrong" && !res.isCorrect && res.selected !== null) ||
        (f === "unattempted" && res.selected === null) ||
        (f === "correct" && res.isCorrect);
      if (passes) rows.push({ section: sec, q, res });
    });
  });

  return `
    <div class="review-filters">
      <button class="chip" data-action="set-filter" data-f="all" aria-pressed="${f === "all"}">All <span class="count">${counts.all}</span></button>
      <button class="chip" data-action="set-filter" data-f="wrong" aria-pressed="${f === "wrong"}">Wrong <span class="count">${counts.wrong}</span></button>
      <button class="chip" data-action="set-filter" data-f="unattempted" aria-pressed="${f === "unattempted"}">Skipped <span class="count">${counts.unattempted}</span></button>
      <button class="chip" data-action="set-filter" data-f="correct" aria-pressed="${f === "correct"}">Correct <span class="count">${counts.correct}</span></button>
      <span class="filler"></span>
      <select class="select" data-change="set-section">
        <option value="all">All sections</option>
        ${paper.sections.map((s) => `<option value="${escapeHtml(s.id)}" ${sf === s.id ? "selected" : ""}>${escapeHtml(s.title)}</option>`).join("")}
      </select>
    </div>

    ${rows.length === 0 ? `<p class="empty" style="margin-top:1rem">No questions match this filter.</p>` : `
      <ol style="list-style:none; padding:0; margin:1rem 0 0">
        ${rows.map((row, idx) => reviewItem(row, idx)).join("")}
      </ol>
    `}
  `;
}

function reviewItem({ section, q, res }, idx) {
  const t = res.isCorrect ? "good" : res.selected === null ? "muted" : "bad";
  return `
    <li class="review-item ${t === "good" ? "good" : t === "bad" ? "bad" : ""}">
      <div class="head">
        <span class="num">Q${idx + 1}.</span>
        <span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(section.title)}</span>
        <span class="status ${t}">${icon(t === "good" ? "check" : t === "bad" ? "x" : "x", 12)} ${t === "good" ? "correct" : t === "bad" ? "wrong" : "skipped"}</span>
      </div>
      <div class="q-text rt">${renderRich(q.text)}</div>
      <ul class="options" style="margin-top:0.625rem">
        ${q.options.map((opt) => {
          const isCorrect = opt.id === q.answer;
          const isSelected = opt.id === res.selected;
          return `
            <li><div class="option ${isCorrect ? "correct" : ""} ${!isCorrect && isSelected ? "wrong" : ""}">
              <span class="letter">${OPTION_LETTER[opt.id]}</span>
              <span class="opt-text rt">${renderRich(opt.text)}</span>
              ${isCorrect ? `<span class="pill correct-pill">correct</span>` : isSelected ? `<span class="pill your-pill">your pick</span>` : ""}
            </div></li>`;
        }).join("")}
      </ul>
      ${q.explanation ? `<div class="explain"><div class="explain-label">Explanation</div><div class="rt">${renderRich(q.explanation)}</div></div>` : ""}
    </li>
  `;
}

ACTIONS["set-filter"] = (el) => { state.reviewFilter = el.dataset.f; render(); };
CHANGES["set-section"] = (el) => { state.reviewSection = el.value; render(); };
ACTIONS["go-cert"] = () => { location.hash = "#/certificate"; };
ACTIONS["retake"] = () => { state.lastResult = null; state.exam = null; clearSession(); location.hash = "#/exam"; };
ACTIONS["go-home"] = () => { state.lastResult = null; state.exam = null; clearSession(); location.hash = "#/"; };
ACTIONS["go-dashboard"] = () => { location.hash = "#/dashboard"; };

// ── Certificate ──────────────────────────────────────────────────────────────

function renderCertificate(out) {
  const r = state.lastResult;
  const lp = state.loaded;
  if (!r || !lp) { location.hash = "#/"; return; }
  const studentName = readStudentName() || "Student";
  out.innerHTML = `
    <div class="cert-shell">
      <div class="container cert-actions">
        <button class="btn btn-ghost" data-action="back-result">${icon("arrowLeft", 14)} Back to result</button>
        <button class="btn" data-action="print">${icon("printer", 14)} Print / Save as PDF</button>
      </div>
      <article class="cert" aria-label="Certificate">
        <div class="cert-ribbon"></div>
        <div class="cert-inner">
          <div class="cert-row">
            <span class="brand">
              <img src="icon.svg" alt="" class="cert-icon" aria-hidden="true" />
              ${brandWord()}
            </span>
            <div class="cert-tag">Certificate of attempt<span class="h">paper ${shortHash(lp.paperHash)}</span></div>
          </div>
          <div class="cert-eyebrow">This is to recognise</div>
          <div class="cert-name">${escapeHtml(studentName)}</div>
          <p class="cert-body">
            for attempting <strong style="color:var(--ink)">${escapeHtml(lp.paper.metadata.title)}</strong> —
            ${escapeHtml(lp.paper.metadata.subject)}, Grade ${escapeHtml(lp.paper.metadata.grade)}, ${escapeHtml(lp.paper.metadata.standard)} standard.
          </p>
          <div style="text-align:center">
            <span class="cert-score">
              <span class="pct">${r.percentage.toFixed(0)}<sup>%</sup></span>
              <span class="muted">· ${r.score} / ${r.totalPossible}</span>
            </span>
          </div>
          <dl class="cert-meta">
            <div><dt>Correct</dt><dd>${r.correctCount} / ${r.totalQuestions}</dd></div>
            <div><dt>Time taken</dt><dd>${formatDurationLong(r.durationSecondsUsed)}</dd></div>
            <div><dt>Sections</dt><dd>${r.perSection.length}</dd></div>
            <div><dt>Awarded</dt><dd>${formatDate(r.attemptedAt)}</dd></div>
          </dl>
          <div class="cert-foot">
            <div><strong>examso</strong> · Exam? So?</div>
            <div class="mono subtle" style="font-size:0.6875rem">attempt ${r.id.slice(0, 8)}</div>
          </div>
        </div>
      </article>
    </div>
  `;
}

ACTIONS["back-result"] = () => { location.hash = "#/result"; };
ACTIONS["print"] = () => window.print();

// ── Dashboard ────────────────────────────────────────────────────────────────

function renderDashboard(out) {
  const history = readHistory();
  if (history.length === 0) {
    out.innerHTML = `
      <div class="container">
        <div class="card"><div class="card-body empty">
          <h2>No attempts yet</h2>
          <p style="margin-top:0.5rem">Finish a paper and your progress will land here.</p>
          <button class="btn" data-action="back-home" style="margin-top:1.25rem">Start a paper</button>
        </div></div>
      </div>
    `;
    return;
  }

  const f = state.dashboard;
  const filtered = history.filter((a) =>
    (f.subject === "all" || a.subject === f.subject) &&
    (f.grade === "all" || a.grade === f.grade) &&
    (f.standard === "all" || a.standard === f.standard),
  );
  const distinct = {
    subjects: [...new Set(history.map((a) => a.subject))].sort(),
    grades: [...new Set(history.map((a) => a.grade))].sort(),
    standards: [...new Set(history.map((a) => a.standard))].sort(),
  };
  const overTime = [...filtered].sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));
  const perSubject = groupAvg(filtered, (a) => a.subject);
  const perStandard = groupAvg(filtered, (a) => a.standard);

  out.innerHTML = `
    <div class="container">
      <div class="row" style="margin-bottom:1rem; align-items:center">
        <button class="btn btn-ghost btn-sm" data-action="back-home">${icon("arrowLeft", 14)} Home</button>
        <h1 style="margin-left:0.25rem">Your progress</h1>
      </div>

      <div class="card">
        <div class="card-body dash-actions">
          ${dashFilter("Subject", "subject", f.subject, distinct.subjects)}
          ${dashFilter("Grade", "grade", f.grade, distinct.grades)}
          ${dashFilter("Standard", "standard", f.standard, distinct.standards)}
          <span class="muted" style="margin-left:auto; font-size:0.75rem">${filtered.length} of ${history.length} attempts</span>
        </div>
      </div>

      <div class="dash-charts">
        <div class="card">
          <div class="card-head">
            <div class="card-title">Score over time</div>
            <div class="card-desc">Percentage per attempt, oldest to newest.</div>
          </div>
          <div class="card-body">${lineChartSvg(overTime)}</div>
        </div>
        <div class="card">
          <div class="card-head">
            <div class="card-title">Averages</div>
            <div class="card-desc">By subject, then by standard.</div>
          </div>
          <div class="card-body">
            <p class="muted" style="font-size:0.6875rem; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:0.4rem">By subject</p>
            ${barChartSvg(perSubject)}
            <p class="muted" style="font-size:0.6875rem; text-transform:uppercase; letter-spacing:0.06em; margin:1rem 0 0.4rem">By standard</p>
            ${barChartSvg(perStandard)}
          </div>
        </div>
      </div>

      <div class="card attempts-table" style="margin-top:1.25rem">
        <div class="card-head">
          <div class="card-title">Attempts</div>
          <div class="card-desc">Click a row to see the section-wise breakdown for that attempt.</div>
        </div>
        <div class="row-h"><span>Paper</span><span>Subject · Grade</span><span>Standard</span><span>When</span><span style="text-align:right">Score</span></div>
        <ul style="list-style:none; padding:0; margin:0">
          ${filtered.map((a) => attemptRow(a)).join("")}
        </ul>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:1.25rem">
        <button class="btn btn-ghost btn-sm" data-action="clear-history">${icon("trash", 14)} Clear all history</button>
      </div>
    </div>
  `;
}

function dashFilter(label, key, value, options) {
  return `
    <div class="field">
      <label class="field-label">${label}</label>
      <select class="select" style="width:10rem" data-change="dash-${key}">
        <option value="all">All</option>
        ${options.map((o) => `<option ${value === o ? "selected" : ""} value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("")}
      </select>
    </div>
  `;
}

function attemptRow(a) {
  const open = state.dashboard.expanded === a.id;
  return `
    <li>
      <button class="row-cell" data-action="toggle-attempt" data-id="${escapeHtml(a.id)}">
        ${icon(open ? "chevronDown" : "chevronRight", 14)}
        <span class="col-paper">${escapeHtml(a.paperTitle)}<span class="h">${shortHash(a.paperHash)}</span></span>
        <span class="col-meta">${escapeHtml(a.subject)} · ${escapeHtml(a.grade)}</span>
        <span class="col-std"><span class="badge badge-muted">${escapeHtml(a.standard)}</span></span>
        <span class="col-when">${formatDateTime(a.attemptedAt)}</span>
        <span class="col-score">
          <span class="pct">${a.percentage.toFixed(1)}%</span>
          <span class="raw">${a.score} / ${a.totalPossible}</span>
        </span>
      </button>
      ${open ? `
        <div class="attempt-expanded">
          <div class="muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.06em">Section-wise</div>
          <ul>
            ${a.perSection.map((s) => `
              <li>
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.title)}</span>
                <span class="nums">
                  <span><strong class="tabnums">${s.score}</strong> / ${s.totalPossible}</span>
                  <span class="tabnums">${s.percentage.toFixed(1)}%</span>
                  <span class="tabnums">${formatDurationLong(s.secondsSpent)}</span>
                </span>
              </li>
            `).join("")}
          </ul>
        </div>` : ""}
    </li>
  `;
}

function groupAvg(list, keyFn) {
  const m = new Map();
  for (const a of list) {
    const k = keyFn(a);
    const cur = m.get(k) || { sum: 0, n: 0 };
    cur.sum += a.percentage; cur.n += 1; m.set(k, cur);
  }
  return [...m.entries()]
    .map(([label, { sum, n }]) => ({ label, value: Math.round((sum / n) * 10) / 10 }))
    .sort((a, b) => b.value - a.value);
}

function lineChartSvg(rows) {
  if (rows.length === 0) return `<p class="empty">No data yet.</p>`;
  const w = 720, h = 200, pad = { l: 36, r: 12, t: 8, b: 24 };
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const xs = rows.map((_, i) => pad.l + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW));
  const ys = rows.map((r) => pad.t + innerH - (r.percentage / 100) * innerH);
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const grid = [0, 25, 50, 75, 100].map((p) => {
    const y = pad.t + innerH - (p / 100) * innerH;
    return `<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="var(--line)"></line>
            <text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="var(--ink-subtle)">${p}%</text>`;
  }).join("");
  return `
    <svg class="svg-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Score over time">
      ${grid}
      <polyline fill="none" stroke="var(--ink)" stroke-width="2" points="${points}"></polyline>
      ${xs.map((x, i) => `<circle cx="${x}" cy="${ys[i]}" r="3" fill="var(--ink)"><title>${rows[i].percentage}% · ${formatDateTime(rows[i].attemptedAt)}</title></circle>`).join("")}
    </svg>
  `;
}

function barChartSvg(rows) {
  if (rows.length === 0) return `<p class="empty">No data yet.</p>`;
  const labelW = 100;
  const w = 480, rowH = 26, gap = 6, pad = { l: labelW, r: 36, t: 4, b: 4 };
  const h = pad.t + pad.b + rows.length * rowH;
  const innerW = w - pad.l - pad.r;
  return `
    <svg class="svg-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">
      ${rows.map((r, i) => {
        const y = pad.t + i * rowH;
        const barW = (r.value / 100) * innerW;
        return `
          <text x="${labelW - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${escapeHtml(r.label)}</text>
          <rect x="${pad.l}" y="${y + 4}" width="${innerW}" height="${rowH - 8 - gap}" rx="2" fill="var(--surface-subtle)"></rect>
          <rect x="${pad.l}" y="${y + 4}" width="${Math.max(2, barW)}" height="${rowH - 8 - gap}" rx="2" fill="var(--ink)"></rect>
          <text x="${pad.l + barW + 6}" y="${y + 14}" font-size="11" fill="var(--ink-muted)" font-variant-numeric="tabular-nums">${r.value.toFixed(1)}%</text>
        `;
      }).join("")}
    </svg>
  `;
}

CHANGES["dash-subject"] = (el) => { state.dashboard.subject = el.value; render(); };
CHANGES["dash-grade"] = (el) => { state.dashboard.grade = el.value; render(); };
CHANGES["dash-standard"] = (el) => { state.dashboard.standard = el.value; render(); };
ACTIONS["toggle-attempt"] = (el) => {
  const id = el.dataset.id;
  state.dashboard.expanded = state.dashboard.expanded === id ? null : id;
  render();
};
ACTIONS["clear-history"] = () => {
  if (window.confirm("Delete all attempts? This can't be undone.")) {
    clearHistory();
    state.dashboard.expanded = null;
    render();
    toast("History cleared.", { tone: "success" });
  }
};

// §12 ───────────────────────────────────────────────────────────────────────

// Drag & drop on the home JSON area.
document.addEventListener("dragover", (e) => {
  const drop = e.target.closest("#json-drop");
  if (!drop) return;
  e.preventDefault();
  drop.classList.add("dragover");
});
document.addEventListener("dragleave", (e) => {
  const drop = e.target.closest("#json-drop");
  if (drop) drop.classList.remove("dragover");
});
document.addEventListener("drop", (e) => {
  const drop = e.target.closest("#json-drop");
  if (!drop) return;
  e.preventDefault();
  drop.classList.remove("dragover");
  const f = e.dataTransfer.files?.[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast("File too large.", { tone: "error" }); return; }
  f.text().then((text) => {
    state.jsonText = text;
    document.getElementById("json-input").value = text;
    toast(`Loaded ${f.name}`, { tone: "success" });
    render();
  });
});

if (!location.hash) location.hash = "#/";
render();
