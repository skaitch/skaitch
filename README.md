# skaitch

Open source IFC4 BIM tools driven by AI, **MCP4IFC**-compatible. skaitch is made of two apps
that work together:

| App | What it is for |
|-----|----------------|
| **skaitch Desktop** | The BIM editor for Windows, macOS and Linux. Draw, import and export IFC, lay out sheets, and let your AI assistant model through a local MCP server. Projects stay on your computer. |
| **skaitch Survey** | The offline mobile app (Android, iOS) to survey a building on site: rooms, walls, openings, dimensions and photos. The survey file is then imported into a storey in skaitch Desktop. |

Prefer not to install anything? **skaitch Online**, the same editor in the browser, is
available at [skaitch.online](https://skaitch.online) (account required). See
[skaitch Online](#skaitch-online-web-edition-self-hosted) to host it yourself.

Both apps offer 11 languages: French, English, German, Spanish, Portuguese, Italian,
Dutch, Arabic (right to left), Chinese, Japanese and Russian.

## Project model

- **Free and open source.** The code is published under the AGPL (see [License](#license)).
  There is no paid edition today.
- **Bring your own AI.** skaitch does not sell or resell AI. Each user connects their own
  provider key (Anthropic, OpenAI, Mistral…) or a local model (Ollama, any
  OpenAI-compatible server). Usage is billed by that provider, not by skaitch.
- **Local first.** skaitch Desktop needs no account and no server; your projects are files
  on your machine.
- **Issues welcome, pull requests not merged for now.** See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## skaitch Desktop

### Install

Download the installer for your system from the
[latest release](../../releases/latest):

| Platform | File |
|---|---|
| Windows x64 | `skAItch-<version>-win-x64.exe` |
| macOS | `skAItch-<version>-mac-arm64.dmg` (Apple Silicon), `skAItch-<version>-mac-x64.dmg` (Intel) |
| Linux x64 | `skAItch-<version>-linux-x86_64.AppImage`, `skAItch-<version>-linux-amd64.deb` |

The installers are not code-signed yet. On Windows, SmartScreen asks for confirmation
(**More info → Run anyway**). On macOS, right-click the app → **Open**, or run
`xattr -dr com.apple.quarantine /Applications/skAItch.app`. There is no automatic
update: download the new installer to upgrade.

### Build from source

```bash
git clone <repo-url> && cd skaitch
pnpm install --frozen-lockfile
pnpm desktop                                     # build and start the app
pnpm --filter @skaitch/desktop package           # installer for the current platform
```

See [apps/desktop/README.md](apps/desktop/README.md) for packaging and releases.

### Connect your AI assistant (local MCP)

While skaitch Desktop is open, an MCP client (Claude Desktop, Claude Code, Codex…) can read
and change the open project. The server only listens on your machine, at a private address
shown in **Settings → MCP server**:

```
http://127.0.0.1:3923/mcp/<token>
```

Keep this address private: it gives access to your projects. The downloaded
`skaitch-desktop` plugin includes instructions for using the local MCP tools.

---

## skaitch Survey

Offline survey app for Android and iOS. A survey is saved on the phone as you go and
exported as a `.skaitch-survey` file (photos included, EXIF removed), then imported from a
storey's **Survey** tab in skaitch Desktop.

```bash
pnpm --filter @skaitch/survey dev        # try it in a browser: http://localhost:5175
pnpm --filter @skaitch/survey cap:sync   # build and copy into android/ and ios/
pnpm --filter @skaitch/survey android    # open in Android Studio
pnpm --filter @skaitch/survey ios        # open in Xcode (macOS)
```

See [apps/survey/README.md](apps/survey/README.md).

---

## skaitch Online (web edition, self-hosted)

The same editor also runs in a browser, with accounts, cloud storage and a remote MCP
endpoint. The official instance is [skaitch.online](https://skaitch.online). It needs a Firebase project and a Vercel deployment; the sections below are
for those who want to host it themselves.

### Requirements

| Tool | Minimum version |
|-------|-----------------|
| Node.js | 26 LTS |
| pnpm | 8.13.1 |
| Git | 2.x |

---

### Local installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd SkAItch

# 2. Install dependencies
pnpm install --frozen-lockfile

# 3. Create the local environment file
cp .env.example .env.local

# 4. Start the application
pnpm run dev
```

The application is available at **http://localhost:5173**.

For an AI API that refuses the browser's CORS requests, enable
**Settings → AI → CORS proxy (local development)**. The Vite server relays
requests and streamed responses, without forwarding the browser's cookies.
This option works with `pnpm run dev`; in production, requests stay
direct and the provider must allow CORS. For a custom OpenAI-compatible
provider, enter its full base URL, including `/v1` if needed.

---

### Available scripts

| Command | Description |
|----------|-------------|
| `pnpm run dev` | Vite development server |
| `pnpm run build` | Production build into `dist/` |
| `pnpm run preview` | Preview the production build |
| `pnpm run mcp` | Start the local MCP server (port 3001) |
| `pnpm run vercel:setup` | First Vercel setup (once only) |
| `pnpm run deploy` | Deploy to production on Vercel |
| `pnpm run deploy:preview` | Deploy a preview on Vercel |

---

### Deploying on Vercel

#### First setup

```bash
# Starts the Vercel CLI, signs in your account, links the project
pnpm run vercel:setup
```

This command:
1. Runs `vercel` with `pnpm dlx`
2. Opens the browser to sign in (`vercel login`)
3. Links the folder to the Vercel project (`vercel link`)

#### Deploying an update

```bash
# Production deployment
pnpm run deploy

# Preview deployment (to test before production)
pnpm run deploy:preview
```

#### Environment variables on Vercel

In **Vercel Dashboard → Project → Settings → Environment Variables**, add if needed:

| Variable | Value | Environment |
|----------|--------|---------------|
| `VITE_MCP_WS_URL` | *(not needed in production)* | Local only |

The local server `server/mcp-server.ts` runs in Claude Desktop. The remote server
`api/mcp.ts` and its OAuth routes are deployed on Vercel with the application.
Configure the Firebase variables of `.env.example`, then `OAUTH_SECRET` (at least
32 random characters, generated with `openssl rand -hex 32`) and `PUBLIC_BASE_URL`
(the HTTPS origin of the deployment). Never prefix the OAuth secret with `VITE_`.
The Vercel project must allow the 180-second function duration configured for
`api/mcp.ts`, to leave time to confirm a change in the editor.

#### Downloading the desktop app

The server offers the desktop app installers (Windows, macOS,
Linux) from the repository's **latest GitHub release**. As the repository is private, the
`api/download.ts` function reads the release with a server token, then redirects the browser
to the temporary signed URL provided by GitHub. The file does not go through
Vercel and the token is never exposed.

| Variable | Value |
|----------|--------|
| `GITHUB_TOKEN` | *Fine-grained* token limited to this repository, permission **Contents: read-only** |
| `GITHUB_REPO` | `skaitch/skaitch` (default value) |

| Address | Result |
|---------|----------|
| `/api/download` | JSON list of the latest release's installers |
| `/download/windows` | Windows x64 installer (`.exe`) |
| `/download/mac` | macOS Apple Silicon (`.dmg`); `?arch=x64` for Intel |
| `/download/linux` | Linux x64 AppImage; `?format=deb` for the Debian package |

Download buttons appear in **About**. Installers are
built by the `.github/workflows/desktop-release.yml` workflow on every `v*` tag
(see `apps/desktop/README.md`).

#### Technical notes

- The **COOP / COEP** headers (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`) are set in `vercel.json`. They are required for `web-ifc` to use `SharedArrayBuffer` (multithreaded WASM).
- `web-ifc` is pinned to `0.0.77`: version `0.0.78` has a JavaScript/WASM incompatibility on `StreamMeshes`. Check loading in a browser before any upgrade.
- The IFC WASM comes from the installed `web-ifc` package and Vite publishes it into `assets/` with a content hash, to keep the binary and its JavaScript in sync.
- The SPA is configured with a catch-all rewrite → `index.html`.

---

### Codex plugin

You can install both plugins side by side. Each ZIP contains its own MCP
configuration and a skill for that connection.

- **`skaitch-web`** (web, from the MCP settings on the web): import the ZIP from the
  Codex plugin settings. The Web MCP server requires OAuth authorization for
  access to your projects.
- **`skaitch-desktop`** (from **Settings → MCP server** in the desktop app):
  extract the ZIP and [install it from a local Codex marketplace](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually).
  No sign-in is needed, but keep skAItch Desktop open on the same machine. The
  archive contains its secret MCP URL, so keep it private.

You can also install the web plugin from this repository's local catalogue
(`codex plugin marketplace add .` then `codex plugin add skaitch-web@skaitch-local`),
then run `codex mcp login skaitch-web`.
In a new chat, ask Codex to list the SkAItch projects, then select the project
you want to work on.

### MCP setup in ChatGPT and Claude

#### Remote connection (ChatGPT and Claude)

1. In SkAItch, sign in, enable MCP and generate a key in
   **Settings → API / MCP keys** with the needed rights on projects.
2. Use the URL `https://<your-domain>/api/mcp`, without a key in the URL.
3. In ChatGPT, enable developer mode and create an MCP app with
   this URL and OAuth authentication (depending on your account's rights).
4. In Claude, open **Settings → Connectors**, add a custom
   connector with this URL and choose **Register automatically** for
   the OAuth client. The server provides dynamic registration (DCR).
5. Leave client ID and secret empty for automatic registration.
   On the SkAItch authorisation page, enter your API key.
6. Keep SkAItch open, signed in, with MCP enabled. Call `list_projects`,
   then `select_project` before querying or changing a model.

Remote transport: stateless **Streamable HTTP**, JSON responses on POST.
GET returns 405; no standalone SSE stream is needed. Changes
may require confirmation in the editor (maximum delay: 120 seconds).
Read-only keys cannot change projects. Revoking a key
invalidates its access. Access tokens last one hour and are renewed with a
refresh token valid for 90 days; after that, reconnect the connector.

Official documentation: [ChatGPT MCP](https://developers.openai.com/plugins/build/mcp-server),
[ChatGPT OAuth authentication](https://developers.openai.com/plugins/build/auth),
[Claude connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

#### Local Claude Desktop (stdio)

Install the dependencies, run `pnpm run dev`, open the application,
sign in and enable MCP. Claude Desktop will start its own MCP process;
a second `pnpm run mcp` would take the same WebSocket port.

Open the configuration file from Claude Desktop's developer settings
(on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`;
on Windows: `%APPDATA%\Claude\claude_desktop_config.json`). Add:

```json
{
  "mcpServers": {
    "skaitch": {
      "command": "node",
      "args": [
        "--import",
        "/absolute/path/SkAItch/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/SkAItch/server/mcp-server.ts"
      ],
      "env": {
        "SKAITCH_API_KEY": "ak_YOUR_KEY"
      }
    }
  }
}
```

Replace both paths and the key, then restart Claude Desktop. If Node is
not in the application's PATH, use its absolute path for `command`.
The TypeScript loader installed in the project works even if Claude starts
from another folder. ChatGPT uses the remote connector above.

#### Reproducible check

```bash
pnpm test
pnpm run build
```

MCP tests check the DCR → authorisation → PKCE → token → tools flow with
the ChatGPT and Claude callback URLs, two concurrent SDK HTTP clients, per-project
rights and stdio start-up outside the repository folder. Firebase is simulated
for these tests: they do not replace a signed-in test on the deployment.

After deployment, check the two documents `/.well-known/oauth-authorization-server`
and `/.well-known/oauth-protected-resource`, then install the connector in
each application and test `list_projects`, `select_project`, a read, then
a confirmed change. Also check that a change is refused with a
read-only key.

#### Available MCP tools

| Tool | Description |
|------|-------------|
| `get_ifc_scene_overview` | Full model summary (counts, GUID list) |
| `list_ifc_entities` | List by IFC type and/or level |
| `get_element_properties` | Properties of an element (by ID or GlobalId) |
| `create_wall` | Create a wall (start_point, end_point, height, thickness) |
| `update_wall` | Change an existing wall |
| `create_door` | Create a door on a wall (wall_id, position, width, height) |
| `create_window` | Create a window on a wall |
| `create_space` | Create a room (polygon, height, name) |
| `delete_element` | Delete one or more elements |
| `export_ifc` | Export the model as IFC4 STEP |

---

## IFC import / export

- **Import**: "Import IFC" button or drag-and-drop an `.ifc` file — IFC2x3 and IFC4 compatible.
- **Export**: "Export IFC" button in the toolbar — generates a valid IFC4 file.
- **Round-trip check**: "Check" button — checks that each exported entity keeps its GlobalId and name. Detailed results in the browser console.

---

## Project structure

```
SkAItch/
├── public/
│   └── wasm/              # web-ifc WASM files (served statically)
├── server/
│   └── mcp-server.ts      # Local Node.js MCP server (stdio)
├── src/
│   ├── components/        # React components (Canvas2D, Canvas3D, panels…)
│   ├── hooks/             # useItems, useProjects, useMcpBridge…
│   ├── lib/               # importIFC, exportIFC, roundTripCheck
│   ├── types/             # IFC4 TypeScript interfaces
│   └── data/              # Initial data, i18n, utilities
├── vercel.json            # Vercel configuration
├── vite.config.ts         # Vite configuration
└── .env.example           # Environment variables template
```

### Connecting AI assistants

In Settings → MCP server, the "Connect my AI assistant" section offers
the Claude Desktop and Gemini CLI configurations and a guide for ChatGPT.
The files contain no personal key. Merge the `mcpServers` entries
with your existing configuration. The test button checks
authentication and a `list_projects` round trip with the editor open.
The OAuth connection must also be completed in the chosen assistant.

The MCP server uses Firebase Admin, unlike the browser. Add
`FIREBASE_SERVICE_ACCOUNT_JSON` to the Vercel server variables: JSON of a service
account of the same project as `VITE_FIREBASE_PROJECT_ID`, with the
`roles/datastore.user` role. Never prefix this variable with `VITE_`.
Firestore rules now forbid direct writes of models and settings; publish `firestore.rules` with this version. Then redeploy
the project serving the MCP URL. A missing server configuration or a failing
Firestore access returns HTTP 503, an invalid or revoked key HTTP 401.

### Placing objects through MCP

`list_object_types` lists the furniture of the built-in, personal and project libraries.
Use their `id` as `catalogue_id` in `create_furniture` or `update_furniture`.
The model's dimensions are applied before any explicit dimensions.

To place an object, `point` accepts `[x,y]` or the unique identifier/name of a marker
on the same storey. `anchor: "center"` puts its centre on that point; `offset: [dx,dy]`
adds an offset in metres along the plan axes. Without `anchor`, the point is
the lower-left corner of the footprint before rotation, to keep the existing behaviour.
Rotation is around the centre: `rotation` is in radians, positive
counter-clockwise. `facing_point` turns the model's visible front towards a point or a marker
(for the WC, the bowl is directed towards the target; its width axis is not the front).
`anchor: "back"` puts the back middle on `point`, to set a WC against the wall.

Example after listing the models and markers:

```json
{
  "catalogue_id": "MODEL_ID",
  "point": "Marker A",
  "anchor": "center",
  "offset": [0.5, 0],
  "facing_point": "Marker B"
}
```

Markers and offsets stay in real coordinates even with
`coordinates_in_pixels: true`; only coordinates given as arrays
are then converted from the calibrated image.

### Door direction

The built-in chat and MCP share the creation parameters. Prefer `hinge_point`
(point in metres or marker at the hinge) and `opening_towards` (point in the room
the leaf opens into). These references stay valid if the wall is drawn
the other way. `swing: left/right` names the hinge towards the start/end of the wall;
`side: 1/-1` names the wall's left normal/the opposite, not automatically inside/outside.
Width alone no longer decides whether a door is sliding.

The catalogue contains `door-garage-rolling` (roller) and `door-garage-sectional`
(sectional). Their representation has no leaf swing arc.

The built-in chat uses the same schemas and the same executor as MCP, including
when AI validation is disabled. A hinge given without `position`
now anchors the door on that reference (the centre is computed with the width),
instead of keeping the default position in the middle of the wall.
After a new version of the tools is published, reconnect the MCP plugin
to refresh its list and parameters.

### Stairs and vertical sections

Parametric stairs in five shapes, linking between storeys, configurable steps and guardrails, validated stair openings and building section. See the [stairs and sections guide](docs/escaliers.md) for commands and current limits.

In the 3D view, the **Current storey** and **All storeys** buttons (top right, left of the compass on desktop, top left on mobile) isolate a level or show the whole building at its real elevations. Type filters still apply.

### AI control of views and captures

The built-in chat and MCP share three tools: `get_view` reads the current framing,
`set_view` sets the 2D/3D view, the storey, `all_storeys`, framing (`fit`) and zoom
(`zoom_factor`, above 1 to come closer). In 2D, `center: [x,y]` is in metres
and `scale` in pixels/metre. In 3D, `preset` accepts `top`, `front`, `back`, `left`,
`right` or `isometric`; `position` and `target` use the coordinates
`[plan x, elevation, -plan y]` in metres.

Example: `set_view({view:"3d", all_storeys:true, fit:true, preset:"isometric"})`,
then `capture_view({})`. The JPEG capture (1024 pixels at most on the long side)
is returned as an MCP image with the dimensions and view parameters;
the chat can also analyse it. No external service receives an image automatically.
Remote background images must allow reading by the browser (CORS).
In 2D, all storeys are overlaid; only the current storey's background plan stays shown.
These tools need the editor open and read access to the project.
After deployment, reconnect the MCP client to refresh the tool list.

### Project names and application settings

Names are unique per account, ignoring case and extra spaces.
A conflict on creation, import, duplication or renaming adds a
numeric suffix (`House (2)`). A transactional Firestore registry reserves
names, including during simultaneous creations. Old duplicates are renamed
on the first load of the list, without changing project identifiers.

The home page's Settings button opens general preferences, AI,
MCP connections and shortcuts. Project settings (units, IFC export,
name, phase and coordinates) stay in the editor.

### Server BIM engines

IFC imports, IFC export and synchronisation, and round-trip
checks run through an authenticated API. Browser wrappers are
asynchronous; they no longer contain the engines. See
[the browser/server split and its limits](docs/architecture/bim-server.md).

Cloud AI calls (streamed chat, capabilities, models and render generation)
also go through an authenticated API. Ollama endpoints and explicitly local
compatible endpoints keep their direct access. See
[the AI transport and key management](docs/architecture/ai-server.md).

Cloud AI keys can be stored encrypted on the server. Settings
allow replacing them, deleting them and transferring old local keys
to the signed-in account. Configure `AI_VAULT_SECRET` and publish the Firestore rules
with the API before using this storage.

AI preferences can also be saved per account. Cloud MCP uses
these preferences and the saved model for `generate_visualization`; with
confirmation disabled, this render works with the browser closed. Requests with
confirmation are run by the server only after approval in the editor.


Chat prompts and continuations, generic IFC tools and
DXF and BIM JSON exports are computed on the server. PDF/PNG remain browser
captures. The fake DWG export was removed for lack of a native converter.
Large models are saved in compressed, atomic Firestore chunks;
transfer limits are detailed in
[the architecture documentation](docs/architecture/bim-server.md#exports-and-large-projects).

---

## License

SkAItch is free software, distributed under two licenses:

| Part | License |
|------|---------|
| `packages/core` (IFC model and domain logic) | [MPL-2.0](packages/core/LICENSE) |
| Everything else (apps, UI, plugins) | [AGPL-3.0-only](LICENSE) |

In short: you may reuse `packages/core` in any project, including proprietary ones,
as long as modifications to its files stay open. The application itself, including
when run as a network service, must stay open under the AGPL.

The licences cover the code, not the name: the **skAItch** name and logo are governed by
[TRADEMARK.md](TRADEMARK.md). A modified version that is redistributed or hosted for others
must use a different name.

Contact: skaitch@proton.me
