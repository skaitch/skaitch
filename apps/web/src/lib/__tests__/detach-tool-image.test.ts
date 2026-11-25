import { describe, expect, it } from 'vitest';
import { DETACHED_IMAGE, detachToolImage } from '@skaitch/core/lib/detachToolImage';

const big = (type = 'jpeg') => `data:image/${type};base64,${'A'.repeat(5000)}`;

describe('detachToolImage', () => {
  it('moves the floor plan image out of get_storey_floorplan results', () => {
    const url = big();
    const { result, image } = detachToolImage({ plan: { url, w: 800, h: 600, scale: 0.01 }, image: { w: 400, h: 300 } });
    expect(image).toBe(url);
    expect(result).toEqual({ plan: { url: DETACHED_IMAGE, w: 800, h: 600, scale: 0.01 }, image: { w: 400, h: 300 } });
    expect(JSON.stringify(result).length).toBeLessThan(200);
  });

  it('handles capture_view and keeps only the first image', () => {
    const first = big('png'), second = big();
    const { result, image } = detachToolImage({ image_url: first, extra: [second] });
    expect(image).toBe(first);
    expect(result).toEqual({ image_url: DETACHED_IMAGE, extra: [DETACHED_IMAGE] });
  });

  it('leaves ordinary results and small data URLs untouched', () => {
    const icon = 'data:image/png;base64,AAAA';
    const value = { id: 'wall_1', success: true, icon, text: 'x'.repeat(5000) };
    expect(detachToolImage(value)).toEqual({ result: value, image: null });
    expect(detachToolImage(null)).toEqual({ result: null, image: null });
  });
});
