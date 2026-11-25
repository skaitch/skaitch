# The survey is sent to the web account, without two-way synchronisation

Beyond sharing the survey file by hand, the Survey app offers "Send to skAItch": it uploads the **survey file as is** (the same content as the export, ADR 0006 and 0010) to the user's web account, resuming an interrupted upload. Each send is a new revision of the survey; concurrent edits are never merged. In the web editor, a storey's Survey tab lists the received surveys and imports them like a file.

The account is **optional**: without it, the app is fully usable offline with file export; pairing only enables sending. The desktop app without an account keeps importing survey files.

The app pairs with a **pairing key** created in the web editor and pasted in the app. The key only allows sending surveys to that account (no MCP or project access), is stored hashed on the server, and can be revoked.

## Considered Options

- Two-way synchronisation (survey stored on the server, edited from several devices, conflicts resolved): rejected for now, high cost (offline, merges, mandatory account) without a proven need for co-editing.
- No synchronisation: sharing the file by hand remains possible, but sending directly avoids handling files on a phone.
- Mandatory account in the app: rejected, it would block on-site use without an account.
- Firebase sign-in in the app (email or Google): familiar, but native Google sign-in needs a Capacitor plugin and per-platform configuration; a scoped pairing key is simpler and narrower.

## Addendum — desktop app on the local network

The desktop app has no account, so it receives surveys itself: `electron/surveyReceiver.ts` serves
the same upload protocol (`/api/survey`, operations `upload-status`, `upload-chunk`,
`upload-finish`, plus `hello`) on port 3924 (next free port otherwise), on every interface. The
inbox logic is shared with the web API (`@skaitch/core/survey/inbox`), stored as files under the
app's user data with a single local owner (`sv_local_…` keys).

The phone finds the computer with a **QR code**, shown when a pairing key is created
(`skaitch-survey:pair?servers=http://ip:port,…&key=sv_…&name=<computer>`): it lists every local
IPv4 address, and the Survey app keeps the first that answers `hello` with the key. The web editor
shows the same QR code with its own HTTPS origin. Discovery by mDNS was not kept: often blocked on
public or corporate Wi-Fi, and it needs a native plugin.

Plain HTTP is accepted only for private addresses (10/8, 172.16/12, 192.168/16, localhost); the
key still authenticates every request, and the computer's firewall must allow skAItch.
