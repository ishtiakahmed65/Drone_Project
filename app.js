import {createDroneScene} from './drone3d.js';
import {PHASES,clamp,flightPose,rotorTargets,flexEnvelope,vibrationAmplitude,signalAt} from './simulation.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const state={t:0,flightTime:8,mode:'normal',selected:0,damage:'cut',slow:true,flex:3,labels:true,paused:reducedMotion,flightMode:'auto',rpms:Array(8).fill(3700),pose:flightPose(8)};
const copy={normal:['Balanced rotation','The selected arm carries a small periodic response. RPM changes with the flight maneuver.','BASELINE'],propeller:['Propeller imbalance','The selected rotor has a visible blade fault. Its local vibration rises even when speed is maintained.','PROP FAULT'],arm:['Reduced arm stiffness','A visible break near the selected motor allows greater local flex, increasing toward the arm tip.','ARM FAULT']};
let model;
try{model=createDroneScene($('#flightCanvas'),$('#modelLabels'),selectArm);}catch(error){$('#graphicsError').hidden=false;console.error('3D initialization:',error);}

function selectArm(index){state.selected=index;syncControls();}
function syncControls(){
  $$('[data-mode]').forEach(el=>{const active=el.dataset.mode===state.mode;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
  $$('#armPicker button').forEach((el,i)=>{el.classList.toggle('active',i===state.selected);el.setAttribute('aria-pressed',String(i===state.selected));});
  $$('#rpmGrid button').forEach((el,i)=>el.classList.toggle('active',i===state.selected));
  $('#conditionTitle').textContent=copy[state.mode][0];$('#conditionDescription').textContent=copy[state.mode][1];$('#status').textContent=copy[state.mode][2];
  $('#damageControl').hidden=state.mode!=='propeller';$('#play').textContent=state.paused?'Play':'Pause';$('#play').setAttribute('aria-pressed',String(state.paused));
  $('#armLabel').textContent=`A${state.selected+1}`;
  $('#inspectionLabel').textContent=state.mode==='normal'?`Rotor ${state.selected+1} · intact`:state.mode==='arm'?`Arm ${state.selected+1} · cracked rail`:state.damage==='mass'?`Rotor ${state.selected+1} · added mass`:`Rotor ${state.selected+1} · blade cut`;
  drawDetail();updateReadouts();model?.update(state,0);
}
for(let i=0;i<8;i++){
  const button=document.createElement('button');button.textContent=`A${i+1}`;button.setAttribute('aria-label',`Select arm ${i+1}`);button.addEventListener('click',()=>selectArm(i));$('#armPicker').append(button);
  const rpm=document.createElement('button');rpm.className='rpm-cell';rpm.innerHTML=`A${i+1}<b>3,700</b>`;rpm.setAttribute('aria-label',`Select rotor ${i+1} RPM`);rpm.addEventListener('click',()=>selectArm(i));$('#rpmGrid').append(rpm);
}
for(let i=0;i<12;i++){const bar=document.createElement('span');bar.style.height=`${2+flexEnvelope(i/11)*40}px`;$('#profileBars').append(bar);}
$$('[data-mode]').forEach(el=>el.addEventListener('click',()=>{state.mode=el.dataset.mode;syncControls();}));
$$('[data-view]').forEach(el=>el.addEventListener('click',()=>{$$('[data-view]').forEach(b=>{b.classList.toggle('active',b===el);b.setAttribute('aria-pressed',String(b===el));});model?.setView(el.dataset.view);model?.update(state,0);}));
$('#damageType').addEventListener('change',e=>{state.damage=e.target.value;syncControls();});
$('#play').addEventListener('click',()=>{state.paused=!state.paused;syncControls();});
$('#replay').addEventListener('click',()=>{state.flightTime=0;state.flightMode='auto';state.paused=false;state.rpms.fill(0);state.pose=flightPose(0);$('#flightMode').value='auto';syncControls();});
$('#flightMode').addEventListener('change',e=>{
  state.flightMode=e.target.value;
  if(state.flightMode!=='auto'){const phase=PHASES.find(p=>p[0]===state.flightMode);state.flightTime=phase[1];if(state.flightMode==='hover')state.flightTime=8;state.pose=flightPose(state.flightTime);}
  syncControls();
});
$('#labelsToggle').addEventListener('change',e=>{state.labels=e.target.checked;model?.update(state,0);});
$('#slowRotors').addEventListener('change',e=>{state.slow=e.target.checked;model?.update(state,0);});
$('#flexScale').addEventListener('input',e=>{state.flex=+e.target.value;$('#flexValue').textContent=`${state.flex}×`;model?.update(state,0);});

const hardware=[
  ['ADXL335-CY','8 sensors','adxl335-product.png','Analog X/Y/Z acceleration at the arms. The linked breakout specifies ±3g and 50 Hz per-axis bandwidth.','https://my.cytron.io/p-3-axis-accelerometer','Cytron'],
  ['Maker Reflect S','8 sensors','reflect-product.png','IR reflectance produces an analog signal. A reflective marker and pulse detection turn it into an RPM reference.','https://my.cytron.io/p-maker-reflect-s-simplifying-ir-reflectance-sensor-for-beginner','Cytron'],
  ['WT901C-485','1 frame IMU','imu-product.jpg','Blue center-mounted IMU: acceleration, angular velocity, attitude and magnetic field over RS485 Modbus.','https://witmotion-sensor.com/products/mpu9250-high-precision-accelerometer-magnetometer-wt901c-for-pc-arduino-raspberry-pi','WitMotion'],
  ['CD74HC4067','2 multiplexers','mux-product.jpg','Selects analog channels from the 24 accelerometer axes. The ESP32 performs ADC conversion sequentially.','https://www.alibaba.com/product-detail/CD74HC4067-CMOS-16-Channel-Way-Analog_1601450357719.html','Supplier listing'],
  ['MAX485 interface','1 transceiver','max485.webp','Connects the UART side to the RS485 bus. The MAX485 is a 5V device; ESP32 logic compatibility depends on the interface circuit.','https://shopee.com.my/TTL-RS485-Module-Bi-Directional-MAX485-i.155961970.28816592333','Your supplied photo'],
  ['MicroSD adapter','1 logger','sd-product.jpg','SPI storage interface for numbered recording sessions, with write activity indicated by the project LED.','https://my.cytron.io/p-5v-compatible-micro-sd-card-adapter','Cytron'],
  ['ESP32-S3 N16R8','1 controller','esp32.webp','Acquires and timestamps the sensor data. N16R8 configuration: 16 MB flash and 8 MB PSRAM.','https://shopee.com.my/product/1225090988/45652769167','Your supplied photo']
];
hardware.forEach(([name,quantity,image,description,url,credit])=>{
  const card=document.createElement('article');card.className='hardware-card';
  const imageWrap=document.createElement('div');imageWrap.className='hardware-image';const img=document.createElement('img');img.src=`assets/hardware/${image}`;img.alt=name;img.loading='lazy';const badge=document.createElement('span');badge.textContent=quantity;imageWrap.append(img,badge);
  const content=document.createElement('div');content.className='hardware-content';const title=document.createElement('h3');title.textContent=name;const p=document.createElement('p');p.textContent=description;const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Product reference ↗';const source=document.createElement('span');source.className='image-credit';source.textContent=`Image: ${credit}`;content.append(title,p,link,source);card.append(imageWrap,content);$('#hardwareGrid').append(card);
});

function drawDetail(){
  const canvas=$('#detailCanvas'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.save();ctx.translate(280,86);
  if(state.mode==='arm'){
    ctx.strokeStyle='#637583';ctx.lineWidth=13;ctx.lineCap='square';
    for(const y of [-30,30]){ctx.beginPath();ctx.moveTo(-215,y);ctx.lineTo(75,y);ctx.moveTo(95,y+(y>0?8:0));ctx.lineTo(205,y+8);ctx.stroke();}
    ctx.lineWidth=7;for(let i=-200;i<65;i+=52){ctx.beginPath();ctx.moveTo(i,-30);ctx.lineTo(i+40,30);ctx.moveTo(i,-30);ctx.lineTo(i,30);ctx.stroke();}
    ctx.strokeStyle='#ff6478';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(78,-45);ctx.lineTo(70,-25);ctx.lineTo(89,-6);ctx.lineTo(74,12);ctx.lineTo(86,44);ctx.stroke();
    ctx.fillStyle='#ff91a0';ctx.font='15px Segoe UI';ctx.textAlign='center';ctx.fillText('Crack / missing rail section',65,70);
  }else{
    for(let side=0;side<2;side++){
      ctx.save();ctx.rotate(side*Math.PI);ctx.fillStyle='#ff7937';ctx.beginPath();ctx.moveTo(10,-10);ctx.lineTo(58,-17);ctx.quadraticCurveTo(130,-26,190,-17);
      if(state.mode==='propeller'&&state.damage==='cut'&&side===0){ctx.lineTo(132,-19);ctx.lineTo(139,-8);ctx.lineTo(125,2);ctx.lineTo(134,17);}
      else{ctx.quadraticCurveTo(235,-9,221,12);ctx.quadraticCurveTo(185,31,74,18);}
      ctx.lineTo(10,9);ctx.closePath();ctx.fill();
      if(state.mode==='propeller'&&state.damage==='mass'&&side===0){ctx.fillStyle='#53d59a';ctx.fillRect(94,-16,76,34);ctx.strokeStyle='#b8f4d3';ctx.lineWidth=2;ctx.strokeRect(94,-16,76,34);}
      ctx.restore();
    }
    ctx.fillStyle='#abb5be';ctx.beginPath();ctx.arc(0,0,23,0,Math.PI*2);ctx.fill();ctx.fillStyle='#27313a';ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();
    if(state.mode==='propeller'){ctx.fillStyle=state.damage==='cut'?'#ffb18d':'#7cebb5';ctx.font='15px Segoe UI';ctx.textAlign='center';ctx.fillText(state.damage==='cut'?'Shortened, uneven blade edge':'Green added-mass patch',90,65);}
  }
  ctx.restore();
}

const wave=$('#waveCanvas'),ctx=wave.getContext('2d');
function drawWave(){
  const rect=wave.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);if(wave.width!==Math.round(rect.width*dpr)){wave.width=Math.round(rect.width*dpr);wave.height=Math.round(rect.height*dpr);}
  const w=wave.width,h=wave.height;ctx.clearRect(0,0,w,h);ctx.lineWidth=1;ctx.strokeStyle='#243b49';for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
  const rpm=state.rpms[state.selected],freq=rpm/60,amplitude=vibrationAmplitude(rpm,state.mode,state.selected,state.selected);
  ['#71e3ee','#ff8246','#a4b8ff'].forEach((color,axis)=>{ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=1.4*dpr;for(let x=0;x<=w;x+=1){const value=signalAt(state.t+x/w*.1,axis,freq,amplitude,state.mode);const y=h/2-value*h*.40;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();});
}
function updateReadouts(){
  const p=state.pose,rpm=state.rpms[state.selected],amp=vibrationAmplitude(rpm,state.mode,state.selected,state.selected);
  $('#phaseBadge').textContent=p.phase==='forward'?'FORWARD FLIGHT':p.phase==='turn'?'BANKED TURN':p.phase.toUpperCase();
  $('#altitude').textContent=`${p.alt.toFixed(1)} m`;$('#speed').textContent=`${p.speed.toFixed(1)} m/s`;$('#frequency').textContent=`${(rpm/60).toFixed(1)} Hz`;
  $('#rpmReadout').innerHTML=`${Math.round(rpm).toLocaleString()} <small>rpm</small>`;$('#vibReadout').innerHTML=`${amp.toFixed(2)} <small>rel.</small>`;
  $('#imuReadout').textContent=[p.roll,p.pitch,p.yaw].map(v=>`${(v*180/Math.PI).toFixed(1)}°`).join(' / ');
  $('#bladePass').textContent=`2-blade passage ${(rpm/30).toFixed(1)} Hz`;
  $$('#rpmGrid b').forEach((el,i)=>el.textContent=Math.round(state.rpms[i]).toLocaleString());
  $$('[data-phase]').forEach(el=>el.classList.toggle('active',el.dataset.phase===p.phase));$('#timelineProgress').style.width=`${state.flightTime/45*100}%`;
}

let previous=performance.now(),lastUI=0;
function frame(now){
  const dt=Math.min((now-previous)/1000,.05);previous=now;
  if(!state.paused){
    state.t+=dt;
    if(state.flightMode==='auto')state.flightTime=(state.flightTime+dt)%45;
    else {const phase=PHASES.find(p=>p[0]===state.flightMode);state.flightTime=Math.min(state.flightTime+dt,phase[2]-.001);}
    state.pose=flightPose(state.flightTime);
    const targets=rotorTargets(state.pose,state.flightTime);
    state.rpms=state.rpms.map((rpm,i)=>{const next=rpm+(targets[i]-rpm)*(1-Math.exp(-dt*5));return next<.4?0:next;});
  }
  model?.update(state,state.paused?0:dt);drawWave();
  if(now-lastUI>120){updateReadouts();lastUI=now;}
  requestAnimationFrame(frame);
}
syncControls();requestAnimationFrame(frame);
