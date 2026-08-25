# Dossier

Topic-scoped research capture for the browser. You name subjects you care about, chat a capture policy and outline into existence, and Dossier files what you read into that structure. The same dossier — even while it is still thin — can ground a short reply on a live thread.

Pages stay on your machine. The only network the service makes is to the LLM you configure (default: Ollama on localhost). It never sends on your behalf.

Chromium only (Chrome, Brave, Edge, Chromium). Firefox is out of scope for v0.1.

## How it works

```
Browser extension  →  dossierd (127.0.0.1)
                         ├─ ~/.config/dossier/config.toml
                         ├─ ~/.local/share/dossier/  (token, SQLite, dossier.log)
                         └─ Ollama (optional for capture; required for chat, judge, draft)
```

One workflow: establish a capture policy for a topic, then add or remove sites for it with a single click or hotkey. Nothing is captured against a topic with no accepted policy, and nothing is captured from a site that isn't on that topic's list.

* **Policy** — chat a topic's intent and outline into existence, review the diff, accept it. This is the only gate: a topic with no accepted policy never captures anything.
* **Sites** — once a policy is accepted, add the page you're on with one click (toolbar popup) or one hotkey (`chrome://extensions/shortcuts`, default `Ctrl+Shift+D` / `⌘⇧D`). Removing a site is the same button/hotkey, or the × next to it in the popup or side panel. Banks, mail, IdPs, incognito, and password fields are always blocked regardless of the site list.
* **Pin / highlight** — always available on the current tab, independent of any topic's site list.
* **Assist** — on a thread (generic extract; better parsers for Hacker News and GitHub issues/PRs) you get what you already know, talking points, a short draft, a cite — or an honest gap. The thread is not stored unless you Pin it.

Every policy accepted, site added or removed, and page captured or dropped is logged by the service — see [Activity log](#activity-log).

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

Pin-this-page uses `activeTab` only. Adding a site asks for optional host access scoped to that one site (and its subdomains) so the extension can read pages there. Decline means the site isn't added; you can still pin pages on it manually. Removing a site revokes that host permission again if no other topic still needs it.

## Usage

1. Start `dossierd`. Confirm the popup shows the service as healthy.
2. Open the side panel. Create a topic and chat until the policy and outline look right. **Accept the diff.** Nothing is captured against a topic with no accepted policy.
3. Once a policy is accepted, browse to a site you want captured and click **Add this site** in the popup (or press the hotkey — set one at `chrome://extensions/shortcuts`, suggested `Ctrl+Shift+D` / `⌘⇧D`). The same button/hotkey removes it again; the side panel's **Sites** tab lists every site for a topic with a `×` to remove any of them, or a box to add one by typing its hostname. After an 8s dwell on an added site, the page is a capture candidate.
4. Pause (`‖`) stops ingest immediately; assist still works.
5. Review **Filings** (keep / refile / reject). `j`/`k` move, `enter` keeps, `x` rejects, `1`–`9` files into a section. Rejected items are hidden unless you check **Show rejected**.
6. Open the brief. Export Markdown when you want a file you can start writing from.
7. On an HN thread, GitHub issue, or any page: open Assist. Copy a draft if you would send it. Pin an objection to turn it into inbox research. Dossier never clicks Send.

Toolbar badge: `IN` current site is on a topic's list, `HELP` assist open (and not on a watched site), `‖` paused, blank otherwise.

Incognito is never captured. Mail, banks, health, IdPs, and password managers are denylisted for capture regardless of the site list. Assist may *read* the current thread on those hosts to help you reply; it will not save the thread unless you Pin, and the UI will say so.

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

## Activity log

Every policy accepted, site added or removed, capture paused/resumed, and page captured or dropped (with the reason: denylisted, too short, no eligible topic, paused, incognito) is logged by `dossierd` — to the console and to `~/.local/share/dossier/dossier.log`, rotated once it passes 5MB (one `.log.1` backup kept). Each line is one event with a timestamp, level, and the specific detail (topic, host, url, reason) needed to understand it without reading the source:

```
2026-08-22T18:03:11.482Z [INFO] policy_accepted topic_id=... title="local capture" version=1 seeded_hosts=["news.ycombinator.com","github.com"]
2026-08-22T18:03:42.019Z [INFO] site_added topic_id=... title="local capture" host=arxiv.org
2026-08-22T18:04:05.221Z [INFO] capture_ingested url=https://arxiv.org/abs/... source=watching item_id=... title="..." topics=["local capture"] origin=public
2026-08-22T18:05:12.900Z [INFO] capture_dropped url=https://mail.google.com/... source=manual reason=denylisted pattern="host matches gmail.com denylist"
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
npm run dev          # tsc + restart on src/ change → http://127.0.0.1:18765
npm start            # node dist/index.js (after npm run build)
npm test             # Vitest; LLM mocked
npm test -- denylist
npm run typecheck    # tsc --noEmit
```

Tests must not call a live model. Fixtures cover normalize, denylist, cheap filter, auth/origin rejection, manual-vs-watching persist rules, site add/remove (requires an accepted policy, seeds once, survives re-accepts), the activity logger, judge mapping, policy accept, brief/export, and assist (no-write, pin, private leak, ungrounded ids).

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
