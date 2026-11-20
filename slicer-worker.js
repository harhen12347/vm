function segmentAtZ(triangles, z) {
  const segments = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
    const points = [a, b, c];
    const intersections = [];
    for (let j = 0; j < 3; j++) {
      const p1 = points[j], p2 = points[(j + 1) % 3];
      const dz1 = p1[2] - z, dz2 = p2[2] - z;
      if ((p1[2] <= z && p2[2] > z) || (p2[2] <= z && p1[2] > z)) {
        const t = dz1 / (dz1 - dz2);
        const x = p1[0] + (p2[0] - p1[0]) * t;
        const y = p1[1] + (p2[1] - p1[1]) * t;
        intersections.push([x, y]);
      }
    }
    if (intersections.length === 2 &&
        Math.hypot(intersections[0][0] - intersections[1][0], intersections[0][1] - intersections[1][1]) > 0.01) {
      segments.push([intersections[0], intersections[1]]);
    }
  }
  return segments;
}

function chainSegments(segments) {
  if (!segments.length) return [];
  const remaining = segments.map((segment) => segment.map((point) => [...point]));
  const loops = [];
  while (remaining.length) {
    let loop = remaining.pop();
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const segment = remaining[i];
        const end = loop[loop.length - 1];
        if (Math.hypot(end[0] - segment[0][0], end[1] - segment[0][1]) < 0.05) {
          loop.push(segment[1]); remaining.splice(i, 1); changed = true;
        } else if (Math.hypot(end[0] - segment[1][0], end[1] - segment[1][1]) < 0.05) {
          loop.push(segment[0]); remaining.splice(i, 1); changed = true;
        } else {
          const start = loop[0];
          if (Math.hypot(start[0] - segment[0][0], start[1] - segment[0][1]) < 0.05) {
            loop.unshift(segment[1]); remaining.splice(i, 1); changed = true;
          } else if (Math.hypot(start[0] - segment[1][0], start[1] - segment[1][1]) < 0.05) {
            loop.unshift(segment[0]); remaining.splice(i, 1); changed = true;
          }
        }
      }
    }
    if (loop.length > 3 && Math.hypot(loop[0][0]-loop.at(-1)[0],loop[0][1]-loop.at(-1)[1]) < 0.05) {
      loop.pop();
      loops.push(loop);
    }
  }
  return loops;
}

function boundsForLoops(loops) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  loops.forEach((loop) => loop.forEach((point) => {
    minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
  }));
  return { minX, minY, maxX, maxY };
}

function polygonArea(polygon) {
  let area=0;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    area+=a[0]*b[1]-b[0]*a[1];
  }
  return area/2;
}

function containsPoint(point, polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>point[1])!==(b[1]>point[1])&&
       point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

function offsetPolygon(polygon, distance) {
  const orientation=Math.sign(polygonArea(polygon));
  if(!orientation||Math.abs(distance)<1e-8)return polygon.map((point)=>[...point]);
  const result=[];
  for(let i=0;i<polygon.length;i++){
    const previous=polygon[(i+polygon.length-1)%polygon.length];
    const current=polygon[i];
    const next=polygon[(i+1)%polygon.length];
    const prevLength=Math.hypot(current[0]-previous[0],current[1]-previous[1]);
    const nextLength=Math.hypot(next[0]-current[0],next[1]-current[1]);
    if(prevLength<1e-8||nextLength<1e-8)return null;
    const prevDirection=[(current[0]-previous[0])/prevLength,(current[1]-previous[1])/prevLength];
    const nextDirection=[(next[0]-current[0])/nextLength,(next[1]-current[1])/nextLength];
    const prevNormal=[-prevDirection[1]*orientation,prevDirection[0]*orientation];
    const nextNormal=[-nextDirection[1]*orientation,nextDirection[0]*orientation];
    const prevPoint=[current[0]+prevNormal[0]*distance,current[1]+prevNormal[1]*distance];
    const nextPoint=[current[0]+nextNormal[0]*distance,current[1]+nextNormal[1]*distance];
    const cross=prevDirection[0]*nextDirection[1]-prevDirection[1]*nextDirection[0];
    let point;
    if(Math.abs(cross)<1e-8){
      point=[(prevPoint[0]+nextPoint[0])/2,(prevPoint[1]+nextPoint[1])/2];
    }else{
      const delta=[nextPoint[0]-prevPoint[0],nextPoint[1]-prevPoint[1]];
      const t=(delta[0]*nextDirection[1]-delta[1]*nextDirection[0])/cross;
      point=[prevPoint[0]+prevDirection[0]*t,prevPoint[1]+prevDirection[1]*t];
    }
    if(!Number.isFinite(point[0])||!Number.isFinite(point[1])||
       Math.hypot(point[0]-current[0],point[1]-current[1])>Math.abs(distance)*8+Math.abs(distance)+1){
      point=[(prevPoint[0]+nextPoint[0])/2,(prevPoint[1]+nextPoint[1])/2];
    }
    result.push(point);
  }
  if(Math.abs(polygonArea(result))<0.01||Math.sign(polygonArea(result))!==orientation)return null;
  return result;
}

function lineIntersections(polygons, fixed, horizontal) {
  const hits = [];
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      let t;
      if (horizontal) t = (fixed - a[1]) / (b[1] - a[1]);
      else t = (fixed - a[0]) / (b[0] - a[0]);
      if (Number.isFinite(t) && t >= 0 && t < 1) {
        const point = horizontal ? [a[0] + (b[0] - a[0]) * t, fixed] : [fixed, a[1] + (b[1] - a[1]) * t];
        hits.push(point);
      }
    }
  }
  return hits.sort((a, b) => horizontal ? a[0] - b[0] : a[1] - b[1]);
}

function rotatedPolygons(loops, angle) {
  const c=Math.cos(angle),s=Math.sin(angle);
  return loops.map((loop)=>loop.map(([x,y])=>[x*c-y*s,x*s+y*c]));
}

function addScanLines(polygons, z, spacing, angle, moves) {
  const rotated=rotatedPolygons(polygons,angle);
  const bounds=boundsForLoops(rotated);
  for(let y=bounds.minY;y<=bounds.maxY;y+=spacing){
    const hits=lineIntersections(rotated,y,true);
    for(let i=0;i+1<hits.length;i+=2){
      const c=Math.cos(angle),s=Math.sin(angle);
      const a=[hits[i][0]*c+hits[i][1]*s,-hits[i][0]*s+hits[i][1]*c];
      const b=[hits[i+1][0]*c+hits[i+1][1]*s,-hits[i+1][0]*s+hits[i+1][1]*c];
      moves.push({kind:'infill',x1:a[0],y1:a[1],x2:b[0],y2:b[1],z});
    }
  }
}

function addInfill(loops, z, settings, layerIndex, moves) {
  if (!loops.length || settings.infillDensity <= 0) return;
  const spacing = Math.max(settings.lineWidth, settings.lineWidth * (100 / settings.infillDensity));
  if (settings.infillPattern === 'Lines') {
    addScanLines(loops,z,spacing,(layerIndex%2)*Math.PI/2,moves);
  } else if (settings.infillPattern === 'Triangles') {
    const angle=(layerIndex%3)*Math.PI/3;
    addScanLines(loops,z,spacing,angle,moves);
    addScanLines(loops,z,spacing,angle+Math.PI/3,moves);
    addScanLines(loops,z,spacing,angle-Math.PI/3,moves);
  } else {
    addScanLines(loops,z,spacing,0,moves);
    addScanLines(loops,z,spacing,Math.PI/2,moves);
  }
}

function resolvePrinterGcode(template, settings) {
  const values={
    material_bed_temperature:settings.bedTemperature,
    material_bed_temperature_layer_0:settings.bedTemperature,
    bed_temperature_initial_layer_single:settings.bedTemperature,
    material_print_temperature:settings.nozzleTemperature,
    material_print_temperature_layer_0:settings.nozzleTemperature,
    material_initial_print_temperature:settings.nozzleTemperature,
    material_final_print_temperature:settings.nozzleTemperature,
    nozzle_temperature_initial_layer:settings.nozzleTemperature,
    layer_height:settings.layerHeight,
    layer_height_0:settings.layerHeight,
    machine_nozzle_size:settings.nozzleDiameter,
    retraction_amount:settings.retraction?.distance,
    retraction_speed:settings.retraction?.speed,
    initial_extruder:settings.extruderCount===1?0:undefined,
    initial_no_support_extruder:settings.extruderCount===1?0:undefined
  };
  if(/^\s*(?:START|END)_GCODE\s*$/im.test(template))throw new Error('Printer G-code contains an unexpanded macro.');
  const unresolved=new Set();
  const resolved=template.replace(/\{([^}]+)\}|\[([^\]]+)\]/g,(token,curly,square)=>{
    const name=(curly||square).trim();
    if(!Object.hasOwn(values,name)||values[name]===undefined){unresolved.add(name);return token;}
    return String(values[name]);
  });
  if(unresolved.size)throw new Error(`Printer G-code contains unsupported placeholders: ${[...unresolved].join(', ')}.`);
  return resolved.split(/\r?\n/).filter((line)=>line.trim());
}

self.addEventListener('message', (event) => {
  const requestId=event.data?.requestId;
  const send=(message)=>self.postMessage({...message,requestId});
  try {
    const { triangles, settings } = event.data;
    if (!Array.isArray(triangles) || triangles.length < 9 || triangles.length % 3 !== 0 ||
        triangles.some((point) => !Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value)))) {
      throw new Error('The mesh has invalid or non-finite triangle data.');
    }
    const { buildVolume } = settings || {};
    const values=[settings?.layerHeight,settings?.lineWidth,settings?.wallCount,settings?.infillDensity,
      settings?.nozzleTemperature,settings?.bedTemperature,settings?.printSpeed,settings?.flowRate,
      settings?.filamentDiameter,buildVolume?.x,buildVolume?.y,buildVolume?.z];
    if(values.some((value)=>!Number.isFinite(value)) || settings.layerHeight<0.04 || settings.layerHeight>1 ||
       settings.lineWidth<=0 || settings.wallCount<1 || settings.infillDensity<0 || settings.infillDensity>100 ||
       settings.printSpeed<=0 || settings.filamentDiameter<=0 ||
       buildVolume.x<=0 || buildVolume.y<=0 || buildVolume.z<=0) {
      throw new Error('Slicing settings or printer build-volume dimensions are invalid.');
    }
    if(settings.nozzleDiameter!=null && (settings.lineWidth>settings.nozzleDiameter*2 || settings.layerHeight>settings.nozzleDiameter)){
      throw new Error('Layer height or line width is incompatible with the selected nozzle diameter.');
    }
    const solidLayerCount=settings.solidLayerCount==null?3:settings.solidLayerCount;
    if(!Number.isInteger(solidLayerCount)||solidLayerCount<0||solidLayerCount>20){
      throw new Error('Top and bottom solid layer count must be between 0 and 20.');
    }
    if ((settings.maxNozzleTemperature != null && Number.isFinite(settings.maxNozzleTemperature) && settings.nozzleTemperature > settings.maxNozzleTemperature) ||
      (settings.maxBedTemperature != null && Number.isFinite(settings.maxBedTemperature) && settings.bedTemperature > settings.maxBedTemperature)) {
      throw new Error('Selected temperature exceeds the printer profile maximum.');
    }
    let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (const point of triangles) {
      minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);
      minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1]);
      minZ=Math.min(minZ,point[2]);maxZ=Math.max(maxZ,point[2]);
    }
    const tolerance=0.01;
    if (minX < -buildVolume.x/2-tolerance || maxX > buildVolume.x/2+tolerance ||
        minY < -buildVolume.y/2-tolerance || maxY > buildVolume.y/2+tolerance ||
        minZ < -tolerance || maxZ > buildVolume.z+tolerance) {
      throw new Error(`Model is outside the ${buildVolume.x} × ${buildVolume.y} × ${buildVolume.z} mm build volume.`);
    }
    if(maxZ-minZ<settings.layerHeight*0.5) throw new Error('Model is too thin to slice at this layer height.');

    const layers=[];
    const filamentRadius=settings.filamentDiameter/2;
    const filamentArea=Math.PI*filamentRadius*filamentRadius;
    const offsetX=settings.originAtCenter===true?0:buildVolume.x/2;
    const offsetY=settings.originAtCenter===true?0:buildVolume.y/2;
    let extrudedVolume=0,extrusionLength=0,printSeconds=0,layerIndex=0,e=0;
    let hasExtruded=false,isRetracted=false;
    const retractDistance=Number(settings.retraction?.distance)||0;
    const retractSpeed=(Number(settings.retraction?.speed)||settings.printSpeed)*60;
    let z=minZ+settings.layerHeight/2;
    const totalLayers=Math.ceil((maxZ-minZ)/settings.layerHeight);
    const defaultStartGcode=[
      '; Prism Slicer - generated G-code',
      '; UNTESTED - confirm firmware, origin, temperatures, and physical safety',
      'G21 ; millimetres','G90 ; absolute positioning',
      `M140 S${settings.bedTemperature}`,
      `M104 S${settings.nozzleTemperature}`,
      'G28',
      `M190 S${settings.bedTemperature}`,
      `M109 S${settings.nozzleTemperature}`
    ];
    const startGcode=typeof settings.startGcode==='string'&&settings.startGcode.trim()
      ?resolvePrinterGcode(settings.startGcode,settings)
      :defaultStartGcode;
    const gcode=[...startGcode,settings.relativeExtrusion===true?'M83 ; relative extrusion':'M82 ; absolute extrusion'];
    let currentX=0,currentY=0,currentZ=0;
    while(z<maxZ-tolerance && layerIndex<totalLayers) {
      const loops=chainSegments(segmentAtZ(triangles,z));
      const moves=[];
      const travelMoves=[];
      const loopInfos=loops.map((loop,index)=>({
        loop,
        direction:loops.reduce((depth,other,otherIndex)=>
          otherIndex!==index&&containsPoint(loop[0],other)?depth+1:depth,0)%2===0?1:-1
      }));
      const fillLoops=[];
      for(const {loop,direction} of loopInfos){
        const fillBoundary=offsetPolygon(loop,direction*settings.lineWidth*(settings.wallCount+0.5));
        if(fillBoundary)fillLoops.push(fillBoundary);
        for(let wall=0;wall<settings.wallCount;wall++){
          const wallPath=offsetPolygon(loop,direction*settings.lineWidth*(wall+0.5));
          if(!wallPath)continue;
          for(let i=0;i<wallPath.length;i++){
            const start=wallPath[i],end=wallPath[(i+1)%wallPath.length];
            if(Math.hypot(end[0]-start[0],end[1]-start[1])>0.01){
              moves.push({kind:'wall',x1:start[0],y1:start[1],x2:end[0],y2:end[1],z});
            }
          }
        }
      }
      const solidLayer=layerIndex<solidLayerCount||layerIndex>=totalLayers-solidLayerCount;
      const infillSettings=solidLayer?{...settings,infillDensity:100,infillPattern:layerIndex%2?'Lines':'Grid'}:settings;
      addInfill(fillLoops,z,infillSettings,layerIndex,moves);
      if(moves.length){
        for(const move of moves){
          const x1=move.x1+offsetX,y1=move.y1+offsetY;
          const x2=move.x2+offsetX,y2=move.y2+offsetY;
          const travel=Math.hypot(x1-currentX,y1-currentY);
          if(travel>0.01){
            if(hasExtruded&&!isRetracted&&retractDistance>0&&travel>=(Number(settings.retraction?.minimumTravel)||1)){
              e-=settings.relativeExtrusion===true?0:retractDistance;
              gcode.push(`G1 E${(settings.relativeExtrusion===true?-retractDistance:e).toFixed(5)} F${Math.round(retractSpeed)}`);
              isRetracted=true;
            }
            gcode.push(`G0 X${x1.toFixed(3)} Y${y1.toFixed(3)} Z${z.toFixed(3)} F${Math.round(settings.printSpeed*60*2)}`);
            printSeconds+=travel/(settings.printSpeed*2);
            travelMoves.push({
              kind:'travel',
              x1:currentX-offsetX,y1:currentY-offsetY,
              x2:move.x1,y2:move.y1,z
            });
          }
          if(isRetracted){
            e+=settings.relativeExtrusion===true?0:retractDistance;
            gcode.push(`G1 E${(settings.relativeExtrusion===true?retractDistance:e).toFixed(5)} F${Math.round(retractSpeed)}`);
            isRetracted=false;
          }
          const distance=Math.hypot(x2-x1,y2-y1);
          const volume=distance*settings.lineWidth*settings.layerHeight*(settings.flowRate/100);
          const length=volume/filamentArea;
          e=length+(settings.relativeExtrusion===true?0:e);extrusionLength+=length;extrudedVolume+=volume;
          printSeconds+=distance/settings.printSpeed;
          gcode.push(`G1 X${x2.toFixed(3)} Y${y2.toFixed(3)} E${e.toFixed(5)} F${Math.round(settings.printSpeed*60)}`);
          currentX=x2;currentY=y2;currentZ=z;
          hasExtruded=true;
        }
      }
      layers.push({z,moves:[...travelMoves,...moves]});
      layerIndex++;
      if(layerIndex%5===0 || layerIndex===totalLayers) {
        send({type:'progress',layer:layerIndex,total:totalLayers});
      }
      z=minZ+(layerIndex+0.5)*settings.layerHeight;
    }
    if(!layers.some((layer)=>layer.moves.length)) throw new Error('No printable contours were generated. Check that the mesh is closed and correctly oriented.');
    const defaultEndGcode=['M104 S0','M140 S0',`G0 X0 Y0 Z${Math.min(buildVolume.z,currentZ+10).toFixed(3)} F600`,'M84'];
    const endGcode=typeof settings.endGcode==='string'&&settings.endGcode.trim()
      ?resolvePrinterGcode(settings.endGcode,settings)
      :defaultEndGcode;
    gcode.push(...endGcode);
    send({
      type:'complete',gcode:gcode.join('\n'),layers,
      estimatedMinutes:printSeconds/60,
      filamentMm:extrusionLength,
      filamentGrams:extrudedVolume*1.24/1000
    });
  } catch(error) {
    send({type:'error',message:error.message||'Slicing failed.'});
  }
});
