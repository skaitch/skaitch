# Versions

The release is defined in `apps/web/package.json`. Bump the patch for a fix, the minor for a feature and the major for a compatibility break.

`pnpm run build` generates `build-info.json` before compiling, with the release, the ISO UTC timestamp and an identifier `YYMMDD.HHmmss-commit` (example: `261111.221500-2262e19abcd12`). The commit comes from Vercel or from local Git; without Git, the suffix is `local`. Each build regenerates this identifier.

This file is embedded in the application and the server functions. The versioned file is the initial value for development; it is replaced during a build.

"About" shows the release and full build of the application and queries `/api/version` for those of the server. This public route also returns `compiledAt` and forbids caching. MCP exposes the same values in `X-Skaitch-Release`, `X-Skaitch-Build` and announces `release+build` during cloud initialisation.
