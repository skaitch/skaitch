import { Color, type Material } from 'three';

export function highlightMaterial(material: Material | Material[], selected: boolean): void {
  for (const mat of Array.isArray(material) ? material : [material]) {
    // Background plans use MeshBasicMaterial, which has no emissive color.
    if (!('emissive' in mat) || !(mat.emissive instanceof Color)) continue;
    mat.emissive.setHex(selected ? 0x3366ff : 0x000000);
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = selected ? 0.5 : 0;
  }
}
