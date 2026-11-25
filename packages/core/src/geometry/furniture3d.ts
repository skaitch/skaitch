import * as THREE from 'three';
import type { IfcFurnitureEntity } from '../types/ifc.js';

/**
 * 3D model of a piece of furniture, built from its category, model and finish settings.
 * Shared by the editor's 3D view and the IFC export so both show the same geometry (ADR 0002).
 *
 * The group is in the furniture's own frame: centred on its footprint, standing on Z=0 of three.js
 * (Y up), unrotated. Callers place and rotate it. Kept free of DOM and WebGL so it runs on servers.
 */
export function buildFurnitureModel(item: IfcFurnitureEntity, options: { translucentFallback?: boolean } = {}): THREE.Group {
  const translucentFallback = options.translucentFallback ?? false;
  const { x, y, w, d, h, rotation } = (item as any).geom;
  const cat = (item as any).category || '';
  const modelId = (item as any).model || '';

  // Material / color overrides set by the user in PropertiesPane
  const hexToNum = (hex: string) => parseInt(hex.replace('#', ''), 16);
  const rawFinishColor: string = (item as any).geom?.furnitureColor || '';
  const rawWorktopFinish: string = (item as any).geom?.worktopFinish || '';

  // Cabinet body color (fallback: light grey for kitchen, category-specific otherwise)
  const cabinetColor = rawFinishColor
    ? hexToNum(rawFinishColor)
    : (cat === 'Cuisine' || modelId.startsWith('cuisine-') ? 0xe8e8e8 : 0x9e9e9e);

  // Worktop color presets
  const worktopColorMap: Record<string, number> = {
    'marbre-blanc':   0xf4f0eb, 'marbre-noir':   0x2a2a2a, 'granit-gris':   0x7a7878,
    'quartz-blanc':   0xefefef, 'bois-chene':    0xc09050, 'inox':          0xc0c0c0,
    'stratifie-noir': 0x1c1c1c, 'beton':         0xa0a098,
  };
  const worktopColor = rawWorktopFinish && worktopColorMap[rawWorktopFinish]
    ? worktopColorMap[rawWorktopFinish]
    : 0x2b2b2b; // default dark slate

  // Is the cabinet color "light" (needs darker handle to contrast)?
  const isLightCabinet = cabinetColor > 0xa0a0a0;
  const handleColor = isLightCabinet ? 0x444444 : 0xcccccc;

  const itemGroup = new THREE.Group();

  // Custom stylized geometry based on category / model!
  if (cat === 'Cuisine' || modelId.startsWith('cuisine-') || modelId.startsWith('electro-')) {
    // Kitchen Cabinet Base or Appliance
    if (modelId === 'electro-refri-americain') {
      // High-end American Fridge
      const bodyGeom = new THREE.BoxGeometry(w, h, d);
      const bodyMat = new THREE.MeshPhongMaterial({ color: 0xdcdcdc, specular: 0xffffff, shininess: 80 }); // Stainless steel
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.y = h / 2;
      body.castShadow = body.receiveShadow = true;
      itemGroup.add(body);

      // Vertical seam line
      const seamGeom = new THREE.BoxGeometry(0.005, h, 0.005);
      const seamMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
      const seam = new THREE.Mesh(seamGeom, seamMat);
      seam.position.set(0, h / 2, d / 2 + 0.001);
      itemGroup.add(seam);

      // Handles
      const handleGeom = new THREE.CylinderGeometry(0.01, 0.01, h * 0.4);
      const handleMat = new THREE.MeshPhongMaterial({ color: 0x888888, specular: 0xffffff, shininess: 90 });
      
      const handleL = new THREE.Mesh(handleGeom, handleMat);
      handleL.position.set(-0.05, h * 0.5, d / 2 + 0.02);
      itemGroup.add(handleL);

      const handleR = new THREE.Mesh(handleGeom, handleMat);
      handleR.position.set(0.05, h * 0.5, d / 2 + 0.02);
      itemGroup.add(handleR);
    } else if (modelId.startsWith('electro-refri')) {
      // Standard fridge
      const bodyGeom = new THREE.BoxGeometry(w, h, d);
      const bodyMat = new THREE.MeshPhongMaterial({ color: 0xf5f5f5, specular: 0xffffff, shininess: 50 });
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.y = h / 2;
      itemGroup.add(body);

      // Door handle
      const handleGeom = new THREE.BoxGeometry(0.02, h * 0.3, 0.02);
      const handleMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
      const handle = new THREE.Mesh(handleGeom, handleMat);
      handle.position.set(-w / 2 + 0.05, h * 0.6, d / 2 + 0.01);
      itemGroup.add(handle);
    } else {
      // Kitchen Counter Cabinets / Cooktop / Sink / Corner / Island / Hood / etc.

      if (modelId === 'cuisine-ilot') {
        // Island: larger cabinet with legs visible underneath
        const islandTopGeom = new THREE.BoxGeometry(w, 0.05, d);
        const islandTopMat = new THREE.MeshPhongMaterial({ color: worktopColor, flatShading: false, specular: 0x888888, shininess: 60 });
        const islandTop = new THREE.Mesh(islandTopGeom, islandTopMat);
        islandTop.position.y = h;
        itemGroup.add(islandTop);

        const islandBodyGeom = new THREE.BoxGeometry(w * 0.92, h * 0.96, d * 0.92);
        const islandBodyMat = new THREE.MeshPhongMaterial({ color: cabinetColor, flatShading: true });
        const islandBody = new THREE.Mesh(islandBodyGeom, islandBodyMat);
        islandBody.position.y = h * 0.96 / 2;
        islandBody.castShadow = islandBody.receiveShadow = true;
        itemGroup.add(islandBody);

        // Handle bar across the top
        const barGeom = new THREE.CylinderGeometry(0.012, 0.012, w * 0.5);
        const barMat = new THREE.MeshPhongMaterial({ color: handleColor, specular: 0xffffff, shininess: 80 });
        const bar = new THREE.Mesh(barGeom, barMat);
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, h - 0.08, d / 2 - 0.05);
        itemGroup.add(bar);

      } else if (modelId === 'cuisine-angle') {
        // Corner cabinet: L-shaped footprint
        const part1Geom = new THREE.BoxGeometry(w, h * 0.96, d * 0.5);
        const part1Mat = new THREE.MeshPhongMaterial({ color: cabinetColor, flatShading: true });
        const part1 = new THREE.Mesh(part1Geom, part1Mat);
        part1.position.set(0, h * 0.96 / 2, -d * 0.25);
        itemGroup.add(part1);

        const part2Geom = new THREE.BoxGeometry(w * 0.5, h * 0.96, d * 0.5);
        const part2 = new THREE.Mesh(part2Geom, part1Mat);
        part2.position.set(w * 0.25, h * 0.96 / 2, d * 0.25);
        itemGroup.add(part2);

        // Corner worktop
        const ctopGeom = new THREE.BoxGeometry(w + 0.02, h * 0.04, d + 0.02);
        const ctopMat = new THREE.MeshPhongMaterial({ color: worktopColor, shininess: 60 });
        const ctop = new THREE.Mesh(ctopGeom, ctopMat);
        ctop.position.y = h - (h * 0.04) / 2;
        itemGroup.add(ctop);

      } else if (modelId === 'cuisine-hotte') {
        // Range hood: angled stainless-steel body above cooktop height
        const hoodGeom = new THREE.BoxGeometry(w, h, d);
        const hoodMat = new THREE.MeshPhongMaterial({ color: 0xd8d8d8, specular: 0xffffff, shininess: 90 }); // Stainless
        const hood = new THREE.Mesh(hoodGeom, hoodMat);
        hood.position.y = h / 2;
        itemGroup.add(hood);

        // Bottom grille strip
        const grilleGeom = new THREE.BoxGeometry(w * 0.9, 0.02, d * 0.8);
        const grilleMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 100 });
        const grille = new THREE.Mesh(grilleGeom, grilleMat);
        grille.position.set(0, 0.02, 0);
        itemGroup.add(grille);

      } else if (modelId === 'cuisine-lave-vaisselle') {
        // Dishwasher: integrated panel matching cabinet color
        const dwGeom = new THREE.BoxGeometry(w, h * 0.96, d);
        const dwMat = new THREE.MeshPhongMaterial({ color: cabinetColor, flatShading: true });
        const dw = new THREE.Mesh(dwGeom, dwMat);
        dw.position.y = (h * 0.96) / 2;
        itemGroup.add(dw);

        // Top slot
        const slotGeom = new THREE.BoxGeometry(w * 0.9, 0.005, 0.005);
        const slotMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
        const slot = new THREE.Mesh(slotGeom, slotMat);
        slot.position.set(0, h * 0.95, d / 2 + 0.001);
        itemGroup.add(slot);

        // Handle bar
        const hbGeom = new THREE.CylinderGeometry(0.012, 0.012, w * 0.7);
        const hbMat = new THREE.MeshPhongMaterial({ color: handleColor, specular: 0xffffff, shininess: 80 });
        const hb = new THREE.Mesh(hbGeom, hbMat);
        hb.rotation.z = Math.PI / 2;
        hb.position.set(0, h * 0.88, d / 2 + 0.02);
        itemGroup.add(hb);

      } else if (modelId === 'cuisine-congelateur') {
        // Upright freezer: tall white/metallic box
        const fzGeom = new THREE.BoxGeometry(w, h, d);
        const fzMat = new THREE.MeshPhongMaterial({ color: 0xf0f0f0, specular: 0xffffff, shininess: 40 });
        const fz = new THREE.Mesh(fzGeom, fzMat);
        fz.position.y = h / 2;
        itemGroup.add(fz);

        const fzHandleGeom = new THREE.BoxGeometry(0.02, h * 0.35, 0.02);
        const fzHandleMat = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
        const fzHandle = new THREE.Mesh(fzHandleGeom, fzHandleMat);
        fzHandle.position.set(-w / 2 + 0.04, h * 0.65, d / 2 + 0.01);
        itemGroup.add(fzHandle);

      } else if (modelId === 'cuisine-plan-travail') {
        // Standalone worktop slab
        const ptGeom = new THREE.BoxGeometry(w, h || 0.05, d);
        const ptMat = new THREE.MeshPhongMaterial({ color: worktopColor, shininess: 70, specular: 0x888888 });
        const pt = new THREE.Mesh(ptGeom, ptMat);
        pt.position.y = (h || 0.05) / 2;
        pt.castShadow = pt.receiveShadow = true;
        itemGroup.add(pt);

      } else {
        // Generic kitchen cabinet (base unit, wall unit, oven column, evier, plaques, microondes)
        const baseGeom = new THREE.BoxGeometry(w, h * 0.96, d);
        const baseMat = new THREE.MeshPhongMaterial({ color: cabinetColor, flatShading: true });
        const baseMesh = new THREE.Mesh(baseGeom, baseMat);
        baseMesh.position.y = (h * 0.96) / 2;
        baseMesh.castShadow = baseMesh.receiveShadow = true;
        itemGroup.add(baseMesh);

        // Countertop with user-chosen worktop color
        const topGeom = new THREE.BoxGeometry(w + 0.02, h * 0.04, d + 0.02);
        const topMat = new THREE.MeshPhongMaterial({ color: worktopColor, flatShading: false, specular: 0x888888, shininess: 70 });
        const topMesh = new THREE.Mesh(topGeom, topMat);
        topMesh.position.y = h - (h * 0.04) / 2;
        topMesh.castShadow = topMesh.receiveShadow = true;
        itemGroup.add(topMesh);

        // Handle bar (chrome by default, auto-contrasted)
        if (!modelId.includes('haut') && !modelId.includes('plan-travail') && !modelId.includes('hotte')) {
          const barGeom = new THREE.CylinderGeometry(0.008, 0.008, w * 0.55);
          const barMat = new THREE.MeshPhongMaterial({ color: handleColor, specular: 0xffffff, shininess: 90 });
          const bar = new THREE.Mesh(barGeom, barMat);
          bar.rotation.z = Math.PI / 2;
          bar.position.set(0, h * 0.6, d / 2 + 0.025);
          itemGroup.add(bar);
        }

        // Model-specific details
        if (modelId.includes('evier')) {
          const bowlGeom = new THREE.BoxGeometry(w * 0.6, 0.005, d * 0.6);
          const bowlMat = new THREE.MeshPhongMaterial({ color: 0x7c7c7c, specular: 0xffffff, shininess: 80 });
          const bowl = new THREE.Mesh(bowlGeom, bowlMat);
          bowl.position.y = h + 0.002;
          itemGroup.add(bowl);
          // Tap
          const tapGeom = new THREE.CylinderGeometry(0.012, 0.012, 0.15);
          const tapMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0xffffff, shininess: 100 });
          const tap = new THREE.Mesh(tapGeom, tapMat);
          tap.position.set(0, h + 0.08, -d * 0.2);
          itemGroup.add(tap);
        } else if (modelId.includes('plaques')) {
          const hobGeom = new THREE.BoxGeometry(w * 0.7, 0.002, d * 0.7);
          const hobMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 100 });
          const hob = new THREE.Mesh(hobGeom, hobMat);
          hob.position.y = h + 0.001;
          itemGroup.add(hob);

          const ringGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.003, 16);
          const ringMat = new THREE.MeshPhongMaterial({ color: 0xcc5500, emissive: 0x331100 });
          for (let i = 0; i < 4; i++) {
            const ring = new THREE.Mesh(ringGeom, ringMat);
            const ox = (i % 2 === 0 ? -1 : 1) * w * 0.16;
            const oz = (i >= 2 ? -1 : 1) * d * 0.16;
            ring.position.set(ox, h + 0.003, oz);
            itemGroup.add(ring);
          }
        } else if (modelId.includes('microondes') || modelId.includes('colonne')) {
          const screenGeom = new THREE.BoxGeometry(w * 0.75, h * 0.22, 0.01);
          const screenMat = new THREE.MeshPhongMaterial({ color: 0x111111, specular: 0xffffff, shininess: 100 });
          const screen = new THREE.Mesh(screenGeom, screenMat);
          screen.position.set(0, h * 0.62, d / 2 + 0.001);
          itemGroup.add(screen);

          // Oven door rectangle
          const doorGeom = new THREE.BoxGeometry(w * 0.8, h * 0.3, 0.01);
          const doorMat = new THREE.MeshPhongMaterial({ color: 0x222222, specular: 0x888888, shininess: 60 });
          const door = new THREE.Mesh(doorGeom, doorMat);
          door.position.set(0, h * 0.3, d / 2 + 0.001);
          itemGroup.add(door);
        }
      }
    }
  }
  else if (cat === 'Chambre' || modelId.startsWith('chambre-')) {
    // Bed / Nightstand
    if (modelId.includes('chevet')) {
      // Nightstand
      const bodyGeom = new THREE.BoxGeometry(w, h, d);
      const bodyMat = new THREE.MeshPhongMaterial({ color: 0x8b5a2b, flatShading: true }); // Wood
      const body = new THREE.Mesh(bodyGeom, bodyMat);
      body.position.y = h / 2;
      itemGroup.add(body);

      // Drawer seam
      const seamGeom = new THREE.BoxGeometry(w * 0.9, 0.004, 0.01);
      const seamMat = new THREE.MeshPhongMaterial({ color: 0x442200 });
      const seam = new THREE.Mesh(seamGeom, seamMat);
      seam.position.set(0, h * 0.5, d / 2 + 0.001);
      itemGroup.add(seam);
    } else {
      // Bed frame
      const frameH = h * 0.3;
      const frameGeom = new THREE.BoxGeometry(w, frameH, d);
      const frameMat = new THREE.MeshPhongMaterial({ color: 0x8b5a2b, flatShading: true });
      const frame = new THREE.Mesh(frameGeom, frameMat);
      frame.position.y = frameH / 2;
      itemGroup.add(frame);

      // Mattress
      const matH = h * 0.5;
      const matGeom = new THREE.BoxGeometry(w * 0.94, matH, d * 0.94);
      const matMat = new THREE.MeshPhongMaterial({ color: 0xf5f5f5, flatShading: true });
      const mattress = new THREE.Mesh(matGeom, matMat);
      mattress.position.y = frameH + matH / 2;
      itemGroup.add(mattress);

      // Pillows
      const isKing = w > 1.7;
      const pilW = w * (isKing ? 0.32 : 0.35);
      const pilD = d * 0.2;
      const pilH = h * 0.12;
      const pilGeom = new THREE.BoxGeometry(pilW, pilH, pilD);
      const pilMat = new THREE.MeshPhongMaterial({ color: 0xeaeaea, flatShading: true });
      
      // Pillow Left
      const pilL = new THREE.Mesh(pilGeom, pilMat);
      pilL.position.set(-w * (isKing ? 0.25 : 0.22), frameH + matH + pilH / 2, -d * 0.34);
      itemGroup.add(pilL);

      // Pillow Right
      const pilR = new THREE.Mesh(pilGeom, pilMat);
      pilR.position.set(w * (isKing ? 0.25 : 0.22), frameH + matH + pilH / 2, -d * 0.34);
      itemGroup.add(pilR);
    }
  }
  else if (cat === 'Dressing' || modelId.startsWith('dressing-')) {
    // Wardrobe or Chest
    const bodyGeom = new THREE.BoxGeometry(w, h, d);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0xeae2d5, flatShading: true }); // Beige wood
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = h / 2;
    itemGroup.add(body);

    // Horizontal drawer lines or wardrobe doors
    if (modelId.includes('commode') || modelId.includes('chiffonnier')) {
      const linesCount = modelId.includes('chiffonnier') ? 5 : 3;
      const seamGeom = new THREE.BoxGeometry(w * 0.92, 0.005, 0.005);
      const seamMat = new THREE.MeshPhongMaterial({ color: 0x8b7e74 });
      for (let i = 1; i < linesCount; i++) {
        const seam = new THREE.Mesh(seamGeom, seamMat);
        seam.position.set(0, h * (i / linesCount), d / 2 + 0.001);
        itemGroup.add(seam);
      }
    } else {
      // Wardrobe double doors seam
      const seamGeom = new THREE.BoxGeometry(0.005, h * 0.94, 0.005);
      const seamMat = new THREE.MeshPhongMaterial({ color: 0x8b7e74 });
      const seam = new THREE.Mesh(seamGeom, seamMat);
      seam.position.set(0, h / 2, d / 2 + 0.001);
      itemGroup.add(seam);
    }
  }
  else if (cat === 'Salle de bain' || modelId.startsWith('sdb-')) {
    if (modelId === 'sdb-bidet') {
      const bowlGeom = new THREE.CylinderGeometry(w * 0.4, w * 0.3, h, 12);
      const bowlMat = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffffff, shininess: 90 });
      const bowl = new THREE.Mesh(bowlGeom, bowlMat);
      bowl.position.y = h / 2;
      itemGroup.add(bowl);

      // Chrome tap
      const tapGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.06);
      const tapMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0xffffff });
      const tap = new THREE.Mesh(tapGeom, tapMat);
      tap.position.set(0, h + 0.03, -w * 0.2);
      itemGroup.add(tap);
    } else {
      // Glossy porcelain vanity box (Single or Double)
      const boxGeom = new THREE.BoxGeometry(w, h * 0.9, d);
      const boxMat = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0xffffff, shininess: 90 });
      const boxMesh = new THREE.Mesh(boxGeom, boxMat);
      boxMesh.position.y = (h * 0.9) / 2;
      itemGroup.add(boxMesh);

      const isDouble = modelId.includes('double');
      const faucets = isDouble ? [-w * 0.25, w * 0.25] : [0];

      faucets.forEach((fx) => {
        // Faucet details
        const faucetGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.12);
        const faucetMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0xffffff, shininess: 100 });
        const faucet = new THREE.Mesh(faucetGeom, faucetMat);
        faucet.position.set(fx, h + 0.06, -d * 0.35);
        itemGroup.add(faucet);
      });
    }
  }
  // Tables share the desk geometry (top + legs); without this they fell through to the sofa default.
  else if ((cat === 'Meubles' || modelId.startsWith('meuble-') || modelId.includes('canape')) && !modelId.startsWith('meuble-table-')) {
    if (modelId === 'meuble-tv') {
      // Low console
      const consoleGeom = new THREE.BoxGeometry(w, h * 0.6, d);
      const consoleMat = new THREE.MeshPhongMaterial({ color: 0x2c2c2c, flatShading: true }); // Dark lacquer console
      const consoleMesh = new THREE.Mesh(consoleGeom, consoleMat);
      consoleMesh.position.y = (h * 0.6) / 2;
      itemGroup.add(consoleMesh);

      // TV Screen
      const screenW = w * 0.75;
      const screenH = h * 1.2;
      const screenGeom = new THREE.BoxGeometry(screenW, screenH, 0.04);
      const screenMat = new THREE.MeshPhongMaterial({ color: 0x050505, specular: 0xffffff, shininess: 100 });
      const screenMesh = new THREE.Mesh(screenGeom, screenMat);
      screenMesh.position.set(0, h * 0.6 + screenH / 2 + 0.02, 0);
      itemGroup.add(screenMesh);

      // TV Stand leg
      const standGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.1);
      const standMesh = new THREE.Mesh(standGeom, consoleMat);
      standMesh.position.set(0, h * 0.6 + 0.05, 0);
      itemGroup.add(standMesh);
    } else if (modelId === 'meuble-chaise') {
      // Dining Chair
      const seatH = h * 0.5;
      const seatGeom = new THREE.BoxGeometry(w, 0.04, d);
      const seatMat = new THREE.MeshPhongMaterial({ color: 0x8b5a2b }); // Wood seat
      const seat = new THREE.Mesh(seatGeom, seatMat);
      seat.position.y = seatH;
      itemGroup.add(seat);

      // Backrest
      const backGeom = new THREE.BoxGeometry(w, h * 0.5, 0.04);
      const backMesh = new THREE.Mesh(backGeom, seatMat);
      backMesh.position.set(0, seatH + h * 0.25, -d / 2 + 0.02);
      itemGroup.add(backMesh);

      // 4 thin legs
      const legGeom = new THREE.CylinderGeometry(0.015, 0.015, seatH);
      const legMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
      const offsets = [
        [-w/2 + 0.03, -d/2 + 0.03],
        [w/2 - 0.03, -d/2 + 0.03],
        [-w/2 + 0.03, d/2 - 0.03],
        [w/2 - 0.03, d/2 - 0.03],
      ];
      offsets.forEach(([ox, od]) => {
        const leg = new THREE.Mesh(legGeom, legMat);
        leg.position.set(ox, seatH / 2, od);
        itemGroup.add(leg);
      });
    } else if (modelId === 'meuble-bibliotheque') {
      // Bookshelf / Library
      const shellGeom = new THREE.BoxGeometry(w, h, d);
      const shellMat = new THREE.MeshPhongMaterial({ color: 0xcd853f, flatShading: true }); // Peru brown wood
      const shell = new THREE.Mesh(shellGeom, shellMat);
      shell.position.y = h / 2;
      itemGroup.add(shell);

      // Inner shelf lines
      const lineGeom = new THREE.BoxGeometry(w * 0.92, 0.02, d * 0.9);
      const lineMat = new THREE.MeshPhongMaterial({ color: 0x3e2723 });
      for (let i = 1; i < 5; i++) {
        const shelf = new THREE.Mesh(lineGeom, lineMat);
        shelf.position.set(0, h * (i / 5), 0);
        itemGroup.add(shelf);
      }
    } else if (modelId === 'meuble-canape-angle') {
      // L-shaped Corner Sofa
      const baseH = h * 0.35;
      const armW = w * 0.1;
      const mat = new THREE.MeshPhongMaterial({ color: 0x4e5d6c, flatShading: true }); // Slate blue sofa
      
      // Main Couch segment
      const mainGeom = new THREE.BoxGeometry(w, baseH, d * 0.6);
      const main = new THREE.Mesh(mainGeom, mat);
      main.position.set(0, baseH / 2, -d * 0.2);
      itemGroup.add(main);

      // Return chaise segment
      const returnGeom = new THREE.BoxGeometry(w * 0.38, baseH, d * 0.4);
      const ret = new THREE.Mesh(returnGeom, mat);
      ret.position.set(-w / 2 + w * 0.19, baseH / 2, d * 0.3);
      itemGroup.add(ret);

      // Back cushions main
      const backH = h * 0.65;
      const backD = d * 0.15;
      const backGeom = new THREE.BoxGeometry(w - armW, backH, backD);
      const backMesh = new THREE.Mesh(backGeom, mat);
      backMesh.position.set(armW / 2, baseH + backH / 2, -d * 0.5 + backD / 2);
      itemGroup.add(backMesh);

      // Back cushions return
      const backRetGeom = new THREE.BoxGeometry(backD, backH, d * 0.8);
      const backRet = new THREE.Mesh(backRetGeom, mat);
      backRet.position.set(-w / 2 + backD / 2, baseH + backH / 2, -d * 0.1);
      itemGroup.add(backRet);
    } else {
      // Sofa Base (standard)
      const baseH = h * 0.35;
      const baseGeom = new THREE.BoxGeometry(w, baseH, d);
      const baseMat = new THREE.MeshPhongMaterial({ color: 0x3d3d3d, flatShading: true }); // Charcoal grey
      const baseMesh = new THREE.Mesh(baseGeom, baseMat);
      baseMesh.position.y = baseH / 2;
      itemGroup.add(baseMesh);

      // Back cushions
      const backH = h * 0.65;
      const backD = d * 0.22;
      const backGeom = new THREE.BoxGeometry(w * 0.96, backH, backD);
      const backMesh = new THREE.Mesh(backGeom, baseMat);
      backMesh.position.set(0, baseH + backH / 2, -d/2 + backD/2);
      itemGroup.add(backMesh);

      // Armrest Left
      const armW = w * 0.12;
      const armH = h * 0.6;
      const armGeom = new THREE.BoxGeometry(armW, armH, d);
      const armL = new THREE.Mesh(armGeom, baseMat);
      armL.position.set(-w/2 + armW/2, armH / 2, 0);
      itemGroup.add(armL);

      // Armrest Right
      const armR = new THREE.Mesh(armGeom, baseMat);
      armR.position.set(w/2 - armW/2, armH / 2, 0);
      itemGroup.add(armR);
    }
  }
  else if (cat === 'Bureau' || modelId.startsWith('bureau-') || modelId.startsWith('meuble-table-')) {
    // Wooden desk top
    const topH = 0.04;
    const topGeom = new THREE.BoxGeometry(w, topH, d);
    const topMat = new THREE.MeshPhongMaterial({ color: 0xd2b48c, flatShading: true }); // Oak wood
    const topMesh = new THREE.Mesh(topGeom, topMat);
    topMesh.position.y = h - topH / 2;
    itemGroup.add(topMesh);

    // 4 cylindrical legs
    const legRadius = 0.02;
    const legGeom = new THREE.CylinderGeometry(legRadius, legRadius, h - topH);
    const legMat = new THREE.MeshPhongMaterial({ color: 0x333333, flatShading: true });
    const legH = h - topH;

    const offsets = [
      [-w/2 + 0.05, -d/2 + 0.05],
      [w/2 - 0.05, -d/2 + 0.05],
      [-w/2 + 0.05, d/2 - 0.05],
      [w/2 - 0.05, d/2 - 0.05],
    ];

    offsets.forEach(([ox, od]) => {
      const leg = new THREE.Mesh(legGeom, legMat);
      leg.position.set(ox, legH / 2, od);
      itemGroup.add(leg);
    });
  }
  else if (cat === 'Jardin' || modelId.startsWith('jardin-')) {
    if (modelId === 'jardin-parasol') {
      // Umbrella Pole
      const poleGeom = new THREE.CylinderGeometry(0.015, 0.015, h);
      const poleMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
      const pole = new THREE.Mesh(poleGeom, poleMat);
      pole.position.y = h / 2;
      itemGroup.add(pole);

      // Octagonal umbrella canvas (modeled as a low-polygon cone!)
      const canvasGeom = new THREE.ConeGeometry(w * 0.9, 0.3, 8);
      const canvasMat = new THREE.MeshPhongMaterial({ color: 0xf5f5dc, flatShading: true }); // Beige canvas
      const canvas = new THREE.Mesh(canvasGeom, canvasMat);
      canvas.position.y = h - 0.15;
      itemGroup.add(canvas);
    } else {
      // Plant pot or garden table/lounger
      const potH = h * 0.35;
      const potGeom = new THREE.CylinderGeometry(w * 0.35, w * 0.25, potH, 12);
      const potMat = new THREE.MeshPhongMaterial({ color: 0x8b5a2b, flatShading: true }); // Terracotta
      const pot = new THREE.Mesh(potGeom, potMat);
      pot.position.y = potH / 2;
      itemGroup.add(pot);

      // Green foliage
      const foliageGeom = new THREE.SphereGeometry(w * 0.45, 12, 12);
      const foliageMat = new THREE.MeshPhongMaterial({ color: 0x2e8b57, flatShading: true });
      const foliage = new THREE.Mesh(foliageGeom, foliageMat);
      foliage.position.y = potH + (w * 0.35);
      itemGroup.add(foliage);
    }
  }
  else if (cat === 'Personnage' || modelId.startsWith('pers-') || modelId === 'personne-pmr' || modelId === 'personne-debout') {
    // Cylinder body + Head sphere
    const bodyH = h * 0.65;
    const bodyGeom = new THREE.CylinderGeometry(0.18, 0.15, bodyH, 10);
    const bodyMat = new THREE.MeshPhongMaterial({ color: 0x4682b4, flatShading: true });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = bodyH / 2;
    itemGroup.add(body);

    const headRadius = 0.14;
    const headGeom = new THREE.SphereGeometry(headRadius, 10, 10);
    const headMat = new THREE.MeshPhongMaterial({ color: 0xffdbac, flatShading: true });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = bodyH + headRadius;
    itemGroup.add(head);
  }
  else if (cat === 'Symboles pmr' || modelId.startsWith('pmr-')) {
    // Thin flat circular or rectangular indicator sheet lying on ground
    const isCircle = modelId.includes('cercle');
    const sheetGeom = isCircle 
      ? new THREE.CylinderGeometry(w / 2, w / 2, 0.002, 32)
      : new THREE.BoxGeometry(w, 0.002, d);
    const sheetMat = new THREE.MeshPhongMaterial({ color: 0x1e88e5, transparent: true, opacity: 0.3 });
    const sheet = new THREE.Mesh(sheetGeom, sheetMat);
    sheet.position.y = 0.001;
    itemGroup.add(sheet);

    // Add a tiny stick figure or wheel outline for wheelchair PMR
    if (modelId === 'pmr-fauteuil') {
      const wheelGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 12);
      wheelGeom.rotateZ(Math.PI / 2);
      const wheel = new THREE.Mesh(wheelGeom, new THREE.MeshPhongMaterial({ color: 0x1e88e5 }));
      wheel.position.set(0, 0.1, 0);
      itemGroup.add(wheel);
    }
  }
  else {
    // Default generic stylish colored furniture box
    const geom = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshPhongMaterial({ color: 0x738c73, flatShading: true, transparent: translucentFallback, opacity: translucentFallback ? 0.5 : 1 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = h / 2;
    mesh.castShadow = mesh.receiveShadow = true;
    itemGroup.add(mesh);
  }

  return itemGroup;
}
