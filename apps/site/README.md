# skAItch — presentation site

Static showcase site (no build, no dependencies): presentation, downloads, videos, GitHub link.
Everything served is in `public/`.

## Local preview

```bash
python3 -m http.server 5180 --directory apps/site/public
```

## Updating content

Edit `public/config.js` only:

| Need | Setting |
|---|---|
| Repository goes public | `github.public = true` (check `github.url`) |
| Desktop installers published | `downloads.ready = true`; optionally `downloads.releasesUrl` |
| Survey app published | `survey.android` / `survey.ios` store or APK URL |
| Video ready | set `youtube` to the video ID of the matching entry in `videos` |

New video: add `{ key, youtube }` to `videos` and its `videos.<key>.t` / `videos.<key>.d`
strings in both languages of `public/i18n.js`. Page text is French in `index.html`;
its English version lives in `public/i18n.js` under the same `data-i18n` key.

Videos are embedded from YouTube (youtube-nocookie, loaded on click), not hosted here:
the Vercel Hobby plan has bandwidth limits.

## Deploying on Vercel (Hobby)

This is a **separate Vercel project** from the editor. Never run `vercel` for it from
the repository root: the root is linked to the editor project.

1. Vercel → *Add New Project* → import the repository.
2. **Root Directory**: `apps/site`. Framework preset: *Other*. `vercel.json` disables
   install and build and serves `public/`.
3. Deploy. `ignoreCommand` skips rebuilds when a commit does not touch `apps/site`.

Or from the CLI: `cd apps/site && vercel link && vercel --prod`.

Once the final domain is known, put absolute URLs in the `og:image` meta and add a
`<link rel="canonical">` in `index.html`.

## Brand

`public/brand/` holds the logo (speech bubble containing a floor plan):
`skaitch-mark.svg` (mark alone, transparent), `skaitch-icon.svg` (app icon on navy) and
its PNG exports (1024, 512, 192, favicon 32). Colours: navy `#0D2B4A`, amber `#FFB000`.
