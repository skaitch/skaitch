import { expect, it } from 'vitest';
import { MeshBasicMaterial, MeshPhongMaterial } from 'three';
import { highlightMaterial } from '@skaitch/ui/lib/highlightMaterial';

it('supports background plans and material arrays while highlighting selectable meshes', () => {
  const plan = new MeshBasicMaterial({ color: 0xffffff });
  const wall = new MeshPhongMaterial();
  expect(() => highlightMaterial(plan, true)).not.toThrow();
  highlightMaterial([plan, wall], true);
  expect(plan.color.getHex()).toBe(0xffffff);
  expect(wall.emissive.getHex()).toBe(0x3366ff);
  expect(wall.emissiveIntensity).toBe(0.5);
  highlightMaterial([plan, wall], false);
  expect(wall.emissive.getHex()).toBe(0);
  expect(wall.emissiveIntensity).toBe(0);
  plan.dispose(); wall.dispose();
});
