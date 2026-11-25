# Server-side AI calls

The browser uses `POST /api/ai?operation=…` with a Firebase ID token. The API
checks the session and refuses cross-site requests before reading the data.
The same handlers are mounted by Vite in development; no application server
is started by the tests or by this migration.

The Gemini, Anthropic and OpenAI-compatible adapters live in `server/ai/chat.ts`.
Capability discovery, model lists and render generation also run on the
server. The chat and the MCP bridge reuse the same render
engine. The build refuses any import of `server/ai/` or `server/bim/` in a browser
chunk. The public tool schemas and the compatible protocol for local
models remain shared.

## Flow and cancellation

The chat returns NDJSON events: text or thinking fragments, then a
result holding the full text and the normalised tool calls. The server builds the prompt from the model and the selection, interprets
textual calls, builds the next history and enforces a limit of 50 turns.
The interface relays the continuation it receives, shows the fragments and presents the
confirmations. Manual adjustments are propagated to the next tools on the server.
One request per turn keeps confirmations out of the HTTP timeout.
For a local model, the server prepares the prompt and the history, then the browser
sends them to the local provider before returning its answer to the server controller.
Provider-specific protocols are handled on the server. The SSE parser handles
UTF-8 boundaries, multi-line events and a last event without a trailing
newline. Errors coming from a provider return neither its error body
nor the keys in the response to the browser.

A browser disconnection cancels the HTTPS call to the provider. Total duration
is limited to 170 seconds in the handler and 180 seconds on Vercel. Requests
share the bounds of the BIM transport: 4 MB compressed, 64 MB after decompression.
Compressed JSON responses and the chat stream are limited to 4 MB; the upstream
transport is also capped at 16 MB. Downloading and displaying media
returned by providers remain done by the browser.

## Destinations and keys

Cloud destinations must use HTTPS on port 443, without a user name or
password in the URL. The transport refuses private, local and
reserved addresses, including alternative IPv4 notations and mapped IPv6. All
DNS answers are checked and the validated addresses are pinned for the TLS connection,
which keeps certificate validation for the provider's name. Redirects
are not followed. Polling a Replicate render must stay on the same origin
before sending its key.

Public preferences (provider, model, temperature and chat and
render URLs) are stored separately in `users/{uid}/metadata/ai`. The
**Save AI preferences** and **Reload AI preferences** buttons drive this
per-account configuration, with revision checks. No key field nor URL
containing a user name or a query string is accepted in these preferences.
At sign-in, an existing server configuration is loaded without overwriting
changes made while it loads. Without a server configuration,
existing local preferences remain available until they are saved.

Cloud keys are saved through the `credentials` operation of the AI API,
after checking the Firebase account. They are encrypted with AES-256-GCM using
a dedicated key derived from **`AI_VAULT_SECRET`** (at least 32 random characters),
distinct from `OAUTH_SECRET`. The existing sealing helper is reused with a
dedicated type; the account, role, provider and origin are part of the authenticated
content. A document copied into another account cannot be used.

The `users/{uid}/ai_credentials/{id}` documents are forbidden for reading and
writing from the browser by the Firestore rules. Only Firebase Admin
accesses them. The API returns only the identifier, role, provider, origin
and version number; no operation returns the key or its ciphertext.
Replacements and deletions check the version to refuse stale
writes. A new key stays in the input field in memory until it is
saved; the field is then cleared. Drafts are not saved
in local preferences.

Cloud calls pass a key reference, not its secret text. The
server checks the account and the destination before decrypting it. It also enforces
the allowed origins on every actual HTTPS request, including model lists
and render polling. The official Hugging Face domains needed
for chat, metadata and renders are explicitly tied to the provider.
Errors and logs do not expose keys.

### Old local keys

On first load, the old values are put into a local recovery copy
`skaitch:legacy-ai-keys` before cleaning the UI preferences.
If this copy cannot be prepared, the old storage is not overwritten and an
error is shown. In the AI settings, **Transfer cloud keys to this account**
saves the old keys for the account currently signed in. The transfer
is transactional: a different server key for the same destination causes
a conflict without overwriting. A new attempt with exactly the same key is
accepted, which allows recovering from a lost network response.

The local copy is only cleaned after the server confirms all the keys.
A network failure, a missing encryption configuration, ambiguous old
keys or an account change keep it. Old keys of local
endpoints stay in this recovery copy on the machine; the
local recovery button only reloads a key of the same provider and the same
origin. New local keys stay in memory only and must be
typed again after a reload.

### Configuration before deployment

Set `FIREBASE_SERVICE_ACCOUNT_JSON` for the same Firebase project, and
`AI_VAULT_SECRET` on the server, without a `VITE_` prefix. `.env.example` describes these
variables. Vite explicitly loads only the server variables its
handlers need; they are not injected into browser chunks. No real secret
is created or changed by this code migration.

**Keep a backup of `AI_VAULT_SECRET`**: changing or losing this value
makes existing keys unreadable. Rotating `OAUTH_SECRET` stays independent.
Publish the Firestore rules and the API with the new application; old
clients that send a plaintext cloud key to the inference API are refused and must
reload the application, then save/transfer the key.

## Local providers

Ollama and the `custom` provider explicitly configured on localhost, a private IPv4
address or a `.local` name remain directly reachable from the browser.
A remote machine cannot reach the user's localhost. In
development mode, the existing CORS proxy option remains usable for these
local endpoints. A cloud server error never triggers a fallback to a
direct cloud call from the browser.

## MCP renders

The `generate_visualization` tool is exposed in the shared MCP catalogue. In
cloud mode, it uses the project selected by the MCP key, its saved model, the
account's saved AI preferences and the encrypted keys. The generator receives
the prompt enriched with the project's textual context. Write access to the project
is required; read-only MCP keys cannot start a render, including
in local mode.

If confirmation is disabled in the synchronised MCP settings, the render can
run with the browser closed. Otherwise, the browser receives an approval request with
the provider, the model and the prompt. It runs no preview generation for
that request. After approval, the server re-checks rights, selection, project
revision, preferences, MCP policy and key version before
calling the provider. Any change to this context refuses the request and
requires starting it again. A user refusal starts no generation call.

The overall MCP call timeout is 170 seconds, waiting for confirmation included
(which is limited to 120 seconds). A disconnection cancels the ongoing cloud call.
Images returned as base64 are passed as native MCP image blocks, without
duplicating the bytes in the text content; HTTPS URLs remain available
in the text result.

An explicitly local provider always uses the browser. In that case,
local preferences must match the saved MCP preferences.
Camera and captures also stay tied to the open editor. The local stdio/WebSocket
MCP server keeps its access to the editor context.

## Verification

Tests use simulated providers and HTTPS connections: authentication,
credential isolation, streaming, tool arguments, cancellation, DNS, redirects
and transport bounds. No call to a paid model nor real generation is
made. Provider contracts follow the existing adapters; how they
work with real models and subscriptions must be checked during a
future authorised test in a live environment. No Vercel deployment or restart
is performed by this migration.
