import { expect, it } from 'vitest';
import { computeMcpModel } from '@skaitch/core/bim/mcpModel';
import { MCP_PLAN_MAX_SIDE, mcpPlanImageCalibration, mcpPlanImageSize, parsePixelSpace, planCalibrationFor } from '@skaitch/core/lib/planImage';
import { TOOLS } from '@skaitch/core/mcp-tools';

const plan = { url: 'data:image/png;base64,YWJj', w: 4000, h: 2000, scale: 0.005, x: 2, y: -3, rotation: 0 };
const items = {
  s: { id: 's', type: 'Storey', name: 'RDC', geom: { plan } },
} as any;
const toWorld = (u: number, v: number, c: { x: number; y: number; scale: number; h: number }) => [c.x + u * c.scale, c.y + (c.h - v) * c.scale];

it('derives the attached copy from the stored plan only', () => {
  expect(mcpPlanImageSize(plan)).toEqual({ w: MCP_PLAN_MAX_SIDE, h: 784 });
  expect(mcpPlanImageSize({ w: 800, h: 600 })).toEqual({ w: 800, h: 600 });
  const image = mcpPlanImageCalibration(plan);
  expect(image).toMatchObject({ w: 1568, h: 784, x: 2, y: -3, rotation: 0 });
  expect(image.scale * image.w).toBeCloseTo(plan.scale * plan.w);
  // The same physical point, measured on either image, lands on the same world coordinates.
  const ratio = image.w / plan.w;
  const [x1, y1] = toWorld(1000, 500, plan);
  const [x2, y2] = toWorld(1000 * ratio, 500 * ratio, image);
  expect(x2).toBeCloseTo(x1, 6);
  expect(y2).toBeCloseTo(y1, 2);
  expect(planCalibrationFor(plan)).toBe(plan);
  expect(planCalibrationFor(plan, 'image')).toEqual(image);
  expect(parsePixelSpace(undefined)).toBe('plan');
  expect(() => parsePixelSpace('screen')).toThrow('pixel_space');
});

it('converts tool pixels in the requested pixel space', () => {
  const wall = (args: Record<string, unknown>) => computeMcpModel('create_wall', {
    storey_id: 's', start_point: [0, 0], end_point: [784, 0], thickness: 0.2, height: 2.8, coordinates_in_pixels: true, ...args,
  }, items, 's', []);
  const added = (r: ReturnType<typeof wall>) => (r.changes.find(c => c.kind === 'add') as any).item.geom;
  const image = mcpPlanImageCalibration(plan);
  const onImage = added(wall({ pixel_space: 'image' }));
  expect([onImage.x1, onImage.y1]).toEqual(toWorld(0, 0, image));
  expect(onImage.x2).toBeCloseTo(toWorld(784, 0, image)[0]);
  const onPlan = added(wall({}));
  expect(onPlan.x2).toBeCloseTo(toWorld(784, 0, plan)[0]);
  expect(onImage.x2 - onImage.x1).toBeCloseTo((onPlan.x2 - onPlan.x1) * plan.w / image.w);
  expect(wall({ pixel_space: 'screen' }).result).toEqual({ error: 'pixel_space must be "plan" or "image".' });
});

it('exposes pixel_space wherever coordinates_in_pixels is accepted', () => {
  for (const tool of TOOLS as any[]) {
    const props = tool.inputSchema?.properties ?? {};
    if (props.coordinates_in_pixels) expect(props.pixel_space, tool.name).toMatchObject({ enum: ['plan', 'image'] });
  }
});
