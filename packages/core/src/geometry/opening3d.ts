import * as THREE from 'three';
import type { IfcDoorEntity, IfcWindowEntity } from '../types/ifc.js';
import { openingSwing } from '../lib/openingOrientation.js';

/**
 * 3D model of a door or window (frame, leaves, glazing, hardware), as the editor's 3D view draws it.
 * Shared with the IFC export so both show the same geometry (ADR 0002).
 *
 * Local frame (three.js, Y up): origin at the centre of the opening at mid-height, X along the
 * host wall's drawing direction, Z towards the wall's right side. Callers place and rotate it.
 * Returns null for a passage without a leaf (OperationType NONE). No DOM or WebGL.
 */
export function buildOpeningModel(item: IfcDoorEntity | IfcWindowEntity, wallThickness: number): THREE.Group | null {
  const { width, height } = (item as any).geom;
  const wThick = wallThickness;
  const op = ((item as any).OperationType || '').toUpperCase();
  if (op === 'NONE') return null; // Passage without a door leaf; the host wall still gets its void.
  const upperName = String((item as any).name || (item as any).Name || '').toUpperCase();
  const isDouble = op.includes('DOUBLE') || upperName.includes('DBL');
  const isGlassSlidingDoor = item.type === 'Door' && (op.includes('SLIDING') || op.includes('BAY') || upperName.includes('COULISS') || upperName.includes('BAIE') || upperName.includes('VITR') || upperName.includes('GLASS'));
  const isWin = item.type === 'Window' || isGlassSlidingDoor;

  const groupObj = new THREE.Group();

  const frameThick = 0.05;
  const frameDepth = wThick + 0.03;
  const frameMat = new THREE.MeshPhongMaterial({ color: 0x2d3238, flatShading: true }); // Slate grey frame
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x88ccee, transparent: true, opacity: 0.3, flatShading: true });
  const doorMat = new THREE.MeshPhongMaterial({ color: 0x6a4f3b, flatShading: true }); // Warm natural oak leaf

  if (isWin) {
    const rawName = String((item as any).name || (item as any).Name || '').toUpperCase();
    const matName = String((item as any).Material || (item as any).material || '').toUpperCase();
    const isSliding = op.includes('SLIDING') || op.includes('BAY') || rawName.includes('BAIE') || rawName.includes('COULISS');
    const isFixed = op.includes('FIXED') || rawName.includes('FIXE') || rawName.includes('FIXED');
    const isTiltTurn = op.includes('TILT') || op.includes('TURN') || rawName.includes('OSCILLO') || rawName.includes('BATTANT');
    const isDoubleWin = isDouble || op.includes('DOUBLE') || rawName.includes('DOUBLE') || rawName.includes('2V');
    const isWood = matName.includes('BOIS') || matName.includes('WOOD');
    const isDark = matName.includes('ANTHR') || matName.includes('NOIR') || matName.includes('BLACK');
    const frameColor = isWood ? 0xb47a3c : isDark ? 0x2f3438 : 0x3a3f45;
    const frameMatWin = new THREE.MeshStandardMaterial({ color: frameColor, roughness: isWood ? 0.5 : 0.28, metalness: isWood ? 0.05 : 0.45 });
    const sealMat = new THREE.MeshStandardMaterial({ color: 0x1f2428, roughness: 0.75, metalness: 0.05 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.22, metalness: 0.75 });
    const glassPhys = new THREE.MeshPhysicalMaterial({
      color: 0x9fd4f0,
      roughness: 0.04,
      metalness: 0,
      transmission: 0.55,
      transparent: true,
      opacity: 0.34,
      thickness: 0.035,
      ior: 1.45,
      clearcoat: 0.7,
      clearcoatRoughness: 0.06,
      side: THREE.DoubleSide,
    });

    const addBox = (name: string, sx: number, sy: number, sz: number, x = 0, y = 0, z = 0, mat: THREE.Material = frameMatWin) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.005, sx), Math.max(0.005, sy), Math.max(0.005, sz)), mat);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.castShadow = mat !== glassPhys;
      mesh.receiveShadow = true;
      groupObj.add(mesh);
      return mesh;
    };
    const addPanel = (panelW: number, panelH: number, x: number, z: number, openAngle = 0, hinge: 'left' | 'right' | 'none' = 'none') => {
      const panel = new THREE.Group();
      panel.position.set(x, 0, z);
      if (hinge !== 'none') {
        panel.position.x += hinge === 'right' ? panelW / 2 : -panelW / 2;
        panel.rotation.y = openAngle;
      }
      const localX = hinge === 'none' ? 0 : (hinge === 'right' ? -panelW / 2 : panelW / 2);
      const rail = Math.min(0.055, Math.max(0.035, panelW * 0.045));
      const depth = Math.max(0.045, frameDepth * 0.42);
      const glassW = Math.max(0.05, panelW - rail * 2.2);
      const glassH = Math.max(0.05, panelH - rail * 2.2);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH, 0.018), glassPhys);
      glass.position.set(localX, 0, 0);
      panel.add(glass);
      const pieces: [number, number, number, number, number, number][] = [
        [panelW, rail, depth, localX, panelH / 2 - rail / 2, 0],
        [panelW, rail, depth, localX, -panelH / 2 + rail / 2, 0],
        [rail, panelH, depth, localX - panelW / 2 + rail / 2, 0, 0],
        [rail, panelH, depth, localX + panelW / 2 - rail / 2, 0, 0],
      ];
      for (const [sx, sy, sz, px, py, pz] of pieces) {
        const piece = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMatWin);
        piece.position.set(px, py, pz);
        piece.castShadow = piece.receiveShadow = true;
        panel.add(piece);
      }
      groupObj.add(panel);
      return panel;
    };

    const outer = Math.min(0.085, Math.max(0.045, Math.min(width, height) * 0.06));
    addBox('window-head', width, outer, frameDepth, 0, height / 2 - outer / 2, 0);
    addBox('window-sill-frame', width, outer, frameDepth, 0, -height / 2 + outer / 2, 0);
    addBox('window-left-jamb', outer, height, frameDepth, -width / 2 + outer / 2, 0, 0);
    addBox('window-right-jamb', outer, height, frameDepth, width / 2 - outer / 2, 0, 0);
    addBox('window-gasket-top', width - outer * 1.5, 0.012, frameDepth + 0.012, 0, height / 2 - outer - 0.01, 0, sealMat);
    addBox('window-gasket-bottom', width - outer * 1.5, 0.012, frameDepth + 0.012, 0, -height / 2 + outer + 0.01, 0, sealMat);
    addBox('exterior-sill', width + 0.24, 0.055, frameDepth + 0.20, 0, -height / 2 - 0.055, 0.03, new THREE.MeshStandardMaterial({ color: 0xc8c9c7, roughness: 0.55, metalness: 0.05 }));

    const innerW = Math.max(0.1, width - outer * 2);
    const innerH = Math.max(0.1, height - outer * 2);
    if (isSliding) {
      addPanel(innerW / 2 + 0.015, innerH, -innerW / 4, -0.015, 0, 'none');
      addPanel(innerW / 2 + 0.015, innerH, innerW / 4, 0.015, 0, 'none');
      addBox('sliding-handle-left', 0.025, 0.18, 0.032, -0.08, -0.04, -frameDepth * 0.48, handleMat);
      addBox('sliding-handle-right', 0.025, 0.18, 0.032, 0.08, -0.04, -frameDepth * 0.48, handleMat);
    } else if (isDoubleWin) {
      const side = Number((item as any).geom.side ?? 1) >= 0 ? 1 : -1;
      const open = isFixed ? 0 : side * Math.PI / 10;
      addPanel(innerW / 2, innerH, -innerW / 4, 0.01, open, 'left');
      addPanel(innerW / 2, innerH, innerW / 4, -0.01, -open, 'right');
      addBox('double-left-handle', 0.025, 0.18, 0.032, -0.08, -0.04, -frameDepth * 0.48, handleMat);
      addBox('double-right-handle', 0.025, 0.18, 0.032, 0.08, -0.04, -frameDepth * 0.48, handleMat);
    } else if (isFixed) {
      const glass = new THREE.Mesh(new THREE.BoxGeometry(innerW, innerH, 0.02), glassPhys);
      groupObj.add(glass);
    } else {
      const side = Number((item as any).geom.side ?? 1) >= 0 ? 1 : -1;
      const hinge = ((item as any).geom.swing || '').toLowerCase() === 'right' ? 'right' : 'left';
      const open = (hinge === 'right' ? -1 : 1) * side * (isTiltTurn ? Math.PI / 8 : Math.PI / 12);
      addPanel(innerW, innerH, 0, 0, open, hinge);
      const handleX = hinge === 'right' ? -innerW * 0.36 : innerW * 0.36;
      addBox('casement-handle', 0.028, 0.20, 0.035, handleX, -0.05, -frameDepth * 0.5, handleMat);
      if (isTiltTurn) addBox('tilt-vent-line', innerW * 0.7, 0.018, 0.025, 0, innerH * 0.32, -frameDepth * 0.48, sealMat);
    }
  } else {
    // ── Porte : cadre + panneau ──
    // Cadre haut
    const tf = new THREE.Mesh(new THREE.BoxGeometry(width, frameThick, frameDepth), frameMat);
    tf.position.y = height / 2 - frameThick / 2;
    groupObj.add(tf);
    // Cadre gauche
    const lf = new THREE.Mesh(new THREE.BoxGeometry(frameThick, height, frameDepth), frameMat);
    lf.position.x = -width / 2 + frameThick / 2;
    groupObj.add(lf);
    // Cadre droit
    const rf = new THREE.Mesh(new THREE.BoxGeometry(frameThick, height, frameDepth), frameMat);
    rf.position.x = width / 2 - frameThick / 2;
    groupObj.add(rf);

    // Panneau de porte (avec animation d'ouverture)
    if (op === 'ROLLINGUP' || op === 'SECTIONAL' || op === 'TILT_UP') {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - frameThick * 2, height - frameThick, 0.04), frameMat);
      groupObj.add(leaf);
    } else if (isDouble && !op.includes('SLIDING')) {
      const side = Number((item as any).geom.side ?? 1) >= 0 ? 1 : -1;
      const leafW = (width - frameThick * 2) / 2;
      for (const hinge of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.x = hinge * (width / 2 - frameThick);
        pivot.rotation.y = -hinge * side * Math.PI / 2;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, height - frameThick, 0.04), doorMat);
        leaf.position.x = -hinge * leafW / 2;
        pivot.add(leaf);
        groupObj.add(pivot);
      }
    } else if (!op.includes('SLIDING')) {
      const swing = openingSwing(op, (item as any).geom.swing);
      const isRight = swing === 'right';
      const side = Number((item as any).geom.side ?? 1) >= 0 ? 1 : -1;
      const angleOpen = (isRight ? -1 : 1) * side * Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.position.x = isRight ? width / 2 - frameThick : -width / 2 + frameThick;
      pivot.rotation.y = angleOpen;

      const leafW = width - frameThick * 2;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, height - frameThick, 0.04), doorMat);
      leaf.position.x = isRight ? -leafW / 2 : leafW / 2;
      pivot.add(leaf);

      // Poignée
      const handleMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.03), handleMat);
      const hx = isRight ? (-leafW + 0.08) : (leafW - 0.08);
      handle.position.set(hx, -0.1, 0.04);
      leaf.add(handle);
      const handle2 = handle.clone();
      handle2.position.z = -0.04;
      leaf.add(handle2);

      groupObj.add(pivot);
    } else {
      // Porte coulissante
      const leafW = width - frameThick * 2;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, height - frameThick, 0.04), doorMat);
      groupObj.add(leaf);
    }
  }

  return groupObj;
}
