// Edit freely — no build step. {{placeholders}} are substituted by
// buildPrompt() in app.js using the values currently in the home form.

window.PROMPT_TEMPLATE = `You are an experienced school examiner.

Generate an MCQ question paper as a single valid JSON object that conforms exactly to the schema below. Wrap the JSON in a fenced code block (\`\`\`json … \`\`\`) so that no chat-UI autocorrect alters quotes or escapes.

Inputs:
- Grade: {{grade}}
- Subject: {{subject}}
- Topics: {{topics}}
- Standard: {{standard}}              // Easy | Medium | Hard | Olympiad | IIT
- Duration: {{durationMinutes}} minutes
- Sections: [{{sectionsList}}]
- Questions per section: {{questionsPerSection}}
- Scoring: correct={{correctMarks}}, wrong={{wrongMarks}}, unattempted={{unattemptedMarks}}

Rules:
- Single-correct MCQ only. Exactly 4 options per question. Option ids must be "a","b","c","d" (lowercase).
- Total questions across all sections must be at most {{questionCap}}.
- Provide a brief "explanation" for each correct answer (shown to the student during post-submit review).
- Difficulty must match the requested Standard.
- All ids must be unique within their scope.

Rich content in question / option / explanation / instructions:
- Plain text. Newlines render as line breaks. No Markdown.
- Math: LaTeX between $…$ (inline) or $$…$$ (displayed). KaTeX renders it. The mhchem extension is loaded for chemistry.
    Maths      $\\frac{5}{x}$, $\\sqrt{2}$, $x^{2}$, $\\binom{n}{r}$, $\\int_{0}^{1} x^{2}\\,dx$, $$\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}$$
    Physics    $F = ma$, $E = mc^{2}$, $\\vec{F}$, $\\lambda$, $\\frac{dv}{dt}$, units in plain $\\text{m/s}^{2}$
    Chemistry  $\\ce{H2SO4}$, $\\ce{Cl-}$, $\\ce{H2 + O2 -> H2O}$, $\\Delta H$, $$\\ce{N2 + 3H2 <=> 2NH3}$$
    Biology    $\\chi^{2}$, $\\bar{x}$, $\\sigma$, ratios as $\\frac{p}{q}$
    Logic      $\\forall x$, $\\exists y$, $A \\cup B$, $A \\subset B$
- For a literal dollar sign in prose (currency), write \\$ — the renderer keeps the sign and drops the backslash, e.g. "Pay \\$5" displays as "Pay $5".
- Diagrams: standalone inline <svg viewBox="…" width="…" height="…">…</svg>. Use for geometry, circuits, free-body diagrams, organic skeletons, cell structures.
- Tables: standard HTML <table>/<thead>/<tbody>/<tr>/<th>/<td>.
- Allowed light HTML: <strong>, <em>, <code>, <ul>/<ol>/<li>, <br>, <p>, <span>.
- Inline images allowed only via data: URLs. No external URLs.
- <script>, event handlers, links, inline styles are stripped.

Worked example (study the escaping closely):

\`\`\`json
{
  "schemaVersion": 1,
  "metadata": {
    "title": "Sample · Grade 8 · Maths · Easy",
    "grade": "8",
    "subject": "Mathematics",
    "topics": ["Algebra"],
    "standard": "Easy",
    "durationMinutes": 5,
    "scoring": { "correct": 4, "wrong": -1, "unattempted": 0 },
    "instructions": "Choose the single correct option."
  },
  "sections": [
    {
      "id": "A",
      "title": "Section A — Warm-up",
      "instructions": "",
      "questions": [
        {
          "id": "q1",
          "text": "Simplify $\\\\frac{6x^{2}}{2x}$ for $x \\\\neq 0$.",
          "options": [
            { "id": "a", "text": "$3x$" },
            { "id": "b", "text": "$3x^{2}$" },
            { "id": "c", "text": "$\\\\frac{3}{x}$" },
            { "id": "d", "text": "$6x$" }
          ],
          "answer": "a",
          "explanation": "Cancel the common factor $2x$: $\\\\frac{6x^{2}}{2x} = 3x$."
        }
      ]
    }
  ]
}
\`\`\`

Notice in the example above how every LaTeX backslash is written as **two** backslashes inside the JSON string. \`\\\\frac\` in JSON produces \`\\frac\` after parsing, which is what KaTeX needs.

Before sending your reply, mentally check:
- Are all quotes straight ASCII " (U+0022) — no curly “smart” quotes anywhere?
- Is every \\ doubled? \\frac → \\\\frac. \\\\ (LaTeX line break) → \\\\\\\\ in JSON.
- Does the JSON start with { and end with } inside the \`\`\`json fence?
- No prose, no commentary outside the fence.

Schema (v1):
{ "schemaVersion": 1,
  "metadata": { "title": string, "grade": string, "subject": string, "topics": string[], "standard": string, "durationMinutes": number, "scoring": { "correct": number, "wrong": number, "unattempted": number }, "instructions": string },
  "sections": [ { "id": string, "title": string, "instructions": string, "questions": [ { "id": string, "text": string, "options": [ { "id": "a"|"b"|"c"|"d", "text": string }, ...4 ], "answer": "a"|"b"|"c"|"d", "explanation": string } ] } ] }
`;
