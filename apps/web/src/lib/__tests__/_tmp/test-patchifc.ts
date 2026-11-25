import { patchIFC } from '@skaitch/core/bim/patchIFC';

const ifc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','2024-01-01',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1 = IFCPROJECT('0001',#2,'TestProject',$,$,$,$,$,$);
#2 = IFCUNITASSIGNMENT((#3,#4));
#3 = IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#4 = IFCSIUNIT(*,.PLANEANGLEUNIT.,.RADIAN.);
#10 = IFCBUILDING('0001',$,'Bld',$,$,#11,$,$,.ELEMENT.,$,$,$);
#11 = IFCLOCALPLACEMENT($,#12);
#12 = IFCAXIS2PLACEMENT3D(#13,$,$);
#13 = IFCCARTESIANPOINT((0.,0.,0.));
#20 = IFCBUILDINGSTOREY('0001',$,'Storey',$,$,#21,$,$,.ELEMENT.,$);
#21 = IFCLOCALPLACEMENT(#11,#22);
#22 = IFCAXIS2PLACEMENT3D(#23,$,$);
#23 = IFCCARTESIANPOINT((0.,0.,0.));
#30 = IFCWALL('0001',$,'Wall1',$,$,#31,#37,$);
#31 = IFCLOCALPLACEMENT(#21,#32);
#32 = IFCAXIS2PLACEMENT3D(#33,#34,$);
#33 = IFCCARTESIANPOINT((0.,0.,0.));
#34 = IFCDIRECTION((1.,0.,0.));
#35 = IFCCARTESIANPOINT((0.,0.,0.,0.,0.,0.,0.,0.,0.));
#36 = IFCDIRECTION((0.,0.,1.));
#37 = IFCPRODUCTDEFINITIONSHAPE($,$,(#38));
#38 = IFCSHAPEREPRESENTATION(#39,'Body','SweptSolid',(#40));
#39 = IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,$,$);
#40 = IFCEXTRUDEDAREASOLID(#41,#43,#36,3000.);
#41 = IFCRECTANGLEPROFILEDEF(.AREA.,$,#42,200.,3000.);
#42 = IFCCARTESIANPOINT((0.,0.));
#43 = IFCAXIS2PLACEMENT3D(#44,$);
#44 = IFCCARTESIANPOINT((0.,0.,0.));
#50 = IFCOPENINGELEMENT('0001',$,'Op1',$,$,#51,$,$,.OPENING.);
#51 = IFCLOCALPLACEMENT(#31,#52);
#52 = IFCAXIS2PLACEMENT3D(#53,$);
#53 = IFCCARTESIANPOINT((500.,0.,900.));
#54 = IFCOPENINGELEMENT('0002',$,'Op2',$,$,#55,$,$,.OPENING.);
#55 = IFCLOCALPLACEMENT(#31,#56);
#56 = IFCAXIS2PLACEMENT3D(#57,$);
#57 = IFCCARTESIANPOINT((1500.,0.,900.));
#58 = IFCOPENINGELEMENT('0003',$,'Op3',$,$,#59,$,$,.OPENING.);
#59 = IFCLOCALPLACEMENT(#31,#60);
#60 = IFCAXIS2PLACEMENT3D(#61,$);
#61 = IFCCARTESIANPOINT((2500.,0.,900.));
#70 = IFCWINDOW('0001',$,'Win1',$,$,#71,#73,$);
#71 = IFCLOCALPLACEMENT(#51,#72);
#72 = IFCAXIS2PLACEMENT3D(#74,$);
#73 = IFCPRODUCTDEFINITIONSHAPE($,$,(#75));
#74 = IFCCARTESIANPOINT((0.,0.,0.));
#75 = IFCSHAPEREPRESENTATION(#39,'Body','SweptSolid',(#76));
#76 = IFCEXTRUDEDAREASOLID(#77,#79,#36,1200.);
#77 = IFCRECTANGLEPROFILEDEF(.AREA.,$,#78,1000.,1200.);
#78 = IFCCARTESIANPOINT((0.,0.));
#79 = IFCAXIS2PLACEMENT3D(#80,$);
#80 = IFCCARTESIANPOINT((0.,0.,0.));
#81 = IFCWINDOW('0002',$,'Win2',$,$,#82,#84,$);
#82 = IFCLOCALPLACEMENT(#55,#83);
#83 = IFCAXIS2PLACEMENT3D(#85,$);
#84 = IFCPRODUCTDEFINITIONSHAPE($,$,(#86));
#85 = IFCCARTESIANPOINT((0.,0.,0.));
#86 = IFCSHAPEREPRESENTATION(#39,'Body','SweptSolid',(#87));
#87 = IFCEXTRUDEDAREASOLID(#88,#90,#36,1200.);
#88 = IFCRECTANGLEPROFILEDEF(.AREA.,$,#89,1000.,1200.);
#89 = IFCCARTESIANPOINT((0.,0.));
#90 = IFCAXIS2PLACEMENT3D(#91,$);
#91 = IFCCARTESIANPOINT((0.,0.,0.));
#92 = IFCWINDOW('0003',$,'Win3',$,$,#93,#95,$);
#93 = IFCLOCALPLACEMENT(#59,#94);
#94 = IFCAXIS2PLACEMENT3D(#95p,$);
#95p = IFCCARTESIANPOINT((0.,0.,0.));
#95 = IFCPRODUCTDEFINITIONSHAPE($,$,(#96));
#96 = IFCSHAPEREPRESENTATION(#39,'Body','SweptSolid',(#97));
#97 = IFCEXTRUDEDAREASOLID(#98,#100,#36,1200.);
#98 = IFCRECTANGLEPROFILEDEF(.AREA.,$,#99,1000.,1200.);
#99 = IFCCARTESIANPOINT((0.,0.));
#100 = IFCAXIS2PLACEMENT3D(#101,$);
#101 = IFCCARTESIANPOINT((0.,0.,0.));
#110 = IFCRELFILLSELEMENT('0001',$,$,$,#50,#70);
#111 = IFCRELFILLSELEMENT('0002',$,$,$,#54,#81);
#112 = IFCRELFILLSELEMENT('0003',$,$,$,#58,#92);
#120 = IFCRELCONTAINEDINSPATIALSTRUCTURE('0001',$,$,$,(#30,#70,#81,#92),#20);
ENDSEC;
END-ISO-10303-21;
`;

const items: any = {
  's_1': { id: 's_1', type: 'Storey', name: 'S1', GlobalId: '1', parentId: '', geom: { level: 0 } },
  'w_1_30': { id: 'w_1_30', type: 'Wall', name: 'W1', GlobalId: 'wall-1', parentId: 's_1', geom: { x1: 0, y1: 0, x2: 3, y2: 0, thickness: 0.2, height: 3 } },
  'wn_1_70': { id: 'wn_1_70', type: 'Window', name: 'Win1', GlobalId: 'win-1', parentId: 's_1', OverallWidth: 1, OverallHeight: 1.2, OperationType: 'SINGLE_PANEL', geom: { wallId: 'w_1_30', t: 0.2, width: 1.0, height: 1.2, sillHeight: 0.9, openingExpId: '50' } },
  'wn_1_81': { id: 'wn_1_81', type: 'Window', name: 'Win2', GlobalId: 'win-2', parentId: 's_1', OverallWidth: 1, OverallHeight: 1.2, OperationType: 'SINGLE_PANEL', geom: { wallId: 'w_1_30', t: 0.5, width: 1.0, height: 1.2, sillHeight: 0.9, openingExpId: '54' } },
  'wn_1_92': { id: 'wn_1_92', type: 'Window', name: 'Win3', GlobalId: 'win-3', parentId: 's_1', OverallWidth: 1, OverallHeight: 1.2, OperationType: 'SINGLE_PANEL', geom: { wallId: 'w_1_30', t: 0.8, width: 1.0, height: 1.2, sillHeight: 0.9, openingExpId: '58' } },
};

(async () => {
  // Mark only Win1 as edited (to simulate moving ONLY Win1 to t=0.4)
  items['wn_1_70'].geom.t = 0.4;
  items['wn_1_70'].geom._edited = true;

  const encoder = new TextEncoder();
  const buf = encoder.encode(ifc).buffer;
  const patched = await patchIFC(items, buf);

  const lines = patched.split('\n');
  console.log('--- Key patched lines ---');
  for (const l of lines) {
    if (l.match(/^#(30|31|32|33|34|37|38|39|40)=/) ||
        l.match(/^#(50|51|52|53|54|55|56|57|58|59|60|61)=/) ||
        l.match(/^#(70|71|72|73|74|81|82|83|84|85|92|93|94|95p)=/)) {
      console.log(l);
    }
  }
  console.log('\n--- Whole DATA section (just to spot anything weird) ---');
  const dataIdx = patched.indexOf('DATA;');
  const endIdx = patched.indexOf('ENDSEC;', dataIdx);
  console.log(patched.substring(dataIdx, endIdx + 7));
})().catch(e => { console.error(e); process.exit(1); });
