# skAItch Survey

Offline mobile survey app (ADR 0006, ADR 0007). It produces a **survey file** (`.skaitch-survey`) imported in a storey's Survey tab in skAItch, or sends it to the skAItch account once paired (ADR 0011).

## Languages

The same 11 languages as skAItch: French, English, German, Spanish, Portuguese, Italian,
Dutch, Arabic, Chinese, Japanese and Russian. The app follows the phone's language (English
when skAItch has not got it); another one can be chosen in the app settings (⋯ on the home
screen) or the survey menu's Settings. Arabic is shown right to left. Room, wall and level
names typed in a survey stay as typed.

Texts are written in French and English in the code, `tr(fr, en)`; the other languages come
from `packages/core/src/survey/i18n/<lang>.ts`, keyed by the English text. After adding or
changing a text, list what each table lacks:

```bash
node apps/survey/scripts/extract-survey-strings.mjs --missing
```

## Development (browser)

```bash
pnpm --filter @skaitch/survey dev   # http://localhost:5175
```

## Android / iOS

The Capacitor CLI requires Node ≥ 22 (the repository uses Node 26).

```bash
pnpm --filter @skaitch/survey cap:sync   # web build + copy into android/ and ios/
pnpm --filter @skaitch/survey android    # opens Android Studio (Android SDK required)
pnpm --filter @skaitch/survey ios        # opens Xcode (macOS required)
```

The `android/` and `ios/` folders are versioned; `dist/` is not.

## Storage

Surveys are saved to IndexedDB on every edit, with their format version, and migrated when read. Photos are stored apart, re-encoded without EXIF (ADR 0010). Export goes through the phone's share sheet (Filesystem + Share) or a download in a browser.

## Sending to skAItch

Optional. In skAItch, a storey's Survey tab › "Pair a phone" creates a pairing key; paste it in the app (Export › Pair with skAItch). The key only allows sending surveys to that account and can be revoked from skAItch.
