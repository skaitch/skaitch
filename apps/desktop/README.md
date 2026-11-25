# skAItch — desktop app (Electron)

```bash
pnpm desktop          # from the repository root (builds then starts the app)
pnpm --filter @skaitch/desktop test
```

## Languages

The same 11 languages as the online editor: French, English, German, Spanish,
Portuguese, Italian, Dutch, Arabic, Chinese, Japanese and Russian. Choose it from the
home page, the editor bar or **Settings → General**; Arabic is shown right to left.

## Installers

```bash
pnpm --filter @skaitch/desktop package            # current platform
pnpm --filter @skaitch/desktop package -- --linux # or --win, --mac
```

`scripts/package.mjs` copies `dist/` into `release/app` with a minimal `package.json`
(only runtime dependency: `web-ifc`), then runs electron-builder. The
installers land in `release/out`:

| Platform | File |
|---|---|
| Windows x64 | `skAItch-<version>-win-x64.exe` (NSIS) |
| macOS | `skAItch-<version>-mac-arm64.dmg`, `skAItch-<version>-mac-x64.dmg` |
| Linux x64 | `skAItch-<version>-linux-x86_64.AppImage`, `skAItch-<version>-linux-amd64.deb` |

The web server recognises files by this name: do not change `artifactName` without
updating `apps/web/api/download.ts`.

**Publishing**: push a `v*` tag (for example `git tag v0.4.1 && git push origin v0.4.1`).
The `.github/workflows/desktop-release.yml` workflow creates the release if it does not
exist, builds on Linux, Windows and macOS, then attaches the installers. For an
existing release, run the workflow by hand with the tag name. The site then offers them
in **About** and under `/download/windows|mac|linux`.

Current limits:

- **No code signing.** Windows shows SmartScreen ("More info
  → Run anyway"). On macOS, Gatekeeper blocks the downloaded
  app: right-click → **Open**, or `xattr -dr com.apple.quarantine /Applications/skAItch.app`.
- **Icon**: `build/icon.png` (1024 px, exported from `build/icon.svg`, the same
  logo as `apps/site/public/brand/`). electron-builder derives every platform format from it;
  `scripts/build-electron.mjs` copies it next to `main.js` for the window icon.
- No automatic update: the installer has to be downloaded again.

## Local MCP server

While the app is open, an MCP client (Claude Code, Claude Desktop…) can read
and change the open project. There is no account: the server only listens on the
machine, at an address that contains a secret token specific to this installation:

```
http://127.0.0.1:3923/mcp/<token>
```

Copy the exact URL from **Settings → MCP server**: it is shown there with
ready-to-paste commands. The token is kept in the `mcp-local-token` file in the
app's data folder; delete it to revoke all configured
clients (a new token is created at the next start).

The transport is MCP's **Streamable HTTP**. Requests without the token, coming from a
web page (foreign `Origin` header) or from a host name other than `127.0.0.1` or
`localhost` are refused. The token prevents other programs and accounts on the machine
from accessing your projects.

### Declaring the server

**Claude Code**

```bash
claude mcp add --transport http skaitch-desktop http://127.0.0.1:3923/mcp/<token>
```

**Claude Desktop** only speaks stdio: go through the `mcp-remote` relay, in
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "skaitch-desktop": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:3923/mcp/<token>"]
    }
  }
}
```

Any other client that accepts an MCP URL over HTTP works.

**ChatGPT desktop and Codex** share the `~/.codex/config.toml` file. The ChatGPT
app runs them locally and therefore reaches `127.0.0.1` directly, without a tunnel:

```bash
codex mcp add skaitch-desktop --url http://127.0.0.1:3923/mcp/<token>
```

Then add a timeout long enough to confirm changes in skAItch:

```toml
[mcp_servers.skaitch-desktop]
url = "http://127.0.0.1:3923/mcp/<token>"
tool_timeout_sec = 130
```

You can also use the ChatGPT desktop interface: Settings → MCP servers →
Streamable HTTP server. Beware: `codex mcp add` rewrites and reorders
`config.toml`. The content stays the same, but make a copy if you care about it.

### Usage

1. `list_projects` lists the projects of the library, even from the home page.
2. `select_project(project_id)` opens the project in the editor.
3. The other tools act on the open project. Without an open project, they
   ask to call `select_project`.

Each change (creation, update, deletion) shows as a preview in
the editor and waits for **Accept** or **Refuse**. A request without an answer expires after
120 s. Once accepted, the change is saved in the project's
`.skaitch` file. `generate_visualization` is not available on the desktop.

Calls are handled one by one: a second call waits for the first to be accepted,
refused or expired. Set your client's tool timeout to at least
120 s. If the client gives up earlier, its request stays shown until it expires,
and accepting it applies a change whose result the client will not get.

### ChatGPT web and other remote clients (tunnel)

ChatGPT on the web calls MCP servers from OpenAI's cloud: it needs a public HTTPS
URL. Remote access is **disabled by default**. To open it:

1. Start a tunnel to the local server, for example:
   ```bash
   cloudflared tunnel --url http://127.0.0.1:3923
   ```
   Note the public host name shown (`xxxx.trycloudflare.com`).
2. Restart the app with this host name:
   ```bash
   SKAITCH_MCP_REMOTE_HOST=xxxx.trycloudflare.com pnpm desktop
   ```
3. The app writes the secret URL (`https://xxxx.trycloudflare.com/mcp/<token>`) into the
   `mcp-remote-url.txt` file in the app's data folder. The exact path
   is shown in the console. Give this URL to ChatGPT (developer mode → new
   MCP app, without authentication).

While access is open, a red banner stays visible in the app. Anyone
who knows the URL can read your projects and propose changes, which still need
confirming in the app. To cut access, restart the app without
`SKAITCH_MCP_REMOTE_HOST`. To revoke the URL, delete the `mcp-remote-token` file
in the same folder: a new token is created at the next start.

Only requests arriving with this host name **and** the right token are accepted.
The token is in the URL because clients like ChatGPT do not send a
custom header. Local clients keep their `http://127.0.0.1:3923/mcp/<token>` URL (separate local token).
ChatGPT may give up a call before you have confirmed the change. Confirm
quickly, or run the command again.

### Environment variables

| Variable | Role |
|---|---|
| `SKAITCH_MCP_PORT` | MCP server port (default `3923`). If the port is taken, the app starts without MCP and says so in the console. |
| `SKAITCH_MCP_REMOTE_HOST` | Opens remote access for this tunnel host name (see above). |
| `SKAITCH_LIBRARY_DIR` | Project library folder (default `Documents/skAItch`). |
| `SKAITCH_USER_DATA` | Electron data folder. Useful for testing. |

### How it works

- `electron/mcpServer.ts`: stateless MCP server on 127.0.0.1. It answers
  `list_projects` itself from the library and forwards the other tools to the window.
- `electron/rendererCalls.ts`: sends calls to the window over IPC (`mcp:call`) and
  waits for its answer (`mcp:reply`). A reload or a close cancels the calls
  in progress.
- `renderer/src/useDesktopAssistant.ts` and `mcpDispatch.ts`: run the tool with
  the shared executor `@skaitch/ui/hooks/useMcpExecutor`, the same as the web version,
  which handles the confirmation request.
