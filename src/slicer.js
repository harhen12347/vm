import * as THREE from './vendor/three/three.module.js';
import { CuraWASM } from 'cura-wasm';
import { availableOutputFormats, OUTPUT_FORMATS, profileErrors, profileWarnings, unsupportedGcodeTokens, validateDatabase } from './printer-database.mjs';
import { buildCuraOverrides, curaMetadataToStats, parseCuraGcode, trianglesToBinaryStl } from './cura-engine-adapter.mjs';
import { AMFLoader } from 'three/addons/loaders/AMFLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { arrangeFootprints, dimensionsFromScale, normalizePositionsAtPlate, scaleForDimensions } from './slicer-transforms.mjs';

const printerDatabaseResponse = await fetch('./printer-database.json', { cache: 'no-cache' });
if (!printerDatabaseResponse.ok) throw new Error(`Unable to load printer database (${printerDatabaseResponse.status}).`);
const printerDatabase = validateDatabase(await printerDatabaseResponse.json());

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const viewport = $('#viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202329);
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.prepend(renderer.domElement);
const transformControls=new TransformControls(camera,renderer.domElement);
transformControls.setMode('translate');
transformControls.setSize(0.85);
scene.add(transformControls.getHelper());
transformControls.addEventListener('dragging-changed',(event)=>{
  if(event.value)pointerAction=null;
});
transformControls.addEventListener('objectChange',()=>syncTransformInputs());
transformControls.addEventListener('mouseUp',()=>{
  if(selectedObject&&transformControls.getMode()!=='translate')placeOnPlate(selectedObject);
  invalidateSlice();
});

const printerProfiles = printerDatabase.profiles.map((profile) => ({
  ...profile,
  name: profile.model,
  x: profile.buildVolume.x,
  y: profile.buildVolume.y,
  z: profile.buildVolume.z,
  nozzle: profile.nozzleDiameters[0],
  status: profileWarnings(profile).join(' ')
}));
try {
  const saved=localStorage.getItem('prism-printer-profiles');
  if(saved){
    const records=JSON.parse(saved);
    if(!Array.isArray(records))throw new Error('Saved profile data is not a list.');
    for(let index=0;index<records.length;index++){
      const entry=records[index];
      const profile=entry.nozzleDiameters ? entry : {
        id:`custom-saved-${index}`, manufacturer:entry.manufacturer, series:'Custom', model:entry.name,
        buildVolume:entry.buildVolume, nozzleDiameters:[entry.nozzleDiameter], filamentDiameter:1.75,
        extruderCount:1, heatedBed:null, maxNozzleTemperature:null, maxBedTemperature:null,
        buildPlateShape:'rectangular', printHeadConfiguration:null, firmwareType:null,
        startGcode:null, endGcode:null, retraction:null, materials:[], outputFormats:['gcode'],
        source:{kind:'legacy-custom-profile',url:null}, tested:false, originAtCenter:false, relativeExtrusion:false
      };
      const errors=profileErrors(profile);
      if(errors.length)throw new Error(`A saved printer profile is invalid: ${errors.join(' ')}`);
      printerProfiles.push({...profile,name:profile.model,x:profile.buildVolume.x,y:profile.buildVolume.y,
        z:profile.buildVolume.z,nozzle:profile.nozzleDiameters[0],status:profileWarnings(profile).join(' ')});
    }
  }
} catch(error) {
  showStatus(`Printer profiles could not be loaded: ${error.message}`,true);
}
let printerProfile = printerProfiles[0];
const cameraTarget = new THREE.Vector3(0, 0, 35);
const buildGroup = new THREE.Group();
scene.add(buildGroup);

function buildLabel(text, position, color = '#b7c0c9') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.font = '26px sans-serif';
  context.textAlign = 'center';
  context.fillText(text, 128, 42);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, transparent:true, depthTest:false }));
  sprite.scale.set(30, 7.5, 1);
  sprite.position.copy(position);
  buildGroup.add(sprite);
}

function makeBuildPlate() {
  buildGroup.traverse((child)=>{
    child.geometry?.dispose();
    const materials=Array.isArray(child.material)?child.material:[child.material];
    materials.filter(Boolean).forEach((material)=>{
      material.map?.dispose();
      material.dispose();
    });
  });
  buildGroup.clear();
  const { x:plateWidth, y:plateDepth, z:plateHeight } = printerProfile;
  if (![plateWidth,plateDepth,plateHeight].every((value)=>Number.isFinite(value)&&value>0)) return;
  const frameColor = new THREE.MeshStandardMaterial({ color:0x68717d, metalness:0.62, roughness:0.35 });
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(plateWidth, plateDepth, 3),
    new THREE.MeshStandardMaterial({ color:0x30343a, roughness:0.78, metalness:0.08 })
  );
  bed.position.z = -1.5;
  buildGroup.add(bed);
  const grid = new THREE.GridHelper(plateWidth, Math.max(2, Math.round(plateWidth / 10)), 0x7d8b98, 0x48515b);
  grid.rotation.x = Math.PI / 2;
  grid.scale.z = plateDepth / plateWidth;
  grid.position.z = 0.05;
  buildGroup.add(grid);
  const boundary = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(plateWidth, plateDepth, plateHeight)),
    new THREE.LineBasicMaterial({ color:0x48c9e2, transparent:true, opacity:0.62 })
  );
  boundary.position.z = plateHeight / 2;
  buildGroup.add(boundary);
  const rod = (width, height, depth, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width,height,depth),frameColor);
    mesh.position.set(x,y,z);
    buildGroup.add(mesh);
  };
  const halfX=plateWidth/2, halfY=plateDepth/2;
  const legWidth=Math.min(5,plateWidth/35), legDepth=Math.min(5,plateDepth/35);
  for (const x of [-halfX,halfX]) for (const y of [-halfY,halfY]) {
    rod(legWidth,legDepth,plateHeight,x,y,plateHeight/2);
  }
  rod(plateWidth+legWidth,legDepth,legWidth,0,-halfY,plateHeight);
  rod(plateWidth+legWidth,legDepth,legWidth,0,halfY,plateHeight);
  rod(legWidth,plateDepth+legDepth,legWidth,-halfX,0,plateHeight);
  rod(legWidth,plateDepth+legDepth,legWidth,halfX,0,plateHeight);
  rod(plateWidth*0.78,4,4,0,0,plateHeight*0.72);
  const gantry = new THREE.Mesh(
    new THREE.BoxGeometry(plateWidth*0.72,plateDepth*0.62,2),
    new THREE.MeshBasicMaterial({color:0x31c8e5,transparent:true,opacity:0.035,side:THREE.DoubleSide,depthWrite:false})
  );
  gantry.position.z=plateHeight/2;
  buildGroup.add(gantry);
  buildLabel(`${plateWidth} × ${plateDepth} mm`,new THREE.Vector3(0,-halfY-9,1));
  buildLabel(`${plateHeight} mm Z`,new THREE.Vector3(halfX+12,0,plateHeight/2));
  const axes = new THREE.AxesHelper(28);
  axes.position.set(-halfX+4,-halfY+4,0.2);
  buildGroup.add(axes);
}
makeBuildPlate();
scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4149, 2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(100, -120, 260);
scene.add(keyLight);

const objects = [];
let selectedObject = null;
let gcodeResult = null;
let sliceRequestId = 0;
let toolpathGroup = new THREE.Group();
scene.add(toolpathGroup);

function resize() {
  const rect = viewport.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
requestAnimationFrame(resize);

let yaw = 0.72;
let pitch = 0.62;
let cameraDistance = 370;
function updateCamera() {
  camera.position.set(
    cameraTarget.x + cameraDistance * Math.cos(pitch) * Math.cos(yaw),
    cameraTarget.y + cameraDistance * Math.cos(pitch) * Math.sin(yaw),
    cameraTarget.z + cameraDistance * Math.sin(pitch)
  );
  camera.lookAt(cameraTarget);
}
function fitPrinterView() {
  const maxDimension=Math.max(printerProfile.x,printerProfile.y,printerProfile.z);
  cameraDistance=maxDimension*1.72;
  cameraTarget.set(0,0,printerProfile.z/2);
  updateCamera();
}
fitPrinterView();

let pointerAction = null;
const selectionRaycaster = new THREE.Raycaster();
const selectionPointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerAction = { x:event.clientX, y:event.clientY, yaw, pitch, target:cameraTarget.clone(), type:event.button === 2 || event.shiftKey ? 'pan' : 'orbit', button:event.button };
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('contextmenu',(event)=>event.preventDefault());
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointerAction || transformControls.dragging) return;
  const dx = event.clientX - pointerAction.x;
  const dy = event.clientY - pointerAction.y;
  if (pointerAction.type === 'orbit') {
    yaw = pointerAction.yaw - dx * 0.008;
    pitch = THREE.MathUtils.clamp(pointerAction.pitch + dy * 0.008, 0.12, 1.45);
  } else {
    const right = new THREE.Vector3(Math.sin(yaw),-Math.cos(yaw),0);
    const up = new THREE.Vector3(-Math.sin(pitch)*Math.cos(yaw),-Math.sin(pitch)*Math.sin(yaw),Math.cos(pitch));
    const factor=cameraDistance/Math.max(1,viewport.clientHeight);
    cameraTarget.copy(pointerAction.target).addScaledVector(right,-dx*factor).addScaledVector(up,dy*factor);
  }
  updateCamera();
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (!pointerAction) return;
  const action=pointerAction;
  pointerAction=null;
  if(action.button!==0||Math.hypot(event.clientX-action.x,event.clientY-action.y)>5||!objects.length)return;
  const bounds=renderer.domElement.getBoundingClientRect();
  selectionPointer.set(((event.clientX-bounds.left)/bounds.width)*2-1,-((event.clientY-bounds.top)/bounds.height)*2+1);
  selectionRaycaster.setFromCamera(selectionPointer,camera);
  scene.updateMatrixWorld(true);
  const hit=selectionRaycaster.intersectObjects(objects.map((item)=>item.mesh),true)[0];
  if(hit)selectObject(objects.find((item)=>item.mesh===hit.object));
});
renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  cameraDistance = THREE.MathUtils.clamp(cameraDistance * (event.deltaY > 0 ? 1.08 : 0.92), 100, 900);
  updateCamera();
}, { passive:false });
updateCamera();

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

function invalidateSlice() {
  sliceRequestId++;
  gcodeResult=null;
  $('#export-button').disabled=true;
  $('#print-time').textContent='--';
  $('#filament-use').textContent='--';
  $('#layer-count').textContent='--';
  $('#layer-slider').max=0;
  $('#layer-slider').value=0;
  scene.remove(toolpathGroup);
  disposeSceneGroup(toolpathGroup);
  toolpathGroup=new THREE.Group();
  scene.add(toolpathGroup);
  showStatus('Changes made · slice again');
}

function disposeSceneGroup(group) {
  group.traverse((child)=>{
    child.geometry?.dispose();
    const materials=Array.isArray(child.material)?child.material:[child.material];
    materials.filter(Boolean).forEach((material)=>{
      material.map?.dispose();
      material.dispose();
    });
  });
}

function parseBinaryStl(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84) throw new Error('Invalid STL file.');
  const count = view.getUint32(80, true);
  if (84 + count * 50 !== buffer.byteLength) return null;
  const triangles = [];
  for (let i = 0; i < count; i++) {
    const offset = 84 + i * 50;
    const a = [view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true), view.getFloat32(offset + 20, true)];
    const b = [view.getFloat32(offset + 24, true), view.getFloat32(offset + 28, true), view.getFloat32(offset + 32, true)];
    const c = [view.getFloat32(offset + 36, true), view.getFloat32(offset + 40, true), view.getFloat32(offset + 44, true)];
    triangles.push(a, b, c);
  }
  return triangles;
}

function parseAsciiStl(text) {
  const vertices = [...text.matchAll(/vertex\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/gi)];
  if (!vertices.length) throw new Error('No triangles found in STL.');
  return vertices.map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
}

function geometryFromPositions(positions) {
  const geometry = new THREE.BufferGeometry();
  const flat = new Float32Array(positions.length * 3);
  positions.forEach((point, index) => {
    flat[index * 3] = point[0];
    flat[index * 3 + 1] = point[1];
    flat[index * 3 + 2] = point[2];
  });
  geometry.setAttribute('position', new THREE.BufferAttribute(flat, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function setObjectList() {
  $('#object-count').textContent = objects.length;
  const list = $('#object-list');
  list.replaceChildren();
  if (!objects.length) {
    transformControls.detach();
    $('#selected-model-name').textContent='No model selected';
    $('#model-dimensions').textContent='Size: -- × -- × -- mm';
    list.innerHTML = '<div class="empty-object">Drop STL or OBJ files here</div>';
    return;
  }
  objects.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = `object-row${item === selectedObject ? ' active' : ''}`;
    row.innerHTML = `<span class="cube">▱</span><span class="object-name"></span>`;
    row.querySelector('.object-name').textContent = item.name;
    row.addEventListener('click', () => selectObject(item));
    list.append(row);
  });
}

function selectObject(item) {
  selectedObject = item;
  objects.forEach((entry) => entry.mesh.material.emissive.setHex(entry === item ? 0x17333a : 0x000000));
  $('#pos-x').value = item.mesh.position.x.toFixed(1);
  $('#pos-y').value = item.mesh.position.y.toFixed(1);
  $('#pos-z').value = item.mesh.position.z.toFixed(1);
  $('#rotate-x').value=THREE.MathUtils.radToDeg(item.mesh.rotation.x).toFixed(1);
  $('#rotate-y').value=THREE.MathUtils.radToDeg(item.mesh.rotation.y).toFixed(1);
  $('#rotate-z').value=THREE.MathUtils.radToDeg(item.mesh.rotation.z).toFixed(1);
  const dimensions=dimensionsFromScale(item.baseSize,item.mesh.scale.toArray());
  ['size-x','size-y','size-z'].forEach((id,axis)=>$('#'+id).value=dimensions[axis].toFixed(1));
  $('#selected-model-name').textContent=item.name;
  $('#model-dimensions').textContent=`Size: ${dimensions.map((value)=>value.toFixed(1)).join(' × ')} mm`;
  transformControls.attach(item.mesh);
  setObjectList();
}

async function importFiles(fileList) {
  let imported=0;
  for (const file of Array.from(fileList)) {
    try {
      if(file.size>128*1024*1024)throw new Error(`${file.name}: file exceeds 128 MB.`);
      const buffer = await file.arrayBuffer();
      let positions;
      if (/\.obj$/i.test(file.name)) positions = positionsFromObject(new OBJLoader().parse(new TextDecoder().decode(buffer)));
      else if (/\.stl$/i.test(file.name)) {
        positions = parseBinaryStl(buffer);
        if (!positions) positions = parseAsciiStl(new TextDecoder().decode(buffer));
      } else {
        const loaded=await loadMeshObject(file.name,buffer);
        positions=positionsFromObject(loaded);
      }
      if (positions.length < 9) throw new Error('Mesh contains too few vertices.');
      if(positions.length/3>300_000)throw new Error(`${file.name}: exceeds the 300,000 triangle browser limit.`);
      positions=normalizePositionsAtPlate(positions);
      const geometry=geometryFromPositions(positions);
      geometry.computeBoundingBox();
      const box=geometry.boundingBox;
      const baseSize=[box.max.x-box.min.x,box.max.y-box.min.y,box.max.z-box.min.z];
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0x78a8c5, emissive: 0x000000, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide
      }));
      mesh.geometry.computeBoundingBox();
      mesh.position.set(objects.length ? 0 : 0, objects.length ? 0 : 0, 0);
      scene.add(mesh);
      const item = { name:file.name, mesh, positions, baseSize };
      objects.push(item);
      imported++;
      selectObject(item);
      placeOnPlate(item);
    } catch (error) {
      showStatus(error.message, true);
    }
  }
  setObjectList();
  if(imported){
    try{arrangeObjects();}catch(error){showStatus(error.message,true);}
    invalidateSlice();
  }
}

async function loadMeshObject(filename,buffer) {
  const extension=filename.split('.').at(-1).toLowerCase();
  if(extension==='amf')return new AMFLoader().parse(buffer);
  if(extension==='3mf')return new ThreeMFLoader().parse(buffer);
  if(extension==='dae')return new ColladaLoader().parse(new TextDecoder().decode(buffer),'').scene;
  if(extension==='ply'){
    const geometry=new PLYLoader().parse(buffer);
    return new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());
  }
  if(extension==='gltf'||extension==='glb'){
    if(extension==='gltf'){
      const document=JSON.parse(new TextDecoder().decode(buffer));
      const external=[...(document.buffers||[]),...(document.images||[])].some((entry)=>entry.uri&&!entry.uri.startsWith('data:'));
      if(external)throw new Error('This GLTF references external files. Embed its buffers and images or use GLB.');
    }
    return (await new GLTFLoader().parseAsync(buffer,'')).scene;
  }
  throw new Error('Supported imports: STL, OBJ, PLY, AMF, 3MF, DAE, GLTF, and GLB.');
}

function positionsFromObject(root) {
  const positions=[];
  root.updateMatrixWorld(true);
  root.traverse((child)=>{
    if(!child.isMesh||!child.geometry?.attributes?.position)return;
    const geometry=child.geometry;
    const vertices=geometry.attributes.position;
    const indices=geometry.index;
    const count=indices?indices.count:vertices.count;
    if(count%3!==0)throw new Error('Imported mesh contains non-triangle geometry.');
    const point=new THREE.Vector3();
    for(let index=0;index<count;index++){
      point.fromBufferAttribute(vertices,indices?indices.getX(index):index).applyMatrix4(child.matrixWorld);
      positions.push([point.x,point.y,point.z]);
    }
  });
  if(!positions.length)throw new Error('No triangle mesh geometry was found in the selected file.');
  return positions;
}

function placeOnPlate(item) {
  item.mesh.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(item.mesh);
  item.mesh.position.z-=bounds.min.z;
  if(item===selectedObject)syncTransformInputs();
}

function arrangeObjects(){
  scene.updateMatrixWorld(true);
  const footprints=objects.map((item)=>{
    const bounds=new THREE.Box3().setFromObject(item.mesh);
    return {name:item.name,width:bounds.max.x-bounds.min.x,depth:bounds.max.y-bounds.min.y};
  });
  const placements=arrangeFootprints(footprints,{x:printerProfile.x,y:printerProfile.y});
  objects.forEach((item,index)=>{
    item.mesh.position.x=placements[index][0];
    item.mesh.position.y=placements[index][1];
    placeOnPlate(item);
  });
  syncTransformInputs();
}

function syncTransformInputs() {
  if (!selectedObject) return;
  $('#pos-x').value=selectedObject.mesh.position.x.toFixed(1);
  $('#pos-y').value=selectedObject.mesh.position.y.toFixed(1);
  $('#pos-z').value=selectedObject.mesh.position.z.toFixed(1);
  const dimensions=dimensionsFromScale(selectedObject.baseSize,selectedObject.mesh.scale.toArray());
  ['size-x','size-y','size-z'].forEach((id,axis)=>$('#'+id).value=dimensions[axis].toFixed(1));
  $('#model-dimensions').textContent=`Size: ${dimensions.map((value)=>value.toFixed(1)).join(' × ')} mm`;
  ['rotate-x','rotate-y','rotate-z'].forEach((id,axis)=>$('#'+id).value=THREE.MathUtils.radToDeg(selectedObject.mesh.rotation[['x','y','z'][axis]]).toFixed(1));
}

$('#model-file').addEventListener('change', (event) => importFiles(event.target.files));
for (const eventName of ['dragenter','dragover']) viewport.addEventListener(eventName,(event)=>{event.preventDefault();viewport.classList.add('dragging');});
for (const eventName of ['dragleave','drop']) viewport.addEventListener(eventName,(event)=>{
  event.preventDefault();viewport.classList.remove('dragging');
  if(eventName==='drop') importFiles(event.dataTransfer.files);
});

function addSettingEvents() {
  ['pos-x','pos-y','pos-z'].forEach((id,axis)=>$('#'+id).addEventListener('change',()=>{
    if(!selectedObject)return;
    const value=Number($('#'+id).value);
    if(!Number.isFinite(value)){showStatus('Enter a finite position for the selected model.',true);syncTransformInputs();return;}
    selectedObject.mesh.position[['x','y','z'][axis]]=value;
    invalidateSlice();
  }));
  const applyRotation=()=>{
    if(!selectedObject)return;
    const degrees=['rotate-x','rotate-y','rotate-z'].map((id)=>Number($('#'+id).value));
    if(degrees.some((value)=>!Number.isFinite(value))){showStatus('Enter a finite rotation for each model axis.',true);syncTransformInputs();return;}
    selectedObject.mesh.rotation.set(...degrees.map((value)=>THREE.MathUtils.degToRad(value)));
    placeOnPlate(selectedObject);
    invalidateSlice();
  };
  ['rotate-x','rotate-y','rotate-z'].forEach((id)=>$('#'+id).addEventListener('change',applyRotation));
  $$('[data-rotate-axis]').forEach((button)=>button.addEventListener('click',()=>{
    if(!selectedObject)return;
    const axis=button.dataset.rotateAxis;
    const current=THREE.MathUtils.radToDeg(selectedObject.mesh.rotation[axis]);
    const degrees=((current+Number(button.dataset.rotateDegrees)+180)%360+360)%360-180;
    selectedObject.mesh.rotation[axis]=THREE.MathUtils.degToRad(degrees);
    placeOnPlate(selectedObject);
    invalidateSlice();
  }));
  ['size-x','size-y','size-z'].forEach((id,axis)=>$('#'+id).addEventListener('change',()=>{
    if(!selectedObject)return;
    const current=dimensionsFromScale(selectedObject.baseSize,selectedObject.mesh.scale.toArray());
    const target=current.map((dimension,index)=>index===axis?Number($('#'+id).value):dimension);
    try{
      selectedObject.mesh.scale.fromArray(scaleForDimensions(selectedObject.baseSize,target,$('#uniform-scale').checked,axis));
      placeOnPlate(selectedObject);
      invalidateSlice();
    }catch(error){showStatus(error.message,true);syncTransformInputs();}
  }));
  $('#reset-size').addEventListener('click',()=>{
    if(!selectedObject)return;
    selectedObject.mesh.scale.set(1,1,1);
    placeOnPlate(selectedObject);
    invalidateSlice();
  });
  $('#reset-rotation').addEventListener('click',()=>{
    if(!selectedObject)return;
    selectedObject.mesh.rotation.set(0,0,0);
    placeOnPlate(selectedObject);
    invalidateSlice();
  });
  $('#center-object').addEventListener('click', () => {
    if (!selectedObject) return;
    selectedObject.mesh.position.x = 0;
    selectedObject.mesh.position.y = 0;
    syncTransformInputs();
    invalidateSlice();
  });
  $('#plate-object').addEventListener('click', () => {
    if(!selectedObject)return;
    placeOnPlate(selectedObject);
    invalidateSlice();
  });
  $('#delete-object').addEventListener('click', () => {
    if (!selectedObject) return;
    scene.remove(selectedObject.mesh);
    selectedObject.mesh.geometry.dispose();
    selectedObject.mesh.material.dispose();
    objects.splice(objects.indexOf(selectedObject), 1);
    selectedObject = objects[0] || null;
    if (selectedObject) selectObject(selectedObject);
    setObjectList();
    invalidateSlice();
  });
  $('#duplicate-object').addEventListener('click', () => {
    if (!selectedObject) return;
    const mesh = selectedObject.mesh.clone();
    mesh.geometry=selectedObject.mesh.geometry.clone();
    mesh.material=selectedObject.mesh.material.clone();
    mesh.position.x += 20;
    mesh.position.y += 20;
    scene.add(mesh);
    const item = {name:`${selectedObject.name} copy`, mesh, positions:selectedObject.positions, baseSize:[...selectedObject.baseSize]};
    objects.push(item);
    selectObject(item);
    invalidateSlice();
  });
  $('#arrange-object').addEventListener('click', () => {
    try{arrangeObjects();invalidateSlice();showStatus('Models arranged on the build plate');}
    catch(error){showStatus(error.message,true);}
  });
}
addSettingEvents();
$('#transform-toggle').addEventListener('click',()=>{
  const expanded=$('#transform-tools').classList.toggle('open');
  $('#transform-toggle').setAttribute('aria-expanded',String(expanded));
});
$$('[data-transform]').forEach((button)=>button.addEventListener('click',()=>{
  transformControls.setMode(button.dataset.transform);
  $$('[data-transform]').forEach((entry)=>entry.classList.toggle('active',entry===button));
}));
$('#fit-view').addEventListener('click',fitPrinterView);
$('#arrange-mobile').addEventListener('click',()=>$('#arrange-object').click());

for (const tab of $$('.tabs button')) tab.addEventListener('click', () => {
  $$('.tabs button').forEach((button) => button.classList.remove('active'));
  tab.classList.add('active');
  $('#print-tab').classList.toggle('hidden', tab.dataset.tab !== 'print');
  $('#printer-tab').classList.toggle('hidden', tab.dataset.tab !== 'printer');
});

for (const button of $$('[data-view]')) button.addEventListener('click', () => {
  $$('[data-view]').forEach((entry) => entry.classList.remove('active'));
  button.classList.add('active');
  const distance=Math.max(printerProfile.x,printerProfile.y,printerProfile.z)*1.72;
  cameraTarget.set(0,0,printerProfile.z/2);
  if (button.dataset.view === 'top') { camera.position.set(0,0,cameraTarget.z+distance);camera.up.set(0,1,0); }
  else if (button.dataset.view === 'front') { camera.position.set(0,-distance,cameraTarget.z+distance*0.16);camera.up.set(0,0,1); }
  else if (button.dataset.view === 'side') { camera.position.set(distance,0,cameraTarget.z+distance*0.16);camera.up.set(0,0,1); }
  else { camera.up.set(0,0,1);fitPrinterView();return; }
  camera.lookAt(cameraTarget);
});

document.addEventListener('keydown',(event)=>{
  if(event.target instanceof HTMLElement&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(event.key==='Delete'||event.key==='Backspace'){
    if(selectedObject){event.preventDefault();$('#delete-object').click();}
  }else if(event.ctrlKey&&event.key.toLowerCase()==='d'){
    if(selectedObject){event.preventDefault();$('#duplicate-object').click();}
  }else if(event.key.toLowerCase()==='f'){
    event.preventDefault();fitPrinterView();
  }else if(['1','2','3'].includes(event.key)){
    const mode={1:'translate',2:'rotate',3:'scale'}[event.key];
    $(`[data-transform="${mode}"]`).click();
  }
});

for(const button of $$('[data-menu]')){
  button.addEventListener('click',()=>{
    switch(button.dataset.menu){
      case 'file': $('#project-file').click(); break;
      case 'edit': $('#duplicate-object').click(); break;
      case 'view': $('[data-view="perspective"]').click(); break;
      case 'printer': $('[data-tab="printer"]').click(); break;
      case 'settings': $('[data-tab="print"]').click(); break;
      case 'help': showStatus('CuraEngine-generated G-code is not physically validated; verify it for your exact printer before use.'); break;
      default: showStatus(`Menu action "${button.dataset.menu}" is unavailable.`,true);
    }
  });
}

function showStatus(text, isError=false) {
  $('.bottom-panel .slice-status').classList.toggle('error', isError);
  $('.bottom-panel .slice-status').classList.remove('slicing');
  $('#status-text').textContent = text;
}

function collectMeshTriangles() {
  const triangles = [];
  objects.forEach((item) => {
    const geometry = item.mesh.geometry;
    const positions = geometry.attributes.position;
    const matrix = item.mesh.matrixWorld;
    const vector = new THREE.Vector3();
    for (let i = 0; i < positions.count; i += 3) {
      for (let j = 0; j < 3; j++) {
        vector.fromBufferAttribute(positions, i+j).applyMatrix4(matrix);
        triangles.push([vector.x,vector.y,vector.z]);
      }
    }
  });
  return triangles;
}

function ensureModelFitsBuildVolume(triangles, profile) {
  const bounds = { minX:Infinity, minY:Infinity, minZ:Infinity, maxX:-Infinity, maxY:-Infinity, maxZ:-Infinity };
  for (const [x,y,z] of triangles) {
    bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);
    bounds.minY=Math.min(bounds.minY,y);bounds.maxY=Math.max(bounds.maxY,y);
    bounds.minZ=Math.min(bounds.minZ,z);bounds.maxZ=Math.max(bounds.maxZ,z);
  }
  const tolerance=0.01;
  if(bounds.minX < -profile.x/2-tolerance || bounds.maxX > profile.x/2+tolerance ||
     bounds.minY < -profile.y/2-tolerance || bounds.maxY > profile.y/2+tolerance ||
     bounds.minZ < -tolerance || bounds.maxZ > profile.z+tolerance){
    throw new Error(`Model is outside the ${profile.x} × ${profile.y} × ${profile.z} mm build volume.`);
  }
}

function filamentDensity() {
  return {pla:1.24,petg:1.27,abs:1.04}[$('#filament-profile').value]||1.24;
}

function updateSliceResult(result) {
  gcodeResult=result;
  $('.bottom-panel .slice-status').classList.remove('slicing');
  $('#status-text').textContent='Slice complete';
  const minutes=result.estimatedMinutes;
  if(Number.isFinite(minutes)&&minutes>0){
    const hours=Math.floor(minutes/60),remaining=Math.round(minutes%60);
    $('#print-time').textContent=hours?`${hours}h ${remaining}m`:`${remaining}m`;
  }else $('#print-time').textContent='--';
  $('#filament-use').textContent=Number.isFinite(result.filamentMm)
    ?`${result.filamentMm.toFixed(1)} mm · ${result.filamentGrams.toFixed(1)} g`:'--';
  $('#layer-count').textContent=result.layers.length;
  $('#export-button').disabled=!availableOutputFormats(printerProfile).includes($('#output-format').value);
  $('#layer-slider').max=Math.max(0,result.layers.length-1);
  $('#layer-slider').value=String(result.layers.length-1);
  renderToolpaths(result.layers.length-1);
}

const expectedCuraFlavors={
  'RepRap (Marlin/Sprinter)':'Marlin',
  'RepRap (Volumetric)':'Marlin (Volumetric)',
  'RepRap (RepRap)':'RepRap',
  UltiGCode:'Ultimaker 2',
  Griffin:'Griffin',
  Makerbot:'Makerbot',
  BFB:'Bits from Bytes',
  MACH3:'Mach3',
  Repetier:'Repetier'
};

$('#slice-button').addEventListener('click', async () => {
  if (!objects.length) return showStatus('Import a model before slicing.', true);
  if (![printerProfile.x,printerProfile.y,printerProfile.z,printerProfile.filamentDiameter]
    .every((value)=>Number.isFinite(Number(value))&&Number(value)>0)){
    return showStatus('This printer profile is incomplete. Add build volume and filament diameter before slicing.',true);
  }
  if(!printerProfile.nozzleDiameters.length){
    return showStatus('This printer profile has no verified nozzle diameter options.',true);
  }
  if(typeof printerProfile.originAtCenter!=='boolean'){
    return showStatus('This printer profile does not specify its coordinate origin.',true);
  }
  if(printerProfile.extruderCount!==1){
    return showStatus('The current CuraEngine integration supports single-extruder printers only.',true);
  }
  if(['circular','custom'].includes(printerProfile.buildPlateShape)){
    return showStatus('The current CuraEngine integration supports rectangular build plates only.',true);
  }
  const selectedNozzle=Number($('#nozzle-diameter').value);
  if(!printerProfile.nozzleDiameters.some((diameter)=>Math.abs(Number(diameter)-selectedNozzle)<0.0001)){
    return showStatus('Selected nozzle diameter is not listed by this printer profile.',true);
  }
  if(!availableOutputFormats(printerProfile).length){
    return showStatus('This printer profile has no output format supported by the current exporter.',true);
  }
  if(printerProfile.firmwareType&&!Object.hasOwn(expectedCuraFlavors,printerProfile.firmwareType)){
    return showStatus(`CuraEngine does not support the ${printerProfile.firmwareType} firmware flavor.`,true);
  }
  if(printerProfile.manufacturer!=='Custom'&&!printerProfile.firmwareType){
    return showStatus('This printer profile does not specify a firmware flavor.',true);
  }
  if(printerProfile.manufacturer!=='Custom'&&(!printerProfile.startGcode?.trim()||!printerProfile.endGcode?.trim())){
    return showStatus('This printer profile is missing required start or end G-code.',true);
  }
  if(Number($('#bed-temp').value)>0&&printerProfile.heatedBed!==true){
    return showStatus('This profile does not confirm a heated bed. Set bed temperature to 0 or complete the printer profile.',true);
  }
  sliceRequestId++;
  const requestId=sliceRequestId;
  gcodeResult = null;
  $('#export-button').disabled = true;
  $('.bottom-panel .slice-status').classList.add('slicing');
  $('#status-text').textContent = 'Preparing CuraEngine...';
  const settings = {
    layerHeight:Number($('#layer-height').value), lineWidth:Number($('#line-width').value),
    wallCount:Number($('#wall-count').value), infillDensity:Number($('#infill-density').value),
    solidLayerCount:Number($('#solid-layer-count').value),
    infillPattern:$('#infill-pattern').value,
    adhesion:$('#adhesion').value, nozzleTemperature:Number($('#nozzle-temp').value),
    bedTemperature:Number($('#bed-temp').value), printSpeed:Number($('#print-speed').value),
    flowRate:Number($('#flow-rate').value), filamentDiameter:printerProfile.filamentDiameter,
    supports:$('#supports').checked,
    nozzleDiameter:selectedNozzle,
    maxNozzleTemperature:printerProfile.maxNozzleTemperature,
    maxBedTemperature:printerProfile.maxBedTemperature,
    originAtCenter:printerProfile.originAtCenter,
    relativeExtrusion:printerProfile.relativeExtrusion,
    extruderCount:printerProfile.extruderCount,
    retraction:printerProfile.retraction,
    startGcode:printerProfile.startGcode,
    endGcode:printerProfile.endGcode,
    buildVolume:{x:printerProfile.x,y:printerProfile.y,z:printerProfile.z}
  };
  if(settings.maxNozzleTemperature!=null&&settings.nozzleTemperature>settings.maxNozzleTemperature){
    return showStatus('Selected nozzle temperature exceeds the printer profile maximum.',true);
  }
  if(settings.maxBedTemperature!=null&&settings.bedTemperature>settings.maxBedTemperature){
    return showStatus('Selected bed temperature exceeds the printer profile maximum.',true);
  }
  scene.updateMatrixWorld(true);
  const triangles=collectMeshTriangles();
  let engine;
  try{
    ensureModelFitsBuildVolume(triangles,printerProfile);
    if(settings.lineWidth>selectedNozzle*2||settings.layerHeight>selectedNozzle){
      throw new Error('Layer height or line width is incompatible with the selected nozzle diameter.');
    }
    engine=new CuraWASM({overrides:buildCuraOverrides(printerProfile,settings),transfer:true,verbose:false});
    engine.on('progress',(percent)=>{
      if(requestId===sliceRequestId)$('#status-text').textContent=`CuraEngine ${percent}%`;
    });
    const stl=trianglesToBinaryStl(triangles);
    const {gcode,metadata}=await engine.slice(stl,'stl');
    if(requestId!==sliceRequestId)return;
    const gcodeText=new TextDecoder().decode(gcode);
    const layers=parseCuraGcode(gcodeText,printerProfile);
    const expectedFlavor=expectedCuraFlavors[printerProfile.firmwareType||'RepRap (Marlin/Sprinter)'];
    if(metadata?.flavor&&metadata.flavor!==expectedFlavor){
      throw new Error(`CuraEngine generated ${metadata.flavor} G-code, but the selected profile requires ${expectedFlavor}.`);
    }
    for(const template of [printerProfile.startGcode,printerProfile.endGcode]){
      const firstCommand=template?.split(/\r?\n/).map((line)=>line.trim()).find((line)=>line&&!line.startsWith(';'));
      if(firstCommand&&!gcodeText.includes(firstCommand))throw new Error('CuraEngine output is missing a required printer-specific G-code command.');
    }
    updateSliceResult({
      gcode:gcodeText,
      layers,
      ...curaMetadataToStats(metadata,printerProfile.filamentDiameter,filamentDensity())
    });
  }catch(error){
    if(requestId===sliceRequestId)showStatus(`CuraEngine failed: ${error.message}`,true);
  }finally{
    if(engine){
      try{await engine.destroy();}catch{}
    }
  }
});

function renderToolpaths(layerIndex) {
  scene.remove(toolpathGroup);
  disposeSceneGroup(toolpathGroup);
  toolpathGroup = new THREE.Group();
  if (!gcodeResult?.layers?.[layerIndex]) return;
  const layer=gcodeResult.layers[layerIndex];
  const grouped=new Map();
  for(const move of layer.moves){
    if(!grouped.has(move.kind))grouped.set(move.kind,[]);
    grouped.get(move.kind).push(move.x1,move.y1,move.z,move.x2,move.y2,move.z);
  }
  for(const [kind,vertices] of grouped){
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    const color=kind==='wall'?0x56aee8:kind==='infill'?0xf0a34b:kind==='support'?0xb879dc:0x8f949c;
    toolpathGroup.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({
      color,transparent:true,opacity:kind==='travel'?0.25:0.95
    })));
  }
  scene.add(toolpathGroup);
}
$('#layer-slider').addEventListener('input',(event)=>renderToolpaths(Number(event.target.value)));
$('#layer-first').addEventListener('click',()=>{$('#layer-slider').value=0;renderToolpaths(0)});
$('#layer-last').addEventListener('click',()=>{if(!gcodeResult)return;const last=gcodeResult.layers.length-1;$('#layer-slider').value=last;renderToolpaths(last)});

$('#export-button').addEventListener('click',()=>{
  if(!gcodeResult)return;
  if($('#output-format').value!=='gcode')return showStatus('The selected output format has no validated exporter.',true);
  const blob=new Blob([gcodeResult.gcode],{type:'text/x-gcode'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='prism-slice.gcode';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showStatus('G-code exported');
});

$('#save-project').addEventListener('click',()=>{
  const project={version:2,printer:$('#printer-profile').value,filament:$('#filament-profile').value,objects:objects.map((item)=>(
{
    name:item.name,position:item.mesh.position.toArray(),scale:item.mesh.scale.toArray(),
    rotation:[item.mesh.rotation.x,item.mesh.rotation.y,item.mesh.rotation.z],positions:item.positions
  })),settings:{
    layerHeight:$('#layer-height').value,infillDensity:$('#infill-density').value,infillPattern:$('#infill-pattern').value,
    supports:$('#supports').checked,adhesion:$('#adhesion').value
  }};
  const blob=new Blob([JSON.stringify(project)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const link=document.createElement('a');
  link.href=url;link.download='prism-project.prism';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  showStatus('Project saved');
});

$('#project-file').addEventListener('change',async(event)=>{
  const file=event.target.files?.[0];
  event.target.value='';
  if(!file)return;
  try{
    if(file.size>128*1024*1024)throw new Error('Project file exceeds 128 MB.');
    const project=JSON.parse(await file.text());
    if(![1,2].includes(project.version)||!Array.isArray(project.objects))throw new Error('Unsupported or invalid Prism project.');
    const restored=project.objects.map((entry)=>{
      if(!Array.isArray(entry.positions)||entry.positions.length<3||
         entry.positions.some((point)=>!Array.isArray(point)||point.length!==3||point.some((value)=>!Number.isFinite(value)))||
         !Array.isArray(entry.position)||entry.position.length!==3||entry.position.some((value)=>!Number.isFinite(value))||
         !Array.isArray(entry.scale)||entry.scale.length!==3||entry.scale.some((value)=>!Number.isFinite(value)||value<=0)){
        throw new Error('Project contains invalid model geometry or transforms.');
      }
      const positions=project.version===1?normalizePositionsAtPlate(entry.positions):entry.positions;
      const geometry=geometryFromPositions(positions);
      geometry.computeBoundingBox();
      const bounds=geometry.boundingBox;
      const baseSize=[bounds.max.x-bounds.min.x,bounds.max.y-bounds.min.y,bounds.max.z-bounds.min.z];
      const mesh=new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({color:0x78a8c5,roughness:0.55,metalness:0.05,side:THREE.DoubleSide})
      );
      mesh.position.fromArray(entry.position);
      mesh.scale.fromArray(entry.scale);
      mesh.rotation.fromArray(entry.rotation||[0,0,0]);
      return {name:String(entry.name||'Imported model'),mesh,positions,baseSize};
    });
    objects.forEach((item)=>{scene.remove(item.mesh);item.mesh.geometry.dispose();item.mesh.material.dispose();});
    objects.splice(0,objects.length,...restored);
    objects.forEach((item)=>scene.add(item.mesh));
    selectedObject=objects[0]||null;
    if(selectedObject)selectObject(selectedObject);
    else setObjectList();
    const profile=printerProfiles.find((item)=>item.id===project.printer);
    if(profile){printerProfile=profile;renderPrinterOptions();applyPrinterProfile();}
    if(['pla','petg','abs'].includes(project.filament)){
      $('#filament-profile').value=project.filament;
      const temperatures={pla:['205','60'],petg:['235','80'],abs:['245','100']}[project.filament];
      $('#nozzle-temp').value=temperatures[0];
      $('#bed-temp').value=temperatures[1];
    }
    if(project.settings){
      for(const [key,value] of Object.entries({
        layerHeight:project.settings.layerHeight,
        infillDensity:project.settings.infillDensity,
        infillPattern:project.settings.infillPattern,
        adhesion:project.settings.adhesion
      })){
        if(value!==undefined)$(`#${key.replace(/[A-Z]/g,(letter)=>`-${letter.toLowerCase()}`)}`).value=value;
      }
    }
    invalidateSlice();
    showStatus(`Opened project · ${objects.length} model${objects.length===1?'':'s'}`);
  }catch(error){showStatus(error.message,true);}
});

function renderPrinterOptions(query=$('#printer-search').value) {
  const search=query.trim().toLowerCase();
  const manufacturerSelect=$('#printer-manufacturer');
  const manufacturers=[...new Set(printerProfiles.map((profile)=>profile.manufacturer))].sort();
  const previousManufacturer=manufacturerSelect.value||printerProfile.manufacturer;
  manufacturerSelect.replaceChildren(...manufacturers.map((manufacturer)=>new Option(manufacturer,manufacturer)));
  manufacturerSelect.value=manufacturers.includes(previousManufacturer)?previousManufacturer:manufacturers[0]||'';
  const manufacturerProfiles=printerProfiles.filter((profile)=>profile.manufacturer===manufacturerSelect.value);
  const seriesSelect=$('#printer-series');
  const series=[...new Set(manufacturerProfiles.map((profile)=>profile.series))].sort();
  const previousSeries=seriesSelect.value||printerProfile.series;
  seriesSelect.replaceChildren(...series.map((value)=>new Option(value,value)));
  seriesSelect.value=series.includes(previousSeries)?previousSeries:series[0]||'';
  const filtered=manufacturerProfiles.filter((profile)=>profile.series===seriesSelect.value&&
    `${profile.manufacturer} ${profile.series} ${profile.model}`.toLowerCase().includes(search));
  const select=$('#printer-profile');
  select.replaceChildren();
  if(!filtered.length){
    select.add(new Option('No matching printer models',''));
    return;
  }
  filtered.forEach((profile)=>{
    const option=document.createElement('option');
    option.value=profile.id;
    option.textContent=profile.model;
    select.append(option);
  });
  select.value=filtered.some((profile)=>profile.id===printerProfile.id)?printerProfile.id:filtered[0].id;
}

function applyPrinterProfile() {
  $('#printer-name').textContent=`${printerProfile.manufacturer} ${printerProfile.name}`;
  const hasBuildVolume=[printerProfile.x,printerProfile.y,printerProfile.z].every((value)=>Number.isFinite(Number(value))&&Number(value)>0);
  $('#printer-volume').textContent=hasBuildVolume?`${printerProfile.x} × ${printerProfile.y} × ${printerProfile.z} mm`:'Build volume unspecified';
  const warnings=profileWarnings(printerProfile);
  if(printerProfile.buildPlateShape!=='rectangular')warnings.push('The slicer currently supports rectangular build plates only.');
  if(!availableOutputFormats(printerProfile).length)warnings.push('No compatible printer output format has an implemented exporter.');
  $('#printer-warning').textContent=warnings.length?warnings.join(' '):'Profile fields are complete; physical printer testing is still required.';
  $('#printer-warning').classList.toggle('warning-complete',warnings.length===0);
  $('#volume-x').value=printerProfile.x;
  $('#volume-y').value=printerProfile.y;
  $('#volume-z').value=printerProfile.z;
  const nozzleSelect=$('#nozzle-diameter');
  nozzleSelect.replaceChildren(...printerProfile.nozzleDiameters.map((diameter)=>new Option(`${diameter} mm`,String(diameter))));
  nozzleSelect.disabled=!printerProfile.nozzleDiameters.length;
  if(printerProfile.nozzleDiameters.length)nozzleSelect.value=String(printerProfile.nozzle);
  if(printerProfile.heatedBed!==true)$('#bed-temp').value=0;
  $('#profile-name').value=printerProfile.model;
  $('#profile-manufacturer').value=printerProfile.manufacturer;
  $('#profile-filament-diameter').value=printerProfile.filamentDiameter??'';
  $('#profile-extruders').value=printerProfile.extruderCount??'';
  $('#profile-max-nozzle').value=printerProfile.maxNozzleTemperature??'';
  $('#profile-max-bed').value=printerProfile.maxBedTemperature??'';
  $('#profile-plate-shape').value=printerProfile.buildPlateShape||'rectangular';
  $('#profile-heated-bed').checked=printerProfile.heatedBed===true;
  $('#profile-origin-center').checked=printerProfile.originAtCenter===true;
  $('#profile-relative-extrusion').checked=printerProfile.relativeExtrusion===true;
  $('#profile-nozzles').value=(printerProfile.nozzleDiameters||[]).join(', ');
  $('#profile-firmware').value=printerProfile.firmwareType||'';
  $('#profile-head').value=printerProfile.printHeadConfiguration||'';
  $('#profile-materials').value=(printerProfile.materials||[]).join(', ');
  $('#profile-retraction-distance').value=printerProfile.retraction?.distance??'';
  $('#profile-retraction-speed').value=printerProfile.retraction?.speed??'';
  $('#profile-start-gcode').value=printerProfile.startGcode||'';
  $('#profile-end-gcode').value=printerProfile.endGcode||'';
  $('#save-profile').textContent=/^(custom|imported)-/.test(printerProfile.id)
    ?'Update custom printer':'Save as custom printer';
  $('#printer-details').textContent=[
    `${printerProfile.extruderCount||'Unspecified'} extruder(s)`,
    `${printerProfile.filamentDiameter||'Unspecified'} mm filament`,
    printerProfile.heatedBed===null?'Heated bed unspecified':printerProfile.heatedBed?'Heated bed':'No heated bed',
    `Firmware: ${printerProfile.firmwareType||'unspecified'}`,
    `Materials: ${printerProfile.materials?.join(', ')||'unspecified'}`
  ].join(' · ');
  const outputIds=printerProfile.outputFormats||[];
  const templateIssues=unsupportedGcodeTokens(printerProfile);
  $('#printer-outputs').textContent=`Profile formats: ${outputIds.map((id)=>OUTPUT_FORMATS[id]?.label||id).join(', ')||'none'} · Available here: ${availableOutputFormats(printerProfile).map((id)=>OUTPUT_FORMATS[id].label).join(', ')||'none'}${templateIssues.length?` · Unsupported G-code tokens: ${templateIssues.join(', ')}`:''}`;
  const image=$('#printer-image');
  image.hidden=!printerProfile.image;
  image.src=printerProfile.image||'';
  $('#printer-image-empty').hidden=Boolean(printerProfile.image);
  const formats=availableOutputFormats(printerProfile);
  const formatSelect=$('#output-format');
  formatSelect.replaceChildren(...formats.map((id)=>new Option(OUTPUT_FORMATS[id].label,id)));
  formatSelect.disabled=!formats.length;
  $('#export-button').textContent=formats.length?`Export ${OUTPUT_FORMATS[formats[0]].label}`:'Export unavailable';
  $('#export-button').disabled=!gcodeResult||!formats.includes(formatSelect.value);
  makeBuildPlate();
  if(hasBuildVolume)fitPrinterView();
}

function validPrinterProfile(profile) {
  return profileErrors(profile).length===0;
}

function persistPrinterProfiles() {
  const custom=printerProfiles.filter((profile)=>profile.id.startsWith('custom-')||profile.id.startsWith('imported-'));
  try {
    localStorage.setItem('prism-printer-profiles',JSON.stringify(custom));
  } catch(error) {
    showStatus(`Printer profile could not be saved: ${error.message}`,true);
    return false;
  }
  return true;
}

$('#printer-profile').addEventListener('change',(event)=>{
  printerProfile=printerProfiles.find((profile)=>profile.id===event.target.value)||printerProfiles[0];
  applyPrinterProfile();
  invalidateSlice();
});
$('#printer-search').addEventListener('input',(event)=>renderPrinterOptions(event.target.value));
$('#printer-manufacturer').addEventListener('change',()=>{
  $('#printer-series').value='';
  renderPrinterOptions('');
});
$('#printer-series').addEventListener('change',()=>renderPrinterOptions(''));
$('#profile').addEventListener('change',(event)=>{
  const heights={draft:0.2,normal:0.16,fine:0.08};
  $('#layer-height').value=heights[event.target.value];
  invalidateSlice();
});
for(const input of $$('#print-tab input,#print-tab select')){
  input.addEventListener('change',()=>invalidateSlice());
}
$('#save-profile').addEventListener('click',()=>{
  const name=$('#profile-name').value.trim();
  const manufacturer=$('#profile-manufacturer').value.trim()||'Custom';
  const x=Number($('#volume-x').value),y=Number($('#volume-y').value),z=Number($('#volume-z').value);
  const nozzleDiameters=$('#profile-nozzles').value.split(',').map((value)=>Number(value.trim())).filter(Number.isFinite);
  const maybeNumber=(id)=>$('#'+id).value===''?null:Number($('#'+id).value);
  const retractionDistance=maybeNumber('profile-retraction-distance');
  const isEditing=/^(custom|imported)-/.test(printerProfile.id);
  const profile={
    id:isEditing?printerProfile.id:`custom-${Date.now()}`,manufacturer,series:'Custom',model:name,
    buildVolume:{x,y,z},nozzleDiameters,filamentDiameter:Number($('#profile-filament-diameter').value),
    extruderCount:Number($('#profile-extruders').value),heatedBed:$('#profile-heated-bed').checked,
    maxNozzleTemperature:maybeNumber('profile-max-nozzle'),maxBedTemperature:maybeNumber('profile-max-bed'),
    buildPlateShape:$('#profile-plate-shape').value,
    originAtCenter:$('#profile-origin-center').checked,
    relativeExtrusion:$('#profile-relative-extrusion').checked,
    printHeadConfiguration:$('#profile-head').value.trim()||null,firmwareType:$('#profile-firmware').value.trim()||null,
    startGcode:$('#profile-start-gcode').value||null,endGcode:$('#profile-end-gcode').value||null,
    retraction:retractionDistance===null?null:{distance:retractionDistance,speed:maybeNumber('profile-retraction-speed')},
    materials:$('#profile-materials').value.split(',').map((value)=>value.trim()).filter(Boolean),
    outputFormats:['gcode'],source:{kind:'user-created',url:null},tested:false
  };
  if(!validPrinterProfile(profile)||![x,y,z].every((value)=>Number.isFinite(value)&&value>=10&&value<=3000)||!nozzleDiameters.length){
    showStatus(`Profile needs correction: ${profileErrors(profile).join(' ')}`,true);
    return;
  }
  const updated={...profile,name:profile.model,x,y,z,nozzle:nozzleDiameters[0],status:profileWarnings(profile).join(' ')};
  const previousIndex=printerProfiles.findIndex((entry)=>entry.id===profile.id);
  const previous=previousIndex>=0?printerProfiles[previousIndex]:null;
  if(previous)printerProfiles[previousIndex]=updated;
  else printerProfiles.push(updated);
  if(!persistPrinterProfiles()){
    if(previous)printerProfiles[previousIndex]=previous;
    else printerProfiles.pop();
    return;
  }
  printerProfile=updated;
  $('#printer-search').value='';
  renderPrinterOptions();
  applyPrinterProfile();
  invalidateSlice();
  showStatus('Custom printer profile saved');
});

$('#import-profile').addEventListener('change',async(event)=>{
  const file=event.target.files?.[0];
  event.target.value='';
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    const candidates=Array.isArray(data)?data:(Array.isArray(data.profiles)?data.profiles:[data]);
    const imported=[];
    for(const entry of candidates){
      const profile=entry.nozzleDiameters?entry:{
        ...entry,id:`imported-${Date.now()}-${imported.length}`,series:'Custom',model:entry.name,
        nozzleDiameters:[entry.nozzleDiameter],filamentDiameter:1.75,extruderCount:1,
        heatedBed:null,maxNozzleTemperature:null,maxBedTemperature:null,buildPlateShape:'rectangular',
        printHeadConfiguration:null,firmwareType:null,startGcode:null,endGcode:null,retraction:null,
        materials:[],outputFormats:['gcode'],source:{kind:'imported-legacy',url:null},tested:false,originAtCenter:false,relativeExtrusion:false
      };
      profile.id=`imported-${Date.now()}-${imported.length}`;
      const errors=profileErrors(profile);
      if(errors.length)throw new Error(`Invalid profile: ${errors.join(' ')}`);
      imported.push({...profile,name:profile.model,x:profile.buildVolume.x,y:profile.buildVolume.y,
        z:profile.buildVolume.z,nozzle:profile.nozzleDiameters[0],status:profileWarnings(profile).join(' ')});
    }
    if(!imported.length)throw new Error('The profile file contains no printer profiles.');
    printerProfiles.push(...imported);
    if(!persistPrinterProfiles()){
      printerProfiles.splice(-imported.length,imported.length);
      throw new Error('Imported profiles are in memory but could not be saved to this browser.');
    }
    printerProfile=imported[0];
    $('#printer-search').value='';
    renderPrinterOptions();
    applyPrinterProfile();
    invalidateSlice();
    showStatus(`Imported ${imported.length} printer profile${imported.length===1?'':'s'}`);
  }catch(error){showStatus(error.message,true);}
});

$('#export-profile').addEventListener('click',()=>{
  const data={
    schemaVersion:1,
    manufacturer:printerProfile.manufacturer,
    series:printerProfile.series,
    model:printerProfile.model,
    buildVolume:{x:printerProfile.x,y:printerProfile.y,z:printerProfile.z},
    ...Object.fromEntries(Object.entries(printerProfile).filter(([key])=>!['x','y','z','name','nozzle','status'].includes(key)))
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=`${printerProfile.name.replace(/[^a-z0-9-]+/gi,'-').toLowerCase()}.printer.json`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
renderPrinterOptions();
applyPrinterProfile();
$('#output-format').addEventListener('change',()=>{
  const format=OUTPUT_FORMATS[$('#output-format').value];
  $('#export-button').textContent=format?`Export ${format.label}`:'Export unavailable';
  $('#export-button').disabled=!gcodeResult||!format?.exporter;
});
$('#filament-profile').addEventListener('change',(event)=>{
  const temperatures={pla:['205','60'],petg:['235','80'],abs:['245','100']}[event.target.value];
  $('#nozzle-temp').value=temperatures[0];$('#bed-temp').value=temperatures[1];
  invalidateSlice();
});
