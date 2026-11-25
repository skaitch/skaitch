# Server-side BIM processing

The migration moves the IFC and BIMWIQ import engines, IFC export,
IFC synchronisation and round-trip check/fix into `server/bim/`.
The matching `src/lib/` modules are now asynchronous HTTP clients.
The build fails if a `server/bim/` engine ends up in a browser chunk.

## Flow

The browser calls `POST /api/bim?operation=…` with its Firebase ID token.
The server checks the token with Firebase Admin and the Firebase project configured
by `VITE_FIREBASE_PROJECT_ID`. No uid supplied by the client is used to
authenticate it. Cross-site requests are refused. The data of the
import/export processing stay in memory during the request. Project operations
save the model in Firestore through Firebase Admin, under the account of the checked
token. No uid supplied in the request body is used.

Operations: `import-ifc`, `import-bimwiq`, `export-ifc`, `patch-ifc`, `check-ifc`,
`fix-ifc`, `mcp-model`, `mcp-read`, `mcp-settings`, `project-list`, `project-write`,
`project-delete`. The IFC import receives the file bytes; the other operations
receive JSON. Exchanges are gzip-compressed. Responses are not
cached. An error leaves the existing model untouched; a synchronisation
response that became stale is ignored by the editor.

The Node engine loads `web-ifc-node.wasm` from the installed package. The file is
included in the Vercel function through `vercel.json`. Each import closes its model
and frees its WASM instance. Intermediate meshes stay on the server:
the browser viewer shows the original IFC file, as when
reopening a project before this migration.

## Saving and synchronising projects

Name reservations, creations, saves and deletions run
on the server in `server/bim/projectStore.ts`. The model and the name catalogue
are updated in the same transaction. `FIREBASE_SERVICE_ACCOUNT_JSON` is required,
with the same project as `VITE_FIREBASE_PROJECT_ID`; these credentials stay secret
on the server. Firebase Admin's Firestore dependency is declared explicitly.

Each change of the model or its catalogue increments `modelRevision`. A save or deletion
based on an old revision gets HTTP 409. Existing documents without a
revision start at zero. Saves from the same tab are sequenced; an
error never falls back to a direct write to Firestore.

The browser can read projects and listen to their changes. An editor without
local changes adopts a newer remote revision and resets its
history so as not to undo another editor's changes. If it has
local changes, it keeps them and shows a conflict; exporting these changes
before reopening the project keeps them. Going back to the home page waits for the
save and stays in the editor if it fails.

Firestore rules block browser writes to `projects`, `metadata` and `mcp_sessions`.
They must be deployed with the new application and the API; old
browser versions will no longer be able to save directly. These changes are
not deployed automatically. Models above the 950 KB threshold are
compressed and split into chunks written atomically (see below).

## Development and limits

`pnpm dev` mounts the same route in Vite through `server/bim-dev.ts`. This route keeps
Firebase authentication; there is no local sign-in bypass.
Loading the handler in middleware mode is tested without starting the
application server. `vite preview` provides no API; use Vite in dev mode or
a full Vercel deployment to test processing.

Vercel functions enforce a 4.5 MB request/response limit:
https://vercel.com/docs/functions/limitations
This API keeps a margin and refuses exchanges above **4 MB after
compression**, **64 MB after decompression**, **20,000 elements** or 50 levels
of JSON nesting. The client times out after 190 seconds; the function is limited
to 180 seconds. Larger files will need a direct transfer to
object storage and asynchronous processing; no fallback to a
local engine is included in the bundle.

## What stays in the browser

- Interface, selection, drawing, camera, 2D/3D rendering and the geometric computations used
  by these interactions.
- Third-party IFC viewer and its WASM, needed for display.
- Current JSON/DXF/DWG exports and PDF/PNG captures.
- Interactive control, preview, confirmation and application of MCP changes.
- Temporary entry of AI keys and access to explicitly local providers. The
  cloud provider adapters are described in [ai-server.md](ai-server.md).

## Cloud MCP without a browser

`api/mcp.ts` runs reads and context navigation on the server.
`list_projects` filters projects by the key's current rights. The assistant
then calls `select_project` and `select_storey`. The context is stored in
`mcp_sessions`, in the account that owns the key, under a SHA-256 fingerprint of
the key. Two keys have independent contexts; two clients reusing the
same key therefore share the selection. This selection does not change the browser
screen until an interactive action asks for it.

Reads, measurements, catalogue lists and IFC export use the saved
model. Unsaved changes in the editor are not visible
to these cloud tools. Personal and project catalogues are saved with
the model; existing projects without a catalogue use the built-in catalogue.

The `enabled` and `alwaysValidate` settings are saved in `metadata/mcp` by
the authenticated API and versioned. The browser loads them at sign-in and sequences
setting changes. Confirmation is enabled by default, including after
this migration: an old disabled local preference is not enough to allow
autonomous execution. Confirmation must be explicitly disabled in the
synchronised settings. A session left open with old settings may receive
a revision conflict and must reload the settings.

When confirmation is disabled, the server computes the changes on the
saved model, applies cascading deletions and saves the new
revision in a transaction. The transaction re-checks the key, its rights, the
MCP selection, the confirmation settings and the model revision. A concurrent
change refuses the command instead of overwriting the model. Open editors
receive the new model according to the synchronisation rules described above.

If confirmation is required, the command still goes through the browser via
Firestore. The server indicates the project, the storey and the need to confirm;
the editor selects this context before running the action. A reservation
transaction prevents two tabs from handling the same request. Requests expire
after 120 seconds. The preview stays local until the user has confirmed;
autosave and navigation are suspended during this confirmation.
Deletions are only computed after approval. An expired request is refused
and the preview is cancelled. A successful confirmation waits for the save before answering
the MCP client.

Camera and capture tools stay tied to the browser. Cloud renders
use the saved AI preferences; they can work without a browser
if confirmation is disabled (see [ai-server.md](ai-server.md)). The local stdio/WebSocket
MCP server keeps its existing behaviour; this autonomous mode
concerns the cloud endpoint `api/mcp.ts`.

No deployment or restart of the suspended Vercel projects is performed by
this code migration.


## Exports and large projects

DXF and BIM JSON exports are generated by the authenticated BIM API. The browser
receives the content, then triggers the download. The fake DWG export (DXF
prefixed and renamed `.dwg`) was removed; no native DWG converter is installed.
PDF and PNG remain tied to the canvas capture in the browser.
The generic create/update/delete_ifc_element tools compute their changes
on the server and follow the confirmations of the same bridge as the other tools.

Beyond 950 KB for the document, the model JSON is compressed then split
into `users/{uid}/projects/{id}/modelChunks/{revision}_{index}`. The project and its
chunks are written or deleted in the same transaction, with a revision check.
Old models in `itemsJson` remain readable. Chunk reads
go through a server transaction; real-time notifications never replace
unsaved local changes. The project list excludes
the model, the catalogue and the chunk manifest.

Saving is capped at eight chunks of 500,000 base64 characters and
metadata at 950 KB to keep a margin under the
[Firestore transaction limits](https://firebase.google.com/docs/firestore/manage-data/transactions).
Exceeding them is refused before writing. HTTP transfer keeps its limit
of 4 MB compressed / 64 MB decompressed and the model stays limited to 20,000 elements.
Files beyond these bounds would need object storage and asynchronous
tasks; that infrastructure is not created by this migration.


## Local server credentials

Local Google sign-in must be opened on `http://localhost:5174` if
`127.0.0.1` is not among the authorised Firebase domains. A browser
session does not provide Firebase Admin credentials to the server.
In development, `GOOGLE_APPLICATION_CREDENTIALS` may point to an existing
Google Cloud file allowed to access the same Firestore project. This option
reuses existing IAM permissions; it grants none.
`FIREBASE_SERVICE_ACCOUNT_JSON` takes precedence when configured.
Missing variables are not injected as the string `"undefined"`.
No local path nor content of the credentials file may be published.


## MCP validation: local check of 14 November 2026

The Vite middleware also exposes `/api/mcp` with the same handler as in production.
The handler accepts the raw Node JSON stream and the body already decoded by Vercel.
The migration's requests and responses use `mcp_requests_v2` and
`mcp_responses_v2` to isolate this protocol from old editors still connected.
Existing MCP keys and clients keep their format.

Checks done with the official MCP client over Streamable HTTP and an existing
key, on the reference IFC project imported for this test:

- Confirmation on: preview visible, no model write before approval,
  then saved after acceptance and the returned identifier equal to the saved one.
- Refusal: error raised to the MCP client, preview cancelled and saved revision unchanged.
- Confirmation off: server creation and save succeeded with the browser closed,
  then the new wall read in the reopened editor.
- Reframe: proposed wall visible in 3D and selection centred in the 2D canvas.
  MCP walls are framed from their geometry and the storey elevation,
  without reading their timestamp as an IFC fragment identifier.
- End of test: `TEST MCP LIVE` objects deleted from the only test project,
  confirmation re-enabled and test client process stopped.

The dialog is rendered in both interfaces, mobile and desktop. The local
stdio/WebSocket bridge waits up to 120 seconds for a confirmation; its ports are
limited to `127.0.0.1`. No Vercel server was restarted.
