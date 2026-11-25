import { readFileSync } from 'fs';
import { patchIFC } from './server/bim/patchIFC';
import type { ItemsMap, IfcWallEntity } from './src/types/ifc.js';

async function run() {
  console.log('--- TEST: Patch IFC Lossless ---');

  // 1. Lire le fichier IFC de test fourni par l'utilisateur
  const filePath = './ifc_test_files/Ifc4_SampleHouse.ifc';
  let buffer: ArrayBuffer;
  try {
    const file = readFileSync(filePath);
    buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    console.log(`✅ Fichier IFC chargé: ${filePath} (${buffer.byteLength} bytes)`);
  } catch (err) {
    console.error(`❌ Impossible de lire ${filePath}.`);
    return;
  }

  // 2. Simuler un ItemsMap avec le mur d'expressID '1229'
  // À l'origine, son point cartésien est le #618 = (-7734.848, 4553.582, 0.)
  // On va le déplacer en (10.0, 20.0, 0.0)
  const testExpressID = '1229'; 

  const items: ItemsMap = {
    [`w_${testExpressID}`]: {
      id: `w_${testExpressID}`,
      type: 'Wall',
      ifcType: 'IfcWall',
      Name: 'Test Wall',
      name: 'Test Wall',
      GlobalId: 'guid',
      parentId: null,
      geom: {
        x1: 100.5,
        y1: 200.5,
        x2: 105.5,
        y2: 200.5,
        thickness: 0.2,
        height: 2.5
      },
      PredefinedType: 'STANDARD',
      IsExternal: false,
      LoadBearing: false,
      FireRating: '',
      ThermalTransmittance: 0,
      Material: '',
      material: '',
      fireRating: '',
      loadBearing: false,
      isExternal: false
    } as IfcWallEntity
  };

  console.log(`✅ Création d'un mock ItemsMap avec le mur w_${testExpressID} déplacé en (100.5, 200.5)`);

  // 3. Exécuter patchIFC
  console.log('🔄 Exécution de patchIFC...');
  const patchedStep = await patchIFC(items, buffer);
  console.log(`✅ Patching terminé. Nouvelle taille: ${patchedStep.length} caractères.`);

  // 4. Vérifier si les coordonnées (100.5, 200.5) sont présentes dans le résultat
  if (patchedStep.includes('100.50000') && patchedStep.includes('200.50000')) {
    console.log('🎉 SUCCÈS: Les nouvelles coordonnées ont bien été injectées dans le fichier IFC !');
    // Optionnel: Sauvegarder pour vérifier manuellement dans un viewer
    // require('fs').writeFileSync('./ifc_test_files/Ifc4_SampleHouse_Patched.ifc', patchedStep);
  } else {
    console.log('❌ ÉCHEC: Les coordonnées n\'ont pas été trouvées dans le fichier patché.');
    console.log('Il est possible que l\'ExpressID 1229 ne soit pas un mur avec un placement valide dans ce fichier spécifique.');
  }
}

run();
