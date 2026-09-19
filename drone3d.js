import * as THREE from './vendor/three.module.js';

// A functional, articulated engineering model. Dimensions are visual proportions,
// not measurements of the user's airframe. Each arm deforms independently.
const V = (x,y,z) => new THREE.Vector3(x,y,z);
const materials = {
  frame: new THREE.MeshStandardMaterial({color:0x252c32,roughness:.78,metalness:.3}),
  edge: new THREE.MeshStandardMaterial({color:0x424d56,roughness:.65,metalness:.45}),
  orange: new THREE.MeshStandardMaterial({color:0xff681f,roughness:.5,metalness:.08,side:THREE.DoubleSide}),
  silver: new THREE.MeshStandardMaterial({color:0xa5afb6,roughness:.35,metalness:.8}),
  copper: new THREE.MeshStandardMaterial({color:0xbf642c,roughness:.4,metalness:.72}),
  blue: new THREE.MeshStandardMaterial({color:0x2584c7,roughness:.52}),
  red: new THREE.MeshStandardMaterial({color:0xb63236,roughness:.7}),
  white: new THREE.MeshStandardMaterial({color:0xe8e7dc,roughness:.65}),
  green: new THREE.MeshStandardMaterial({color:0x42c079,roughness:.8}),
  cyan: new THREE.MeshStandardMaterial({color:0x70e3e9,emissive:0x1c7b85,emissiveIntensity:.5}),
  fault: new THREE.MeshStandardMaterial({color:0xff5061,emissive:0xc6273d,emissiveIntensity:.45})
};
function mesh(geometry,material,parent,position=[0,0,0]) {
  const item=new THREE.Mesh(geometry,material);item.position.set(...position);
  item.castShadow=true;item.receiveShadow=true;parent.add(item);return item;
}
function box(parent,size,position,material=materials.frame){return mesh(new THREE.BoxGeometry(...size),material,parent,position);}
function cylinder(parent,radius,height,position,material=materials.frame,segments=24){return mesh(new THREE.CylinderGeometry(radius,radius,height,segments),material,parent,position);}
function rod(parent,a,b,radius=.03,material=materials.frame){
  const start=V(...a),end=V(...b),delta=end.clone().sub(start);
  const obj=cylinder(parent,radius,delta.length(),start.clone().add(end).multiplyScalar(.5).toArray(),material,10);
  obj.quaternion.setFromUnitVectors(V(0,1,0),delta.normalize());return obj;
}
function plate(parent,y,radius=1.02){
  const points=[];for(let i=0;i<8;i++){const a=i*Math.PI/4+Math.PI/8;points.push(new THREE.Vector2(Math.cos(a)*radius,Math.sin(a)*radius));}
  const shape=new THREE.Shape(points);const geo=new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:false});geo.rotateX(-Math.PI/2);
  return mesh(geo,materials.frame,parent,[0,y,0]);
}
function topLabel(parent,text,width,depth,position,color='#2365a0',font=40){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#edf4f2';ctx.fillRect(0,0,512,256);ctx.strokeStyle=color;ctx.lineWidth=13;ctx.strokeRect(12,12,488,232);
  ctx.fillStyle=color;ctx.font=`bold ${font}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';
  text.split('\n').forEach((line,i,all)=>ctx.fillText(line,256,128+(i-(all.length-1)/2)*55));
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const plane=mesh(new THREE.PlaneGeometry(width,depth),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}),parent,position);plane.rotation.x=-Math.PI/2;return plane;
}
function bladeGeometry(cut=false){
  const shape=new THREE.Shape();shape.moveTo(.07,-.055);shape.lineTo(.20,-.105);shape.lineTo(.58,-.125);
  if(cut){shape.lineTo(.62,-.085);shape.lineTo(.56,-.045);shape.lineTo(.63,.005);shape.lineTo(.57,.055);shape.lineTo(.61,.10);}
  else{shape.bezierCurveTo(.85,-.12,1.00,-.06,1.02,.01);shape.bezierCurveTo(.97,.115,.7,.15,.40,.11);}
  shape.lineTo(.18,.06);shape.lineTo(.07,.055);shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:.025,bevelEnabled:true,bevelThickness:.008,bevelSize:.008,bevelSegments:1,steps:1});geometry.rotateX(-Math.PI/2);return geometry;
}
const healthyBlade=bladeGeometry(),cutBlade=bladeGeometry(true);

export function createDroneScene(canvas,labelRoot,onSelect){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.45;
  const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x09141d,20,55);
  scene.add(new THREE.HemisphereLight(0xdcefff,0x24313d,2.4));
  const sun=new THREE.DirectionalLight(0xfff6e5,3.5);sun.position.set(-3,9,6);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-8;sun.shadow.camera.right=8;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-8;sun.shadow.bias=-.0003;scene.add(sun);
  const rim=new THREE.DirectionalLight(0x66bbdf,2.3);rim.position.set(5,3,-4);scene.add(rim);
  const floor=mesh(new THREE.PlaneGeometry(150,150),new THREE.MeshStandardMaterial({color:0x101f2a,roughness:1}),scene);floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.castShadow=false;
  const grid=new THREE.GridHelper(100,100,0x38545d,0x233943);grid.position.y=.012;scene.add(grid);
  const landingRing=mesh(new THREE.RingGeometry(1.1,1.13,64),new THREE.MeshBasicMaterial({color:0x65ccd8,transparent:true,opacity:.42,side:THREE.DoubleSide}),scene,[0,.02,0]);landingRing.rotation.x=-Math.PI/2;
  const centerMarker=mesh(new THREE.RingGeometry(.29,.31,48),new THREE.MeshBasicMaterial({color:0x65ccd8,transparent:true,opacity:.32,side:THREE.DoubleSide}),scene,[0,.021,0]);centerMarker.rotation.x=-Math.PI/2;
  const drone=new THREE.Group();scene.add(drone);drone.position.y=2.2;
  plate(drone,.04);plate(drone,-.48,.86);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;rod(drone,[.72*Math.cos(a),-.47,.72*Math.sin(a)],[.72*Math.cos(a),.06,.72*Math.sin(a)],.035,materials.silver);cylinder(drone,.035,.035,[.82*Math.cos(a),.125,.82*Math.sin(a)],materials.silver,8);}
  box(drone,[.63,.26,.86],[.13,-.29,.08],materials.blue);box(drone,[.67,.045,.2],[.13,-.135,.08]);
  box(drone,[.62,.13,.42],[.15,.19,.14],materials.blue);topLabel(drone,'WIT\nWT901C-485',.55,.35,[.15,.261,.14]);
  for(let i=0;i<4;i++)rod(drone,[.42,.16,.05+i*.06],[.85,-.2,.18+i*.06],.015,i%2?materials.red:materials.frame);
  // White GPS disc on a tall mast and two landing skids, as in the user's photos.
  rod(drone,[-.42,.12,-.2],[-.42,1.05,-.2],.035);cylinder(drone,.15,.13,[-.42,.19,-.2],materials.red);
  cylinder(drone,.35,.10,[-.42,1.09,-.2],materials.white);topLabel(drone,'NAZA\nGPS',.35,.23,[-.42,1.145,-.2],'#cf903a',43);
  for(const side of [-1,1]){
    rod(drone,[side*.53,-.38,-.49],[side*1.13,-1.10,-.66],.055);
    rod(drone,[side*.53,-.38,.49],[side*1.13,-1.10,.66],.055);
    rod(drone,[side*1.13,-1.10,-1.23],[side*1.13,-1.10,1.23],.063);
    for(const z of [-1.18,1.18])cylinder(drone,.077,.13,[side*1.13,-1.10,z],materials.frame,12).rotation.x=Math.PI/2;
  }
  const arms=[];
  for(let index=0;index<8;index++){
    const group=new THREE.Group();group.rotation.y=Math.PI/8+index*Math.PI/4;drone.add(group);
    const segments=[];
    for(let j=0;j<9;j++){
      const x=.84+j*.285,s=j/8;
      for(const z of [-.13,.13]){
        for(const y of [-.12,.07]){
          const rail=box(group,[.299,.045,.045],[x,y,z]);segments.push({obj:rail,s,base:y,crack:j===6});
        }
        const diag=box(group,[.29,.027,.025],[x,-.025,z],materials.edge);diag.rotation.z=(j%2?1:-1)*.51;segments.push({obj:diag,s,base:-.025,angle:diag.rotation.z,crack:j===6});
      }
      if(j%2===0){const cross=box(group,[.055,.23,.31],[x,-.025,0]);segments.push({obj:cross,s,base:-.025,crack:false});}
    }
    const end=new THREE.Group();end.position.set(3.38,0,0);group.add(end);
    box(end,[.46,.075,.43],[0,-.10,0]);cylinder(end,.238,.19,[0,.035,0],materials.frame);
    cylinder(end,.19,.075,[0,.135,0],materials.copper);cylinder(end,.24,.08,[0,.19,0],materials.silver);
    for(let k=0;k<8;k++){const a=k*Math.PI/4;box(end,[.045,.13,.055],[Math.cos(a)*.19,.18,Math.sin(a)*.19]);}
    const rotor=new THREE.Group();rotor.position.y=.285;end.add(rotor);
    const blades=[mesh(healthyBlade,materials.orange,rotor),mesh(healthyBlade,materials.orange,rotor)];blades[1].rotation.y=Math.PI;
    cylinder(rotor,.09,.08,[0,.035,0],materials.silver);mesh(new THREE.ConeGeometry(.07,.17,18),materials.frame,rotor,[0,.13,0]);
    const mass=box(rotor,[.38,.025,.12],[.63,.04,0],materials.green);mass.visible=false;
    const blur=mesh(new THREE.CircleGeometry(1.03,48),new THREE.MeshBasicMaterial({color:0xff7938,transparent:true,opacity:.10,side:THREE.DoubleSide,depthWrite:false}),end,[0,.31,0]);blur.rotation.x=-Math.PI/2;
    const marker=box(end,[.12,.055,.14],[-.34,-.03,.19],materials.red);box(end,[.055,.02,.055],[-.34,.005,.19],materials.frame);
    const accelerometer=box(group,[.20,.03,.18],[2.2,.105,0],materials.red);box(group,[.07,.03,.07],[2.2,.14,0],materials.silver);
    topLabel(group,`M${index+1}`,.25,.15,[1.20,.105,0],'#20292c',95);
    // Wiring and ESC packages sit inside the open truss, rather than solid tubes.
    box(group,[.50,.065,.15],[1.6,-.055,0],materials.silver);
    rod(group,[1.1,-.08,-.07],[3.23,-.08,-.07],.014,materials.red);
    rod(group,[1.1,-.085,.065],[3.23,-.085,.065],.013,materials.silver);
    const crack=box(group,[.045,.26,.35],[2.62,-.02,0],materials.fault);crack.visible=false;
    const selectRing=mesh(new THREE.RingGeometry(.27,.30,40),new THREE.MeshBasicMaterial({color:0x77e7ef,transparent:true,opacity:.85,side:THREE.DoubleSide}),end,[0,.32,0]);selectRing.rotation.x=-Math.PI/2;
    const button=document.createElement('button');button.textContent=index+1;button.setAttribute('aria-label',`Select arm ${index+1} on model`);button.addEventListener('click',()=>onSelect(index));labelRoot.append(button);
    arms.push({group,segments,end,rotor,blades,mass,blur,crack,selectRing,button,accelerometer,marker,angle:group.rotation.y});
  }
  const labels=[['WT901C-485 · IMU','imu',drone,V(.15,.48,.14)],['ADXL335-CY','vib',null,V(2.20,.45,0)],['Maker Reflect S · RPM','rpm',null,V(3.30,-.25,.12)]];
  labels.forEach(label=>{const el=document.createElement('span');el.className=`part-label ${label[1]}`;el.textContent=label[0];labelRoot.append(el);label.push(el);});
  const camera=new THREE.PerspectiveCamera(43,1,.1,160);let azimuth=.78,elevation=.54,distance=13.8;
  let view='perspective',dragging=false,lastX=0,lastY=0;
  canvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;azimuth-=(e.clientX-lastX)*.008;elevation=THREE.MathUtils.clamp(elevation+(e.clientY-lastY)*.006,.07,1.50);lastX=e.clientX;lastY=e.clientY;view='custom';});
  canvas.addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointercancel',()=>dragging=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance+e.deltaY*.008,8,23);},{passive:false});
  function resize(){const rect=canvas.parentElement.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas.parentElement);resize();
  const projected=new THREE.Vector3();
  function place(el,parent,point,offsetY=0){parent.localToWorld(projected.copy(point));projected.project(camera);el.style.left=`${(projected.x*.5+.5)*100}%`;el.style.top=`calc(${(-projected.y*.5+.5)*100}% + ${offsetY}px)`;el.style.visibility=projected.z>1?'hidden':'visible';}
  function update(state,dt){
    const {t,pose,mode,selected,damage,slow,flex,rpms}=state;
    drone.position.set(pose.x,1.17+pose.alt,pose.z);drone.rotation.set(pose.pitch,pose.yaw,pose.roll,'YXZ');
    arms.forEach((arm,i)=>{
      const faulty=i===selected&&mode!=='normal';const rpm=rpms[i];const speedScale=(rpm/3700)**2;
      const amplitude=(faulty?(mode==='arm'?.082:.039):.003)*flex*speedScale;
      const phase=t*(mode==='arm'?16:33)+i*.8;
      const vibration=amplitude*(Math.sin(phase)+(mode==='arm'?.32*Math.sin(phase*1.71):.14*Math.sin(phase*2)));
      arm.segments.forEach(piece=>{const shape=piece.s*piece.s*(3-piece.s)/2;piece.obj.position.y=piece.base+vibration*shape;piece.obj.rotation.z=(piece.angle||0)+vibration*(3*piece.s-1.5*piece.s*piece.s)/2.56;piece.obj.visible=!(faulty&&mode==='arm'&&piece.crack);});
      arm.end.position.y=vibration;arm.end.rotation.z=vibration*.58;
      arm.accelerometer.position.y=.105+vibration*.42;
      arm.crack.visible=faulty&&mode==='arm';arm.crack.position.y=-.02+vibration*.59;arm.crack.scale.y=.55+.12*Math.sin(phase);
      arm.blades[0].geometry=faulty&&mode==='propeller'&&damage==='cut'?cutBlade:healthyBlade;
      arm.mass.visible=faulty&&mode==='propeller'&&damage==='mass';
      // Visible rotor phase is intentionally slowed; actual RPM is kept in telemetry.
      arm.rotor.rotation.y+=dt*(rpm/60)*Math.PI*2*(i%2?-1:1)*(slow?.025:1);
      arm.blur.visible=!slow&&rpm>800;arm.blur.material.opacity=.035+.09*Math.min(1,rpm/3700);
      arm.selectRing.visible=i===selected;arm.selectRing.material.color.set(faulty?0xff5870:0x77e7ef);
      arm.button.classList.toggle('selected',i===selected);
    });
    const target=V(0,1.7,0);const fit=Math.max(1,1.12/camera.aspect);
    camera.position.set(Math.sin(azimuth)*Math.cos(elevation)*distance*fit,target.y+Math.sin(elevation)*distance*fit,Math.cos(azimuth)*Math.cos(elevation)*distance*fit);camera.lookAt(target);camera.updateMatrixWorld();drone.updateMatrixWorld(true);
    arms.forEach(a=>place(a.button,a.end,V(0,.6,0)));
    labels[1][2]=arms[selected].group;labels[2][2]=arms[selected].group;
    labels.forEach(label=>{label[4].hidden=!state.labels;place(label[4],label[2],label[3],label[1]==='rpm'?23:label[1]==='vib'?-12:0);});
    renderer.render(scene,camera);
  }
  return {update,setView(next){view=next;if(next==='top'){elevation=1.50;azimuth=0;distance=13.8;}else if(next==='side'){elevation=.12;azimuth=.1;distance=13.8;}else{elevation=.54;azimuth=.78;distance=13.8;}},dispose(){resizeObserver.disconnect();renderer.dispose();}};
}
