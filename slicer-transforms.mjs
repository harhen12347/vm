export function dimensionsFromScale(baseDimensions, scale) {
  if (!Array.isArray(baseDimensions) || baseDimensions.length !== 3 ||
	  !Array.isArray(scale) || scale.length !== 3 ||
	  baseDimensions.some((value) => !Number.isFinite(value) || value <= 0) ||
	  scale.some((value) => !Number.isFinite(value) || value <= 0)) {
	throw new Error('Model dimensions and scale must contain three positive finite values.');
  }
  return baseDimensions.map((value, axis) => value * scale[axis]);
}

export function normalizePositionsAtPlate(positions) {
  if (!Array.isArray(positions) || positions.length < 3 ||
      positions.some((point) => !Array.isArray(point) || point.length !== 3 || point.some((value) => !Number.isFinite(value)))) {
    throw new Error('Model geometry must contain finite XYZ vertices.');
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of positions){
    point.forEach((value,axis)=>{min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);});
  }
  const offset=[(min[0]+max[0])/2,(min[1]+max[1])/2,min[2]];
  return positions.map((point)=>point.map((value,axis)=>value-offset[axis]));
}

export function arrangeFootprints(footprints, buildVolume, gap = 4) {
  if (!Array.isArray(footprints) || !footprints.length ||
      footprints.some(({ width, depth }) => !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) ||
      !buildVolume || !Number.isFinite(buildVolume.x) || !Number.isFinite(buildVolume.y) || buildVolume.x <= 0 || buildVolume.y <= 0 ||
      !Number.isFinite(gap) || gap < 0) {
    throw new Error('Model footprints and build-plate dimensions must be positive finite values.');
  }
  const placements=[];
  let x=-buildVolume.x/2+gap, y=-buildVolume.y/2+gap, rowDepth=0;
  for(const footprint of footprints){
    const width=footprint.width+gap, depth=footprint.depth+gap;
    if(width>buildVolume.x||depth>buildVolume.y)throw new Error(`${footprint.name||'A model'} is larger than the build plate.`);
    if(x+width>buildVolume.x/2){x=-buildVolume.x/2+gap;y+=rowDepth;rowDepth=0;}
    if(y+depth>buildVolume.y/2)throw new Error('All models do not fit on the build plate. Remove models or resize them before arranging.');
    placements.push([x+footprint.width/2,y+footprint.depth/2]);
    x+=width;
    rowDepth=Math.max(rowDepth,depth);
  }
  const minX=Math.min(...placements.map(([px],index)=>px-footprints[index].width/2));
  const maxX=Math.max(...placements.map(([px],index)=>px+footprints[index].width/2));
  const minY=Math.min(...placements.map(([,py],index)=>py-footprints[index].depth/2));
  const maxY=Math.max(...placements.map(([,py],index)=>py+footprints[index].depth/2));
  const offsetX=-(minX+maxX)/2,offsetY=-(minY+maxY)/2;
  return placements.map(([px,py])=>[px+offsetX,py+offsetY]);
}

export function scaleForDimensions(baseDimensions, targetDimensions, keepProportions, changedAxis) {
  if (!Array.isArray(baseDimensions) || baseDimensions.length !== 3 ||
	  !Array.isArray(targetDimensions) || targetDimensions.length !== 3 ||
	  baseDimensions.some((value) => !Number.isFinite(value) || value <= 0) ||
	  targetDimensions.some((value) => !Number.isFinite(value) || value <= 0) ||
	  !Number.isInteger(changedAxis) || changedAxis < 0 || changedAxis > 2) {
	throw new Error('Enter a positive finite size for each model axis.');
  }
  if (keepProportions) {
	const factor = targetDimensions[changedAxis] / baseDimensions[changedAxis];
	return [factor, factor, factor];
  }
  return baseDimensions.map((value, axis) => targetDimensions[axis] / value);
}
