# Dossier

Topic-scoped research capture for the browser. You name subjects you care about, chat a capture policy and outline into existence, and Dossier files what you read into that structure. The same dossier — even while it is still thin — can ground a short reply on a live thread.

Pages stay on your machine. The only network the service makes is to the LLM you configure (default: Ollama on localhost). It never sends on your behalf.

Chromium only (Chrome, Brave, Edge, Chromium). Firefox is out of scope for v0.1.

## How it works

```
Browser extension  →  dossierd (127.0.0.1)
                         ├─ ~/.config/dossier/config.toml
                         ├─ ~/.local/share/dossier/  (token, SQLite)
                         └─ Ollama (optional for capture; required for chat, judge, draft)
```

* **Session** — you hit record for one or more topics. Higher capture. Banks, mail, IdPs, incognito, and password fields are still blocked.
* **Watching** — after you accept a policy, only hosts you confirmed are eligible. Not the open web.
* **Pin / highlight** — always available on the current tab.
* **Assist** — on a thread (generic extract; better parsers for Hacker News and GitHub issues/PRs) you get what you already know, talking points, a short draft, a cite — or an honest gap. The thread is not stored unless you Pin it.

## Requirements

* Linux, macOS, or Windows
* Node.js 20+ (a C++ toolchain for `better-sqlite3`: build-essential / Xcode CLT / VS Build Tools)
* A Chromium-based browser
* [Ollama](https://ollama.com/) if you want chat, filing judgments, or drafted replies

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
| `~/.config/dossier/config.toml` | User-editable settings (listen, models, thresholds) |
| `~/.local/share/dossier/` | Runtime data (`0700`) |
| `~/.local/share/dossier/token` | Per-install bearer token (`0600`). Never logged |
| `~/.local/share/dossier/dossier.sqlite` | Topics, items, filings |

Startup logs those absolute paths. A `config.toml` left in the share dir from an earlier build is moved once. Override with `DOSSIER_CONFIG` and `DOSSIER_HOME`.

On macOS the data dir is `~/Library/Application Support/dossier/` and config is still `~/.config/dossier/`. On Windows, `%APPDATA%\dossier\config.toml` and `%LOCALAPPDATA%\dossier\` for data.

The server binds **`127.0.0.1:18765` only**. It will not listen on `0.0.0.0`.

### 2. Language model (optional, recommended)

```bash
ollama serve          # if it is not already running
ollama pull llama3.2
ollama pull nomic-embed-text
```

Without Ollama you can still pin pages, review, and export a brief. Chat, automatic filing, and drafted replies are unavailable; assist falls back to keyword bullets or an error, never a fabricated draft.

Point at a different OpenAI-compatible endpoint in `config.toml` if you want:

```toml
[llm]
base_url = "http://127.0.0.1:11434/v1"
chat_model = "llama3.2"
embed_model = "nomic-embed-text"
timeout_s = 120
```

Page text is sent only to that `base_url`.

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

This writes `com.dossier.native.json` for Chrome / Chromium / Brave and a wrapper at `native/dossier-native.sh`. The unpacked extension ID is pinned (`nohjgllifaeekjbodpjlkacopbnflhco`). If native messaging is not installed, paste the token from the data dir into the popup; content scripts never see it.

The popup shows **service not running** if `dossierd` is down, and will refuse to talk to anything that is not `127.0.0.1:18765` with the install token.

### 4. Permissions

Pin-this-page uses `activeTab` only. Starting a **session** or enabling **watching** asks for optional host access so the extension can read those pages. Decline means you can still pin manually.

## Usage

1. Start `dossierd`. Confirm the popup shows the service as healthy.
2. Open the side panel. Create a topic and chat until the policy and outline look right. **Accept the diff.** Nothing is captured against a topic with no accepted policy.
3. Watching: confirm the host list the policy proposed, then browse. Only those hosts, after an 8s dwell, are candidates.
4. Or start a **session** for one or more topics when you sit down to work. Toolbar badge `REC`. Pause (`‖`) stops ingest immediately; assist still works.
5. Review the queue (keep / refile / reject). `j`/`k` move, `enter` keeps, `x` rejects.
6. Open the brief. Export Markdown when you want a file you can start writing from.
7. On an HN thread, GitHub issue, or any page: open Assist. Copy a draft if you would send it. Pin an objection to turn it into inbox research. Dossier never clicks Send.

Toolbar badges: `REC` session, `WATCH` watching, `HELP` assist open (not recording), `‖` paused.

Incognito is never captured. Mail, banks, health, IdPs, and password managers are denylisted for capture. Assist may *read* the current thread on those hosts to help you reply; it will not save the thread unless you Pin, and the UI will say so.

## Configuration

Edit `~/.config/dossier/config.toml` (created on first start):

```toml
listen = "127.0.0.1"
port = 18765

[llm]
base_url = "http://127.0.0.1:11434/v1"
chat_model = "llama3.2"
embed_model = "nomic-embed-text"
timeout_s = 120

[capture]
dwell_ms = 8000
min_body_chars = 200
max_body_chars = 80000
auto_accept_confidence = 0.85

[filter]
include_min_cosine = 0.32
exclude_margin = 0.04
```

Restart `dossierd` after changes.

## Privacy

* Data never leaves the machine except to the configured LLM `base_url`.
* The HTTP API requires the per-install token and an `Origin` of this extension. A random tab cannot call it.
* Password fields, payment iframes, and token-like query parameters are stripped before persist.
* There is no analytics.
* Wipe: stop the service and delete the data directory. Export first if you want a copy.

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
npm run dev          # tsx watch → http://127.0.0.1:18765
npm start            # node dist/index.js (after npm run build)
npm test             # Vitest; LLM mocked
npm test -- denylist
npm run typecheck    # tsc --noEmit
```

Tests must not call a live model. Fixtures cover normalize, denylist, cheap filter, auth/origin rejection, session-vs-watching persist rules, judge mapping, policy accept, brief/export, and assist (no-write, pin, private leak, ungrounded ids).

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

The product test is a real topic, not a demo script. Capture → queue → brief should work on pinned pages before you touch chat or assist. Full checklist lives in the v0.1 spec (notes: `Projects/Research Dossier/mvp-specification.md`).

### Conventions

* Unix line endings.
* Service binds localhost only; never relax Origin + bearer checks to “make the popup work.”
* Policy and outline change only on an explicit Accept.
* Assist does not persist thread text unless `pin=true`.
* Drafts that cite item ids not in the retrieve set are forced to a gap.

## Status

v0.1 implementation of the spec. The contract is: one user, local service, no cloud, a brief you would write from, and a comment you would send (or a gap).
