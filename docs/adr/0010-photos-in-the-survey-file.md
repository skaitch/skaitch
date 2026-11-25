# Survey photos travel in the survey file, without metadata

Photos are stored locally on the phone, then packed into the `.skaitch-survey` archive (`photos/` folder), re-encoded as JPEG at 2048 px at most; `survey.json` only holds their references and annotations. No server is needed, extending ADR 0006; future synchronisation carries the same content.

Policy for these interior photos, which may contain personal data: camera or gallery permission asked on first use only; EXIF metadata (GPS position, device) removed at import; deleting a survey deletes its photos; export warns that the file contains interior photos.

## Considered Options

- References only in the file, photos staying on the phone or in a cloud: lighter file, but the skAItch Survey tab would not see the photos without a server.
- Automatic purge of old surveys: set aside for now; deletion stays an explicit user action.
