# Dossier

Topic-scoped research capture for the browser. You name subjects you care about, write a short prompt for what belongs, pick sites, and Dossier files pages the model accepts. The same dossier — even while it is still thin — can ground a short reply on a live thread.

Pages stay on your machine. The only network the service makes is to the LLM you configure (default: Ollama on localhost). It never sends on your behalf.

Chromium only (Chrome, Brave, Edge, Chromium). Firefox is out of scope for v0.1.

## How it works

```
Browser extension  →  dossierd (127.0.0.1)
                         ├─ ~/.config/dossier/config.toml
                         ├─ ~/.local/share/dossier/  (token, SQLite, dossier.log)
                         └─ Ollama (optional; required to accept pages and draft replies)
```

One workflow: write a prompt for a topic, then add or remove sites from the side panel. Nothing is captured until the topic has a prompt, and nothing is captured from a site that isn't on that topic's list.

* **Policy** — one textarea. Edits apply immediately. Watched pages are queued; the model files or rejects them against this prompt.
* **Sites** — in the topics list, **Add site** puts the page you're on onto that topic. The same host can be typed on the topic's **Sites** tab, or toggled with the hotkey (`chrome://extensions/shortcuts`, default `Ctrl+Shift+D` / `⌘⇧D`). Banks, mail, IdPs, incognito, and password fields are always blocked regardless of the site list.
* **Filings** — queued and filed pages show up as summaries. **Queued** means the model has not decided yet. Reject dismisses a bad capture.
* **Assist** — on a thread (generic extract; better parsers for Hacker News and GitHub issues/PRs) you get what you already know, talking points, a short draft, a cite — or an honest gap. The thread is not stored.

Every policy change, site added or removed, and page captured or dropped is logged by the service — see [Activity log](#activity-log).

## Requirements

* Linux, macOS, or Windows
* Node.js 20+ (a C++ toolchain for `better-sqlite3`: build-essential / Xcode CLT / VS Build Tools)
* A Chromium-based browser
* [Ollama](https://ollama.com/) to accept captured pages and draft replies

## Install

### 1. Local service

```bash
git clone https://github.com/<you>/dossier.git
cd dossier
npm install --prefix service
npm run build --prefix service
```

Start the service (you start it; the extension does not):

```bash
npm start --prefix service
# or: node service/dist/index.js
```

On first run this creates:

| Path | Purpose |
|------|---------|
| `~/.config/dossier/config.toml` | User-editable settings (listen, models, capture) |
| `~/.local/share/dossier/` | Runtime data (`0700`) |
| `~/.local/share/dossier/token` | Per-install bearer token (`0600`). Never logged |
| `~/.local/share/dossier/dossier.sqlite` | Topics, items, filings |

Startup logs those absolute paths. Override with `DOSSIER_CONFIG` and `DOSSIER_HOME`.

On macOS the data dir is `~/Library/Application Support/dossier/` and config is still `~/.config/dossier/`. On Windows, `%APPDATA%\dossier\config.toml` and `%LOCALAPPDATA%\dossier\` for data.

The server binds **`127.0.0.1:18765` only**. It will not listen on `0.0.0.0`.

A schema-version mismatch replaces the local database. There is no migration from earlier builds — delete `dossier.sqlite` yourself if you prefer to wipe first.

### 2. Language model (optional, recommended)

```bash
ollama serve          # if it is not already running
ollama pull llama3.2
```

Without Ollama you can still add sites and queue pages. Filings stay **Queued** until a model accepts or rejects them. Drafted replies are unavailable; assist falls back to what you already have or an error, never a fabricated draft.

Point at a different OpenAI-compatible endpoint in `config.toml` if you want:

```toml
[llm]
base_url = "http://127.0.0.1:11434/v1"
chat_model = "llama3.2"
timeout_s = 120
```

Page text is sent only to that `base_url` (scope judge and assist drafts).

### 3. Extension

```bash
cd extension
npm install
npm run build
```

In the browser: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/dist`.

Register the native-messaging host (token handshake) after the service is built:

```bash
npm run build --prefix service
npm run install-host --prefix service
```

This writes `com.dossier.native.json` for Chrome / Chromium / Brave and a wrapper at `native/dossier-native.sh`. The unpacked extension ID is pinned (`nohjgllifaeekjbodpjlkacopbnflhco`). If native messaging is not installed, paste the token from the data dir into the side panel; content scripts never see it.

The side panel shows **service not running** if `dossierd` is down, and will refuse to talk to anything that is not `127.0.0.1:18765` with the install token.

### 4. Permissions

Adding a site asks for optional host access scoped to that one site (and its subdomains) so the extension can read pages there. Decline means the site isn't added. Removing a site revokes that host permission again if no other topic still needs it.

## Usage

1. Start `dossierd`. Click the Dossier icon to open the side panel. Confirm it shows the service as healthy. Click the icon again to close the panel.
2. Create a topic. On **Policy**, write what belongs. Changes apply immediately. Nothing is captured until the prompt is non-empty.
3. Browse to a site you want captured and click **Add site** on that topic (or press the hotkey — set one at `chrome://extensions/shortcuts`, suggested `Ctrl+Shift+D` / `⌘⇧D`). The **Sites** tab lists every site for a topic with a `×` to remove any of them, or a box to add one by typing its hostname. After an 8s dwell on an added site, the page is queued for the model.
4. The **Capture** switch in the header pauses ingest immediately; assist still works. The toolbar badge shows `‖` when paused.
5. Open **Filings** for summaries. Rows stay **Queued** until the model files or rejects them. `j`/`k` move, `x` or **Reject** dismisses. Rejected items are hidden unless you check **Show rejected**.
6. On an HN thread, GitHub issue, or any page: open Assist. Copy a draft if you would send it. Dossier never clicks Send.

Toolbar badge: `IN` current site is on a topic's list, `HELP` assist open (and not on a watched site), `‖` paused, blank otherwise.

Incognito is never captured. Mail, banks, health, IdPs, and password managers are denylisted for capture regardless of the site list. Assist may *read* the current thread on those hosts to help you reply; it will not save the thread, and the UI will say so.

## Configuration

Edit `~/.config/dossier/config.toml` (created on first start):

```toml
listen = "127.0.0.1"
port = 18765

[llm]
base_url = "http://127.0.0.1:11434/v1"
chat_model = "llama3.2"
timeout_s = 120

[capture]
dwell_ms = 8000
min_body_chars = 200
max_body_chars = 80000
```

Restart `dossierd` after changes.

## Activity log

Every policy change, site added or removed, capture paused/resumed, and page captured or dropped (with the reason: denylisted, too short, no eligible topic, paused, incognito) is logged by `dossierd` — to the console and to `~/.local/share/dossier/dossier.log`, rotated once it passes 5MB (one `.log.1` backup kept). Each line is one event with a timestamp, level, and the specific detail (topic, host, url, reason) needed to understand it without reading the source:

```
2026-08-24T18:03:11.482Z [INFO] policy_updated topic_id=... title="local capture" prompt_chars=48
2026-08-24T18:03:42.019Z [INFO] site_added topic_id=... title="local capture" host=arxiv.org
2026-08-24T18:04:05.221Z [INFO] capture_ingested url=https://arxiv.org/abs/... source=watching item_id=... title="..." topics=["local capture"]
2026-08-24T18:05:12.900Z [INFO] capture_dropped url=https://mail.google.com/... source=manual reason=denylisted pattern="host matches gmail.com denylist"
```

Page/highlight text itself is never written to this log, and bearer tokens are always redacted if a caller ever tries to log one. Tail it while you work if you want to see exactly what the extension is doing:

```bash
tail -f ~/.local/share/dossier/dossier.log
```

## Privacy

* Data never leaves the machine except to the configured LLM `base_url`.
* The HTTP API requires the per-install token and an `Origin` of this extension. A random tab cannot call it.
* Password fields, payment iframes, and token-like query parameters are stripped before persist.
* There is no analytics.
* Wipe: stop the service and delete the data directory.

Encryption at rest is not in v0.1. Protect the user account and the `0700` data dir.

## Development

Repo layout:

```
extension/     Manifest V3 + Vite + TypeScript
service/       Node.js + TypeScript (Fastify, better-sqlite3)
native/        Native-messaging host manifest
```

### Service

```bash
cd service
npm install
npm run dev          # tsc + restart on src/ change → http://127.0.0.1:18765
npm start            # node dist/index.js (after npm run build)
npm test             # Vitest; LLM mocked
npm test -- denylist
npm run typecheck    # tsc --noEmit
```

Tests must not call a live model. Fixtures cover normalize, denylist, auth/origin rejection, prompt policy, scope judge (mocked), site add/remove, the activity logger, filings, and assist (no-write, ungrounded ids).

### Extension

```bash
cd extension
npm install
npm run dev          # watch build into dist/ — reload the unpacked extension
npm run build
npm run typecheck    # tsc --noEmit
npm test             # Readability + HN/GitHub parser fixtures
```

Load `extension/dist` as an unpacked extension. After a background-worker change, hit Reload on `chrome://extensions`.

Do not point the extension at a non-loopback host. Do not log the token.

### Manual check

The product test is a real topic, not a demo script. Prompt → site → queued then filed should work before you touch assist.

### Conventions

* Unix line endings.
* Service binds localhost only; never relax Origin + bearer checks to “make the side panel work.”
* Policy prompt changes immediately on edit.
* Assist does not persist thread text.
* Drafts that cite item ids not in the retrieve set are forced to a gap.

## Status

v0.1. The contract is: one user, local service, no cloud, pages you actually captured, and a comment you would send (or a gap).
