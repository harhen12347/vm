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
