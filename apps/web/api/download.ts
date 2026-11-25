/**
 * Desktop installers, served from the latest GitHub release of a private repository.
 *
 * GET /api/download                       → JSON list of the installers of the latest release.
 * GET /api/download?platform=windows|mac|linux[&arch=x64|arm64][&format=appimage|deb]
 *                                         → 302 to a short-lived signed URL of that installer.
 *
 * The server token never reaches the browser and the bytes never go through the function:
 * GitHub answers the asset request with a redirect to its own storage, which we hand back.
 */
export type Platform = 'windows' | 'mac' | 'linux';
export type Arch = 'x64' | 'arm64';
export interface Installer { platform: Platform; arch: Arch; format: string; name: string; size: number; api: string }
interface Release { tag: string; name: string; publishedAt: string; installers: Installer[] }

const CACHE_MS = 60_000;
const PLATFORMS: Record<string, Platform> = { windows: 'windows', win: 'windows', mac: 'mac', macos: 'mac', darwin: 'mac', linux: 'linux' };
const DEFAULT_ARCH: Record<Platform, Arch> = { windows: 'x64', mac: 'arm64', linux: 'x64' };
const DEFAULT_FORMAT: Partial<Record<Platform, string>> = { linux: 'appimage' };
const ARCHS: Record<string, Arch> = { x64: 'x64', x86_64: 'x64', amd64: 'x64', arm64: 'arm64', aarch64: 'arm64' };
// Matches the artifactName of apps/desktop/scripts/package.mjs: skAItch-${version}-${os}-${arch}.${ext}
const INSTALLER = /^skAItch-.+-(win|mac|linux)-([a-z0-9_]+)\.(exe|dmg|AppImage|deb)$/;

let cache: { at: number; repo: string; release: Release } | null = null;
// Signed storage URLs stay valid for a few minutes. Reusing one for LOCATION_TTL_S, here and at
// the edge (s-maxage), keeps anonymous traffic from spending the server token on every request.
const LOCATION_TTL_S = 60;
const locations = new Map<string, { at: number; url: string }>();

/** Recognises the installers among a release's assets; other files (blockmaps, notes…) are ignored. */
export function classify(asset: { name: string; size: number; url: string }): Installer | null {
  const match = INSTALLER.exec(asset.name);
  const arch = match && ARCHS[match[2]];
  if (!match || !arch) return null;
  return { platform: PLATFORMS[match[1]], arch, format: match[3].toLowerCase(), name: asset.name, size: asset.size, api: asset.url };
}

function github(token: string, accept = 'application/vnd.github+json') {
  return { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'skaitch-download' };
}

async function latestRelease(repo: string, token: string): Promise<Release> {
  if (cache && cache.repo === repo && Date.now() - cache.at < CACHE_MS) return cache.release;
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: github(token) });
  if (!response.ok) throw new Error(`GitHub ${response.status}`);
  const body = await response.json();
  const installers = (Array.isArray(body.assets) ? body.assets : []).map(classify).filter(Boolean) as Installer[];
  const release = { tag: String(body.tag_name), name: String(body.name || body.tag_name), publishedAt: String(body.published_at), installers };
  cache = { at: Date.now(), repo, release };
  return release;
}

/** Picks one installer; arch and format fall back to the most common choice for the platform. */
export function pick(installers: Installer[], platform: Platform, arch?: string, format?: string): Installer | undefined {
  const wantedArch = (arch && ARCHS[arch]) || DEFAULT_ARCH[platform];
  const candidates = installers.filter(installer => installer.platform === platform && installer.arch === wantedArch);
  const wantedFormat = format?.toLowerCase() || DEFAULT_FORMAT[platform];
  return candidates.find(installer => installer.format === wantedFormat) ?? (format ? undefined : candidates[0]);
}

export function resetDownloadCache() { cache = null; locations.clear(); }

/** Signed URL of an installer, from the cache or from GitHub. The token only goes to api.github.com. */
async function signedLocation(installer: Installer, token: string): Promise<string | null> {
  const cached = locations.get(installer.api);
  if (cached && Date.now() - cached.at < LOCATION_TTL_S * 1000) return cached.url;
  if (new URL(installer.api).origin !== 'https://api.github.com') return null;
  const asset = await fetch(installer.api, { headers: github(token, 'application/octet-stream'), redirect: 'manual' });
  const url = asset.status >= 300 && asset.status < 400 ? asset.headers.get('location') : null;
  if (!url || new URL(url).protocol !== 'https:') return null;
  locations.set(installer.api, { at: Date.now(), url });
  return url;
}

export default async function handler(req: any, res: any) {
  const send = (status: number, body: unknown, cacheControl = 'no-store') => {
    res.statusCode = status;
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); return send(405, { error: 'Méthode non autorisée.' }); }
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'pintorus/skAItch';
  if (!token) return send(503, { error: 'Téléchargements non configurés.' });

  const params = new URL(req.url ?? '/', 'http://download.local').searchParams;
  let release: Release;
  try { release = await latestRelease(repo, token); }
  catch { return send(502, { error: 'Release introuvable.' }); }

  const platformParam = params.get('platform');
  if (!platformParam) {
    return send(200, {
      version: release.tag,
      name: release.name,
      publishedAt: release.publishedAt,
      installers: release.installers.map(({ platform, arch, format, name, size }) => ({
        platform, arch, format, name, size,
        url: `/download/${platform}?arch=${arch}&format=${format}`,
      })),
    }, 'public, max-age=60');
  }

  const platform = PLATFORMS[platformParam.toLowerCase()];
  if (!platform) return send(400, { error: 'Plateforme inconnue (windows, mac ou linux).' });
  const installer = pick(release.installers, platform, params.get('arch') ?? undefined, params.get('format') ?? undefined);
  if (!installer) return send(404, { error: `Aucun installateur ${platform} dans ${release.tag}.` });

  let location: string | null = null;
  try { location = await signedLocation(installer, token); }
  catch { /* reported below */ }
  if (!location) return send(502, { error: 'Lien de téléchargement indisponible.' });
  res.statusCode = 302;
  // The browser must not keep it, the CDN may share it for the TTL (well inside the URL validity).
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${LOCATION_TTL_S}`);
  res.setHeader('Location', location);
  res.end();
}
