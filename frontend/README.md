# examso

> **Exam? So?**

A purely client-side MCQ practice web app — installable as a PWA on any
device. **No build step.** Bring your own paper: ask any LLM (ChatGPT,
Claude, Gemini) for a JSON-shaped MCQ paper using the prompt the app
gives you, paste it back, take the exam, see your score, review every
question, download a certificate.

No accounts, no servers, no telemetry. Progress lives in your browser.

The only external dependency is **KaTeX** (loaded from jsdelivr with a
subresource-integrity hash) so LaTeX math like `$\frac{a}{b}$` renders
crisply. KaTeX is fetched once on first load and cached by the browser
thereafter; the rest of the app works offline indefinitely.

## Files

```
.
├─ frontend/
│  ├─ index.html             shell + PWA meta + service-worker registration
│  ├─ styles.css             tokens + components + page styles
│  ├─ app.js                 all logic + UI, sectioned (1 file)
│  ├─ prompt.template.js     the LLM prompt — edit freely without touching app.js
│  ├─ manifest.webmanifest   PWA manifest (name, icon, display: standalone)
│  ├─ sw.js                  service worker — offline-first, cache-first
│  └─ icon.svg               app icon (browser tab + home screen + maskable)
└─ .github/workflows/deploy.yml   GitHub Pages deploy
```

## Install on any device

The app is a PWA — installable from the browser's address bar (desktop) or
"Add to Home Screen" share sheet (mobile). Works on iOS, Android, Windows,
macOS, Linux. Once installed, it launches like a native app, runs offline
after the first load, and updates automatically when a new `sw.js`
`VERSION` is shipped.

`app.js` is structured into 11 numbered, commented sections — search for
`// §5`, `// §11`, etc. to jump.

The prompt the student copies into ChatGPT/Claude/Gemini lives in its own
file, `prompt.template.js`, with `{{placeholder}}` markers that `app.js`
substitutes at render time. To tune the prompt, just edit that file.

## Run it

```bash
# Tiny static server (recommended; works for everyone)
python3 -m http.server 5173 --directory frontend
# → http://localhost:5173

# Or just double-click — works in most browsers (file://)
open frontend/index.html
```

There is no build step. Edit `app.js` / `styles.css` / `prompt.template.js`
and refresh. First page load needs internet so the browser can fetch
KaTeX from jsdelivr; afterwards it's cached and works offline.

## Rich content in papers

Question text, options, and explanations support a tightly-scoped subset:

- **Plain text** with newlines (rendered as line breaks).
- **LaTeX math** delimited by `$ … $` (inline) or `$$ … $$` (displayed),
  rendered by KaTeX. Works across subjects:
  - **Maths:** `$\frac{a}{b}$`, `$\sqrt{2}$`, `$\binom{n}{r}$`, `$\int_0^1 x^2\,dx$`
  - **Physics:** `$F = ma$`, `$\vec{F}$`, `$E = mc^{2}$`, `$\frac{dv}{dt}$`
  - **Chemistry** (via the bundled `mhchem` extension):
    `$\ce{H2SO4}$`, `$\ce{Cl-}$`, `$\ce{H2 + O2 -> H2O}$`,
    `$$\ce{N2 + 3H2 <=> 2NH3}$$`
  - **Biology / stats:** `$\chi^{2}$`, `$\bar{x}$`, `$\sigma$`
- **Inline SVG** for diagrams (geometry, angles, circuits, free-body
  figures, organic skeletons, cell structures).
- **HTML tables** (`<table>` / `<thead>` / `<tbody>` / `<tr>` / `<th>` /
  `<td>`) for data-table questions.
- **Native MathML** as a fallback (`<math>…</math>`) — accepted but
  LaTeX is preferred.
- A small allow-list of inline tags: `<strong>`, `<em>`, `<code>`,
  `<ul>`/`<ol>`/`<li>`, `<br>`, `<p>`, `<span>`.

The pipeline:

1. Stash `$…$` and `$$…$$` segments behind opaque placeholders.
2. Sanitise everything else through an in-house ~80-line allow-list
   walker (strips `<script>`, event handlers, external `http(s):` URLs,
   anything outside the allow-list).
3. Render the stashes through KaTeX. Output is trusted (well-known
   library output) and is substituted in *after* sanitisation, so KaTeX
   never goes through the sanitiser.

## Deploy

Push to `main`. The workflow at `.github/workflows/deploy.yml` copies the
seven static files to GitHub Pages. Hash routing (`#/exam`, `#/result`, …)
means deep links work without a 404 redirect trick.

## Standards

KISS / DRY / YAGNI. Boring tech wins. Dependency discipline (one CDN
library, one SRI-hashed entry, no `node_modules`). Mobile first.
Keyboard accessible. Only `console.error` in committed code.
