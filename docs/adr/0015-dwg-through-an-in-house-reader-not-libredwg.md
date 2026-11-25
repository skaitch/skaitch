# DWG through an in-house reader, not LibreDWG

DWG files will be read by our own converter to DXF, to be written later, feeding the existing DXF import. LibreDWG is not integrated, neither compiled to WASM in the apps nor bundled as a library. LibreDWG is GPL-3.0 and its copyright belongs to the FSF. Linking it into the apps would make every distributed version a combined work under its terms. We could no longer relicense the apps (permissive, proprietary or dual commercial licensing) without first removing it from them. Until the in-house reader exists, users import DWG drawings by saving them as DXF from their CAD software.

## Considered Options

- LibreDWG compiled to WASM on the client: rejected because of the licensing lock-in above, although it would have worked offline on web and desktop alike.
- LibreDWG's `dwg2dxf` as a separate process (desktop) or service (web): it keeps the licences apart, but adds an external dependency to install or host. It stays a fallback if the in-house reader is delayed.
- ODA File Converter: proprietary, installed separately, and not usable on a server without a contract.
