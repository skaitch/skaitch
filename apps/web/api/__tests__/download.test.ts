import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import handler, { classify, resetDownloadCache } from '../download';

const asset = (name: string, id: number) => ({ name, size: 100 + id, url: `https://api.github.com/repos/o/r/releases/assets/${id}` });
const release = {
  tag_name: 'v0.4.0', name: 'v0.4.0 — test', published_at: '2026-11-15T10:00:00Z',
  assets: [
    asset('skAItch-0.4.0-win-x64.exe', 1),
    asset('skAItch-0.4.0-win-x64.exe.blockmap', 2),
    asset('skAItch-0.4.0-mac-arm64.dmg', 3),
    asset('skAItch-0.4.0-mac-x64.dmg', 4),
    asset('skAItch-0.4.0-linux-x86_64.AppImage', 5),
    asset('skAItch-0.4.0-linux-amd64.deb', 6),
    asset('skAItch-Survey-0.4.0.apk', 7),
  ],
};

function response() {
  const headers: Record<string, string> = {};
  return {
    headers, statusCode: 0, body: '',
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  resetDownloadCache();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GITHUB_TOKEN', 'secret-token');
  vi.stubEnv('GITHUB_REPO', 'o/r');
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/releases/latest')
    ? new Response(JSON.stringify(release), { status: 200 })
    : new Response(null, { status: 302, headers: { location: `https://objects.example/signed/${url.split('/').pop()}` } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('recognises installers and normalises their architecture', () => {
  expect(classify(asset('skAItch-0.4.0-linux-x86_64.AppImage', 5))).toMatchObject({ platform: 'linux', arch: 'x64', format: 'appimage' });
  expect(classify(asset('skAItch-0.4.0-win-x64.exe.blockmap', 2))).toBeNull();
  expect(classify(asset('skAItch-Survey-0.4.0.apk', 7))).toMatchObject({ platform: 'android', arch: 'arm64', format: 'apk' });
});

it('lists the installers of the latest release without exposing GitHub URLs', async () => {
  const res = response();
  await handler({ method: 'GET', url: '/api/download' }, res);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.version).toBe('v0.4.0');
  expect(body.installers).toHaveLength(6);
  expect(body.installers[0]).toEqual({ platform: 'windows', arch: 'x64', format: 'exe', name: 'skAItch-0.4.0-win-x64.exe', size: 101, url: '/download/windows?arch=x64&format=exe' });
  expect(res.body).not.toContain('api.github.com');
  expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/o/r/releases/latest', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }));
});

it.each([
  ['windows', {}, 1],
  ['mac', {}, 3],
  ['macos', { arch: 'x64' }, 4],
  ['linux', {}, 5],
  ['linux', { format: 'deb' }, 6],
  ['android', {}, 7],
])('redirects %s %o to the signed URL of asset %i', async (platform, extra, id) => {
  const res = response();
  const query = new URLSearchParams({ platform, ...extra });
  await handler({ method: 'GET', url: `/api/download?${query}` }, res);
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe(`https://objects.example/signed/${id}`);
  expect(res.headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
  expect(fetchMock).toHaveBeenLastCalledWith(`https://api.github.com/repos/o/r/releases/assets/${id}`, expect.objectContaining({
    redirect: 'manual', headers: expect.objectContaining({ Accept: 'application/octet-stream' }),
  }));
});

it('caches the release lookup between downloads', async () => {
  await handler({ method: 'GET', url: '/api/download?platform=linux' }, response());
  await handler({ method: 'GET', url: '/api/download?platform=windows' }, response());
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/releases/latest'))).toHaveLength(1);
});

it('reuses the signed URL instead of spending the token on every anonymous download', async () => {
  for (let i = 0; i < 10; i++) {
    const res = response();
    await handler({ method: 'GET', url: '/api/download?platform=linux' }, res);
    expect(res.headers.location).toBe('https://objects.example/signed/5');
  }
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/releases/assets/'))).toHaveLength(1);
});

it('never sends the token outside api.github.com nor redirects to a non-https URL', async () => {
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/releases/latest')
    ? new Response(JSON.stringify({ ...release, assets: [{ name: 'skAItch-0.4.0-win-x64.exe', size: 1, url: 'https://evil.example/asset' }] }), { status: 200 })
    : new Response(null, { status: 302, headers: { location: 'javascript:alert(1)' } }));
  let res = response();
  await handler({ method: 'GET', url: '/api/download?platform=windows' }, res);
  expect(res.statusCode).toBe(502);
  expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://evil.example'))).toBe(false);
  resetDownloadCache();
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/releases/latest')
    ? new Response(JSON.stringify(release), { status: 200 })
    : new Response(null, { status: 302, headers: { location: 'http://objects.example/plain' } }));
  res = response();
  await handler({ method: 'GET', url: '/api/download?platform=windows' }, res);
  expect(res.statusCode).toBe(502);
});

it('reports unknown platforms, missing installers and missing configuration', async () => {
  let res = response();
  await handler({ method: 'GET', url: '/api/download?platform=amiga' }, res);
  expect(res.statusCode).toBe(400);
  res = response();
  await handler({ method: 'GET', url: '/api/download?platform=linux&format=rpm' }, res);
  expect(res.statusCode).toBe(404);
  res = response();
  await handler({ method: 'POST', url: '/api/download' }, res);
  expect(res.statusCode).toBe(405);
  vi.stubEnv('GITHUB_TOKEN', '');
  res = response();
  await handler({ method: 'GET', url: '/api/download' }, res);
  expect(res.statusCode).toBe(503);
});

it.each([
  [401, 'invalid_token'],
  [403, 'forbidden'],
  [404, 'not_found'],
  [500, 'github_error'],
])('explains a GitHub %i answer on the release lookup as %s', async (status, reason) => {
  fetchMock.mockImplementation(async () => new Response('{}', { status }));
  const res = response();
  await handler({ method: 'GET', url: '/api/download' }, res);
  expect(res.statusCode).toBe(502);
  expect(res.json()).toMatchObject({ error: 'Release introuvable.', reason, githubStatus: status });
  expect(res.json().detail).toEqual(expect.any(String));
  expect(res.body).not.toContain('secret-token');
});

it('explains a request GitHub never received', async () => {
  fetchMock.mockRejectedValue(new TypeError('fetch failed'));
  const res = response();
  await handler({ method: 'GET', url: '/api/download' }, res);
  expect(res.statusCode).toBe(502);
  expect(res.json()).toMatchObject({ reason: 'network' });
});

it('ignores spaces and line breaks pasted around the token', async () => {
  vi.stubEnv('GITHUB_TOKEN', '  secret-token\n');
  await handler({ method: 'GET', url: '/api/download' }, response());
  expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }) }));
});

it('fails cleanly when GitHub does not return a signed URL', async () => {
  fetchMock.mockImplementation(async (url: string) => url.endsWith('/releases/latest')
    ? new Response(JSON.stringify(release), { status: 200 })
    : new Response('denied', { status: 404 }));
  const res = response();
  await handler({ method: 'GET', url: '/api/download?platform=windows' }, res);
  expect(res.statusCode).toBe(502);
  expect(res.headers.location).toBeUndefined();
});
