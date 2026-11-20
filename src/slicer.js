import * as THREE from './vendor/three/three.module.js';

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

const printerProfiles = [
  { id:'generic-220', manufacturer:'Custom', name:'Open FDM 220 × 220', x:220, y:220, z:250, nozzle:0.4, status:'Untested template' },
  { id:'generic-250', manufacturer:'Custom', name:'Open FDM 250 × 210', x:250, y:210, z:220, nozzle:0.4, status:'Untested template' }
];
try {
  const saved=localStorage.getItem('prism-printer-profiles');
  if(saved){
    const records=JSON.parse(saved);
    if(!Array.isArray(records))throw new Error('Saved profile data is not a list.');
    for(const entry of records){
      if(!validPrinterProfile(entry))throw new Error('A saved printer profile has invalid dimensions.');
      printerProfiles.push({
        id:`custom-saved-${printerProfiles.length}`,
        manufacturer:entry.manufacturer.trim(),
        name:entry.name.trim(),
        x:Number(entry.buildVolume.x),y:Number(entry.buildVolume.y),z:Number(entry.buildVolume.z),
        nozzle:Number(entry.nozzleDiameter),status:'Saved custom profile — not printer-tested'
      });
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
const worker = new Worker('./slicer-worker.js');

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
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerAction = { x:event.clientX, y:event.clientY, yaw, pitch, target:cameraTarget.clone(), type:event.button === 2 || event.shiftKey ? 'pan' : 'orbit' };
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('contextmenu',(event)=>event.preventDefault());
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointerAction) return;
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
renderer.domElement.addEventListener('pointerup', () => { pointerAction = null; });
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

function parseObj(text) {
  const vertices = [];
  const faces = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') vertices.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    if (parts[0] === 'f') {
      const indexes = parts.slice(1).map((part) => Number(part.split('/')[0]) - 1);
      for (let i = 1; i < indexes.length - 1; i++) {
        faces.push(vertices[indexes[0]], vertices[indexes[i]], vertices[indexes[i + 1]]);
      }
    }
  }
  if (!faces.length) throw new Error('No polygon faces found in OBJ.');
  return faces.flat();
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
  $('#scale-value').value=(item.mesh.scale.x*100).toFixed(1);
  setObjectList();
}

async function importFiles(fileList) {
  let imported=0;
  for (const file of Array.from(fileList)) {
    try {
      if(file.size>128*1024*1024)throw new Error(`${file.name}: file exceeds 128 MB.`);
      const buffer = await file.arrayBuffer();
      let positions;
      if (/\.obj$/i.test(file.name)) positions = parseObj(new TextDecoder().decode(buffer));
      else if (/\.stl$/i.test(file.name)) {
        positions = parseBinaryStl(buffer);
        if (!positions) positions = parseAsciiStl(new TextDecoder().decode(buffer));
      } else throw new Error('Use STL or OBJ files.');
      if (positions.length < 9) throw new Error('Mesh contains too few vertices.');
      if(positions.length/3>300_000)throw new Error(`${file.name}: exceeds the 300,000 triangle browser limit.`);
      const geometry = geometryFromPositions(positions);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -box.min.z);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
        color: 0x78a8c5, emissive: 0x000000, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide
      }));
      mesh.geometry.computeBoundingBox();
      mesh.position.set(objects.length ? 0 : 0, objects.length ? 0 : 0, 0);
      scene.add(mesh);
      const item = { name:file.name, mesh, positions };
      objects.push(item);
      imported++;
      selectObject(item);
      placeOnPlate(item);
    } catch (error) {
      showStatus(error.message, true);
    }
  }
  setObjectList();
  if(imported)invalidateSlice();
}

function placeOnPlate(item) {
  item.mesh.geometry.computeBoundingBox();
  item.mesh.position.z = -item.mesh.geometry.boundingBox.min.z;
  $('#pos-z').value = item.mesh.position.z.toFixed(1);
  if (objects.length === 1) return;
  const index = objects.indexOf(item);
  item.mesh.position.x = ((index % 3) - 1) * 55;
  item.mesh.position.y = (Math.floor(index / 3) - 1) * 55;
  syncTransformInputs();
}

function syncTransformInputs() {
  if (!selectedObject) return;
  $('#pos-x').value = selectedObject.mesh.position.x.toFixed(1);
  $('#pos-y').value = selectedObject.mesh.position.y.toFixed(1);
  $('#pos-z').value = selectedObject.mesh.position.z.toFixed(1);
}

$('#model-file').addEventListener('change', (event) => importFiles(event.target.files));
for (const eventName of ['dragenter','dragover']) viewport.addEventListener(eventName,(event)=>{event.preventDefault();viewport.classList.add('dragging');});
for (const eventName of ['dragleave','drop']) viewport.addEventListener(eventName,(event)=>{
  event.preventDefault();viewport.classList.remove('dragging');
  if(eventName==='drop') importFiles(event.dataTransfer.files);
});

function addSettingEvents() {
  ['pos-x','pos-y','pos-z'].forEach((id, axis) => $(`#${id}`).addEventListener('change', () => {
    if (!selectedObject) return;
    selectedObject.mesh.position[['x','y','z'][axis]] = Number($(`#${id}`).value);
    invalidateSlice();
  }));
  $('#scale-value').addEventListener('change', () => {
    if (!selectedObject) return;
    const scale = Number($('#scale-value').value) / 100;
    selectedObject.mesh.scale.set(scale, scale, scale);
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
    const item = {name:`${selectedObject.name} copy`, mesh, positions:selectedObject.positions};
    objects.push(item);
    selectObject(item);
    invalidateSlice();
  });
  $('#arrange-object').addEventListener('click', () => {
    objects.forEach((item,index)=>{item.mesh.position.x=((index%4)-1.5)*45;item.mesh.position.y=(Math.floor(index/4)-1)*45;});
    syncTransformInputs();
    invalidateSlice();
  });
}
addSettingEvents();

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

for(const button of $$('[data-menu]')){
  button.addEventListener('click',()=>{
    switch(button.dataset.menu){
      case 'file': $('#project-file').click(); break;
      case 'edit': $('#duplicate-object').click(); break;
      case 'view': $('[data-view="perspective"]').click(); break;
      case 'printer': $('[data-tab="printer"]').click(); break;
      case 'settings': $('[data-tab="print"]').click(); break;
      case 'help': showStatus('STL/OBJ import and generic G-code export. Printer profiles are not validated.'); break;
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

$('#slice-button').addEventListener('click', () => {
  if (!objects.length) return showStatus('Import a model before slicing.', true);
  sliceRequestId++;
  const requestId=sliceRequestId;
  gcodeResult = null;
  $('#export-button').disabled = true;
  $('.bottom-panel .slice-status').classList.add('slicing');
  $('#status-text').textContent = 'Slicing in worker...';
  const settings = {
    layerHeight:Number($('#layer-height').value), lineWidth:Number($('#line-width').value),
    wallCount:Number($('#wall-count').value), infillDensity:Number($('#infill-density').value),
    infillPattern:$('#infill-pattern').value,
    adhesion:$('#adhesion').value, nozzleTemperature:Number($('#nozzle-temp').value),
    bedTemperature:Number($('#bed-temp').value), printSpeed:Number($('#print-speed').value),
    flowRate:Number($('#flow-rate').value), filamentDiameter:1.75,
    buildVolume:{x:printerProfile.x,y:printerProfile.y,z:printerProfile.z}
  };
  scene.updateMatrixWorld(true);
  try{
    worker.postMessage({type:'slice', requestId, triangles:collectMeshTriangles(), settings});
  }catch(error){
    showStatus(`Unable to send model to slicer: ${error.message}`,true);
  }
});

worker.addEventListener('message',(event)=>{
  const data=event.data;
  if(data.requestId!==sliceRequestId)return;
  if(data.type==='progress'){
    $('#status-text').textContent=`Slicing layer ${data.layer} of ${data.total}`;
    return;
  }
  if(data.type==='error'){showStatus(data.message,true);return;}
  gcodeResult=data;
  $('.bottom-panel .slice-status').classList.remove('slicing');
  $('#status-text').textContent='Slice complete';
  $('#print-time').textContent=data.estimatedMinutes ? `${Math.floor(data.estimatedMinutes/60)}h ${Math.round(data.estimatedMinutes%60)}m`:'--';
  $('#filament-use').textContent=`${data.filamentMm.toFixed(1)} mm · ${data.filamentGrams.toFixed(1)} g`;
  $('#layer-count').textContent=data.layers.length;
  $('#export-button').disabled=false;
  $('#layer-slider').max=Math.max(0,data.layers.length-1);
  $('#layer-slider').value=String(data.layers.length-1);
  renderToolpaths(data.layers.length-1);
});
worker.addEventListener('error',(event)=>showStatus(`Slicer worker failed: ${event.message}`,true));

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
  const blob=new Blob([gcodeResult.gcode],{type:'text/x-gcode'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='prism-slice.gcode';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  showStatus('G-code exported');
});

$('#save-project').addEventListener('click',()=>{
  const project={version:1,printer:$('#printer-profile').value,filament:$('#filament-profile').value,objects:objects.map((item)=>({
    name:item.name,position:item.mesh.position.toArray(),scale:item.mesh.scale.toArray(),positions:item.positions
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
    if(project.version!==1||!Array.isArray(project.objects))throw new Error('Unsupported or invalid Prism project.');
    const restored=project.objects.map((entry)=>{
      if(!Array.isArray(entry.positions)||entry.positions.length<3||
         entry.positions.some((point)=>!Array.isArray(point)||point.length!==3||point.some((value)=>!Number.isFinite(value)))||
         !Array.isArray(entry.position)||entry.position.length!==3||entry.position.some((value)=>!Number.isFinite(value))||
         !Array.isArray(entry.scale)||entry.scale.length!==3||entry.scale.some((value)=>!Number.isFinite(value)||value<=0)){
        throw new Error('Project contains invalid model geometry or transforms.');
      }
      const mesh=new THREE.Mesh(
        geometryFromPositions(entry.positions),
        new THREE.MeshStandardMaterial({color:0x78a8c5,roughness:0.55,metalness:0.05,side:THREE.DoubleSide})
      );
      mesh.position.fromArray(entry.position);
      mesh.scale.fromArray(entry.scale);
      return {name:String(entry.name||'Imported model'),mesh,positions:entry.positions};
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

function renderPrinterOptions(query='') {
  const search=query.trim().toLowerCase();
  const filtered=printerProfiles.filter((profile)=>`${profile.manufacturer} ${profile.name}`.toLowerCase().includes(search));
  const select=$('#printer-profile');
  select.replaceChildren();
  filtered.forEach((profile)=>{
    const option=document.createElement('option');
    option.value=profile.id;
    option.textContent=`${profile.manufacturer} · ${profile.name}`;
    select.append(option);
  });
  if (filtered.some((profile)=>profile.id===printerProfile.id)) {
    select.value=printerProfile.id;
  }
}

function applyPrinterProfile() {
  $('#printer-name').textContent=`${printerProfile.manufacturer} ${printerProfile.name}`;
  $('#printer-volume').textContent=`${printerProfile.x} × ${printerProfile.y} × ${printerProfile.z} mm`;
  $('#printer-warning').textContent=printerProfile.status;
  $('#volume-x').value=printerProfile.x;
  $('#volume-y').value=printerProfile.y;
  $('#volume-z').value=printerProfile.z;
  $('#nozzle-diameter').value=printerProfile.nozzle;
  makeBuildPlate();
  fitPrinterView();
}

function validPrinterProfile(profile) {
  return profile && typeof profile.manufacturer==='string' && profile.manufacturer.trim() &&
    typeof profile.name==='string' && profile.name.trim() &&
    ['x','y','z'].every((key)=>Number.isFinite(Number(profile.buildVolume?.[key])) &&
      Number(profile.buildVolume[key])>=10 && Number(profile.buildVolume[key])<=3000) &&
    Number.isFinite(Number(profile.nozzleDiameter)) && Number(profile.nozzleDiameter)>=0.1 &&
    Number(profile.nozzleDiameter)<=5;
}

function persistPrinterProfiles() {
  const custom=printerProfiles.filter((profile)=>profile.id.startsWith('custom-')||profile.id.startsWith('imported-'));
  try {
    localStorage.setItem('prism-printer-profiles',JSON.stringify(custom.map((profile)=>({
    manufacturer:profile.manufacturer,
    name:profile.name,
    buildVolume:{x:profile.x,y:profile.y,z:profile.z},
    nozzleDiameter:profile.nozzle
    }))));
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
  const nozzle=Number($('#nozzle-diameter').value);
  const profile={id:`custom-${Date.now()}`,manufacturer,name,x,y,z,nozzle,status:'Custom profile — not printer-tested'};
  if(!validPrinterProfile({...profile,buildVolume:{x,y,z},nozzleDiameter:nozzle})){
    showStatus('Enter a profile name, valid build volume, and nozzle diameter.',true);
    return;
  }
  printerProfiles.push(profile);
  if(!persistPrinterProfiles()){
    printerProfiles.pop();
    return;
  }
  printerProfile=profile;
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
    const candidates=Array.isArray(data)?data:[data];
    const imported=[];
    for(const entry of candidates){
      if(!validPrinterProfile(entry)){
        throw new Error('Invalid profile. Expected manufacturer, name, buildVolume x/y/z, and nozzleDiameter.');
      }
      imported.push({
        id:`imported-${Date.now()}-${imported.length}`,
        manufacturer:entry.manufacturer.trim(),
        name:entry.name.trim(),
        x:Number(entry.buildVolume.x),y:Number(entry.buildVolume.y),z:Number(entry.buildVolume.z),
        nozzle:Number(entry.nozzleDiameter),
        status:'Imported profile — not printer-tested'
      });
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
    name:printerProfile.name,
    buildVolume:{x:printerProfile.x,y:printerProfile.y,z:printerProfile.z},
    nozzleDiameter:printerProfile.nozzle
  };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download=`${printerProfile.name.replace(/[^a-z0-9-]+/gi,'-').toLowerCase()}.printer.json`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
renderPrinterOptions();
applyPrinterProfile();
$('#filament-profile').addEventListener('change',(event)=>{
  const temperatures={pla:['205','60'],petg:['235','80'],abs:['245','100']}[event.target.value];
  $('#nozzle-temp').value=temperatures[0];$('#bed-temp').value=temperatures[1];
  invalidateSlice();
});
