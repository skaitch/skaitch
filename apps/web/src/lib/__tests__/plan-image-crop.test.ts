import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampImageCrop, cropPlanImage, imageCropFromPoints } from '@skaitch/ui/lib/planImageCrop';

afterEach(() => vi.unstubAllGlobals());

describe('plan image cropping', () => {
  it('selects the same pixels regardless of drag direction', () => {
    const expected = { x: 100, y: 250, width: 800, height: 400 };
    expect(imageCropFromPoints([100, 250], [900, 650], 1200, 800)).toEqual(expected);
    expect(imageCropFromPoints([900, 650], [100, 250], 1200, 800)).toEqual(expected);
    expect(imageCropFromPoints([100, 650], [900, 250], 1200, 800)).toEqual(expected);
  });

  it('clips a drag outside the image and rounds to whole source pixels', () => {
    expect(imageCropFromPoints([-50, 150.2], [1500, 900], 1200, 800)).toEqual({ x: 0, y: 150, width: 1200, height: 650 });
    expect(clampImageCrop({ x: 1190, y: 790, width: 100, height: 100 }, 1200, 800)).toEqual({ x: 1190, y: 790, width: 10, height: 10 });
    expect(imageCropFromPoints([1200, 800], [1200, 800], 1200, 800)).toEqual({ x: 1199, y: 799, width: 1, height: 1 });
  });

  it('rejects invalid dimensions instead of persisting an unusable plan', () => {
    expect(() => clampImageCrop({ x: NaN, y: 0, width: 10, height: 10 }, 1200, 800)).toThrow();
    expect(() => clampImageCrop({ x: 0, y: 0, width: 10, height: 10 }, 0, 800)).toThrow();
  });

  it('exports only the selected pixels at their original resolution', () => {
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => ({ drawImage })), toDataURL: vi.fn(() => 'data:image/png;base64,cropped') };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    const image = { naturalWidth: 1600, naturalHeight: 1200 } as HTMLImageElement;
    const result = cropPlanImage(image, { x: 800, y: 200, width: 600, height: 500 });
    expect(drawImage).toHaveBeenCalledWith(image, 800, 200, 600, 500, 0, 0, 600, 500);
    expect([canvas.width, canvas.height]).toEqual([600, 500]);
    expect(result).toEqual({ url: 'data:image/png;base64,cropped', w: 600, h: 500 });
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('supports the whole image and fails cleanly when the browser cannot export', () => {
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn() }), toDataURL: () => 'data:,' };
    vi.stubGlobal('document', { createElement: () => canvas });
    expect(imageCropFromPoints([0, 0], [640, 480], 640, 480)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    expect(() => cropPlanImage({ naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement, { x: 0, y: 0, width: 640, height: 480 })).toThrow('Image export failed');
  });
});
