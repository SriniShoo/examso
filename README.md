# examso

> **Exam? So?**

A purely client-side MCQ practice web app, installable as a PWA on any
device. Bring your own paper: ask any LLM (ChatGPT, Claude, Gemini) for a
JSON-shaped MCQ paper using the prompt the app gives you, paste it back,
take the exam, see your score, review every question, download a
certificate.

No accounts, no servers, no telemetry. Progress lives in your browser.

The frontend lives in [`frontend/`](frontend/) — see
[`frontend/README.md`](frontend/README.md) for files, design notes, and
the rich-content rules.

## Run locally

```bash
python3 -m http.server 5173 --directory frontend
# → http://localhost:5173
```

Or just double-click `frontend/index.html` — it works from `file://` too.

## Deploy

Push to `main`. The workflow at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) copies the
seven static files in `frontend/` to GitHub Pages.
