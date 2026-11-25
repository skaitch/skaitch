import { afterEach, expect, it, vi } from 'vitest';
import { captureCanvas, MCP_PLAN_MAX_SIDE, shrinkFloorplanResult, validateViewRequest } from '@skaitch/ui/lib/viewport';
import { mcpToolResult } from '@skaitch/core/lib/mcpToolResult';

afterEach(() => vi.unstubAllGlobals());
it('validates viewport controls before applying them', () => {
  expect(validateViewRequest({ view: '2d', center: [3, -2], scale: 50, all_storeys: true })).toMatchObject({ scale: 50 });
  expect(validateViewRequest({ view: '3d', preset: 'top', position: [1,2,3], fit: true, zoom_factor: 2 })).toHaveProperty('preset', 'top');
  for (const args of [{ view: 'invalid' }, { scale: 0 }, { scale: Infinity }, { zoom_factor: -1 }, { center: [NaN, 0] }, { position: [1, 2] }, { preset: 'unknown' }, { fit: 'true' }, { all_storeys: 1 }, { storey_id: 2 }, { unsupported: 1 }]) {
    expect(() => validateViewRequest(args)).toThrow();
  }
});

it('returns native MCP images without duplicating capture bytes in text', () => {
  const result = mcpToolResult({ view: '3d', image_width: 1024, image_url: 'data:image/jpeg;base64,YWJj' });
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify({ view: '3d', image_width: 1024 }, null, 2) },
    { type: 'image', mimeType: 'image/jpeg', data: 'YWJj' },
  ]);
  expect(mcpToolResult({ plan: { url: 'data:image/png;base64,YWJj' } }).content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(mcpToolResult({ error: 'Capture failed' })).toHaveProperty('isError', true);
});

it('bounds captures for the remote transport and reports failures', () => {
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn().mockReturnValueOnce('x'.repeat(700_001)).mockReturnValue('data:image/jpeg;base64,YWJj') };
  vi.stubGlobal('document', { createElement: () => canvas });
  const source = { width: 2400, height: 1200 } as HTMLCanvasElement;
  expect(captureCanvas(source)).toContain('data:image/jpeg');
  expect([canvas.width, canvas.height]).toEqual([1024, 512]);
  expect(canvas.toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.65);
  canvas.toDataURL.mockReturnValue('x'.repeat(700_001));
  expect(() => captureCanvas(source)).toThrow('size limit');
  expect(() => captureCanvas({ width: 0, height: 0 } as HTMLCanvasElement)).toThrow('drawable size');
  canvas.toDataURL.mockImplementation(() => { throw new Error('Tainted canvas'); });
  expect(() => captureCanvas(source)).toThrow('Tainted canvas');
});

it('sends floor plan bytes only once, in the image block', () => {
  const result = mcpToolResult({ storey_id: 's', hasPlan: true, plan: { url: 'data:image/png;base64,YWJj', w: 10, h: 5, scale: 0.1, x: 0, y: 0 } });
  expect(result.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'YWJj' });
  expect(result.content[0].text).not.toContain('YWJj');
  expect(JSON.parse(result.content[0].text).plan).toEqual({ w: 10, h: 5, scale: 0.1, x: 0, y: 0 });
  expect(JSON.parse(mcpToolResult({ hasPlan: false }).content[0].text)).toEqual({ hasPlan: false });
});

it('downscales floor plans for MCP while keeping world placement', async () => {
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,QUJD') };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('Image', class { naturalWidth = 4000; naturalHeight = 2000; src = ''; decode() { return Promise.resolve(); } });
  const plan = { url: 'data:image/png;base64,YWJj', w: 4000, h: 2000, scale: 0.01, x: 2, y: -3, rotation: 0 };
  const shrunk = await shrinkFloorplanResult({ storey_id: 's', plan });
  expect([canvas.width, canvas.height]).toEqual([MCP_PLAN_MAX_SIDE, 784]);
  expect(shrunk.plan).toEqual({ ...plan, url: 'data:image/jpeg;base64,QUJD' });
  expect(shrunk.image).toMatchObject({ w: 1568, h: 784, x: 2, y: -3, downscaled: true });
  expect(shrunk.image.note).toContain('pixel_space: "image"');
  expect(shrunk.image.scale * shrunk.image.w).toBeCloseTo(plan.scale * plan.w);
  expect(await shrinkFloorplanResult({ hasPlan: false })).toEqual({ hasPlan: false });
});

it('returns generated images as native MCP content without duplicating the image in JSON text', () => {
  const result = mcpToolResult({ success: true, type: 'image', url: 'data:image/png;base64,YWJj', prompt: 'House' });
  expect(result.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'YWJj' });
  expect(JSON.parse(result.content[0].text)).toEqual({ success: true, type: 'image', prompt: 'House' });
  expect(mcpToolResult({ success: true, url: 'https://image.example/render.png' }).content[0].text).toContain('https://image.example/render.png');
});
