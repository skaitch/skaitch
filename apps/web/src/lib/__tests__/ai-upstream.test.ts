import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
vi.mock('node:https', () => ({ request: vi.fn() }));
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isPublicAddress, resolveAiTarget, upstreamFetch } from '../../../server/ai/upstream';
beforeEach(() => { vi.mocked(lookup).mockReset(); vi.mocked(request).mockReset(); });
it('rejects local, reserved, mapped, multicast and alternative-format private addresses', async () => {
  for (const ip of ['127.0.0.1','0.0.0.0','10.1.2.3','100.64.1.2','169.254.169.254','172.16.0.1','192.168.0.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::']) expect(isPublicAddress(ip), ip).toBe(false);
  for (const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
  for (const url of ['http://example.com', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://user:password@example.com', 'https://example.com:8443', 'https://example.com/#fragment']) await expect(resolveAiTarget(url)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('refuses domains with any private DNS answer', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }] as any);
  await expect(resolveAiTarget('https://mixed.example/chat')).rejects.toThrow('privée');
});
it('pins validated DNS results and returns redirects without following them', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any);
  vi.mocked(request).mockImplementation(((_url: URL, options: any, receive: any) => {
    expect(options.headers.cookie).toBeUndefined();
    options.lookup('provider.example', { all: true }, (_error: unknown, answers: any) => expect(answers).toEqual([{ address: '1.1.1.1', family: 4 }]));
    const req = new EventEmitter() as any;
    req.end = () => {
      const incoming = Object.assign(Readable.from(['redirect body']), { statusCode: 302, headers: { location: 'https://evil.example/', 'set-cookie': 'secret', 'content-type': 'text/plain' } });
      receive(incoming);
    };
    return req;
  }) as any);
  const response = await upstreamFetch('https://provider.example/chat', { headers: { Authorization: 'Bearer key' } });
  expect(response.status).toBe(302);
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(await response.text()).toBe('redirect body');
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
});

it('bounds upstream bodies and handles bodyless statuses without constructing invalid responses', async () => {
  vi.mocked(lookup).mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any);
  let status = 200;
  vi.mocked(request).mockImplementation(((_url: URL, _options: unknown, receive: any) => {
    const req = new EventEmitter() as any;
    req.end = () => receive(Object.assign(Readable.from(status === 200 ? [Buffer.alloc(16 * 1024 * 1024 + 1)] : []), { statusCode: status, headers: {} }));
    return req;
  }) as any);
  const large = await upstreamFetch('https://provider.example/chat');
  await expect(large.arrayBuffer()).rejects.toThrow('too large');
  status = 204;
  const empty = await upstreamFetch('https://provider.example/chat');
  expect(empty.status).toBe(204); expect(empty.body).toBeNull();
});

it('refuses a stored credential origin mismatch before resolving or connecting', async () => {
  await expect(upstreamFetch('https://evil.example/chat', { headers: { Authorization: 'Bearer hidden-key' } }, ['https://provider.example'])).rejects.toMatchObject({ status: 403 });
  expect(lookup).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
