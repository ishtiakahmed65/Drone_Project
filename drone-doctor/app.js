(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STATUS = ['normal', 'warning', 'danger', 'unassessed', 'invalid'];
  const MODES = ['idle', 'ground', 'thrust', 'flight', 'unknown'];
  const OVERALL = ['normal', 'warning', 'danger', 'idle', 'unknown'];
  const FAULTS = [[1, 'Propeller damage'], [2, 'Crack'], [4, 'Loose screw']];
  const names = {4:'Quadcopter', 6:'Hexacopter', 8:'Octocopter'};
  const labels = { normal:'Normal', warning:'Warning', danger:'Danger', idle:'Idle', unknown:'Unknown', unassessed:'Awaiting assessment', invalid:'Data unavailable', ground:'Ground', thrust:'Thrust', flight:'Flight' };
  const colors = { normal:'#6ae5b3', warning:'#ffca75', danger:'#ff8288', unassessed:'#96adba', invalid:'#96adba', idle:'#8acbff', unknown:'#96adba' };
  const state = {
    link:'disconnected', station:'', demo:false, demoPaused:false, telemetry:null, fresh:false,
    ageMs:0, receiverReady:null, timeoutMs:5000, invalidPackets:0, events:[], activeTab:'monitor',
    lastBaseContact:0, baseReportedAge:0, baseReportAt:0, receivedAt:0, previousCondition:'',
    closedSessions:new Set(), demoFrame:null, demoStarted:0, demoSequence:0, demoControlsArmId:null,
    port:null, reader:null, receiveBuffer:'', discardingLine:false, connectGeneration:0
  };

  function now() { return performance.now(); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clock() { return new Date().toLocaleTimeString([], {hour12:false}); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function addEvent(title, detail) {
    state.events.unshift({time:clock(), title, detail});
    state.events = state.events.slice(0, 60);
    renderEvents();
  }

  function wireFaultNames(mask) { return FAULTS.filter(([bit]) => (mask & bit) !== 0).map(([, name]) => name); }
  function armDescription(arm) {
    if (arm.state === 'invalid') return 'Data unavailable';
    if (arm.state === 'unassessed') return 'Awaiting assessment';
    if (arm.state === 'normal') return 'Normal';
    const faults = wireFaultNames(arm.faults);
    return faults.length ? `Possible ${faults.join(' + ').toLowerCase()}` : 'Fault not classified';
  }
  function displayCondition(t) {
    if (t.overall === 'danger' || t.arms.some(a => a.state === 'danger')) return 'danger';
    if (t.overall === 'warning' || t.arms.some(a => a.state === 'warning')) return 'warning';
    if (t.arms.some(a => a.state === 'invalid') || t.mode === 'unknown' || t.overall === 'unknown' || t.arms.some(a => a.state === 'unassessed')) return 'unknown';
    if (t.mode === 'idle') return 'idle';
    return 'normal';
  }
  function dataAge() {
    if (!state.telemetry) return Infinity;
    const telemetryAge = state.telemetry.ageMs + Math.max(0, now() - state.receivedAt);
    const stationAge = state.lastBaseContact ? state.baseReportedAge + Math.max(0, now() - state.baseReportAt) : 0;
    return Math.max(telemetryAge, stationAge);
  }
  function updateFreshness() {
    const wasFresh = state.fresh;
    const age = dataAge();
    const heartbeatFresh = state.lastBaseContact > 0 && now() - state.lastBaseContact <= state.timeoutMs;
    const fresh = state.link === 'connected' && heartbeatFresh && state.receiverReady !== false && !!state.telemetry && age <= state.timeoutMs;
    if (state.fresh && !fresh && state.telemetry) addEvent('Telemetry interrupted', 'Current arm conditions are no longer confirmed.');
    if (!state.fresh && fresh && state.telemetry && state.previousCondition) addEvent('Telemetry restored', 'Fresh drone data is arriving.');
    state.fresh = fresh;
    state.ageMs = Number.isFinite(age) ? age : 0;
    if (state.telemetry && wasFresh !== fresh) renderDashboard();
    else if (state.telemetry) {
      $('dataAge').textContent=`${(state.ageMs/1000).toFixed(1)} s`;
      $('freshness').textContent=fresh?'Live':'Stale';
      $('freshness').className=fresh?'fresh-text':'stale-text';
    }
    renderHeader();
  }

  function validateMessage(raw) {
    if (typeof raw !== 'string' || raw.length > 8192) throw new Error('Message too long');
    const o = JSON.parse(raw);
    const integer = (key, min, max) => {
      const v = o[key];
      if (!Number.isSafeInteger(v) || v < min || v > max) throw new Error(`${key} is out of range`);
      return v;
    };
    if (integer('version', 1, 1) !== 1) throw new Error('Unsupported protocol version');
    if (o.type === 'base_status') {
      if (typeof o.receiver_ready !== 'boolean') throw new Error('receiver_ready must be Boolean');
      const age = o.last_drone_packet_age_ms == null ? null : integer('last_drone_packet_age_ms', 0, 0xffffffff);
      return {type:'base_status', receiverReady:o.receiver_ready, age};
    }
    if (o.type !== 'telemetry') throw new Error('Unknown message type');
    const droneId = integer('drone_id', 0, 65535), sessionId = integer('session_id', 0, 65535);
    const sequence = integer('sequence', 0, 65535), sampleMs = integer('sample_ms', 0, 0xffffffff);
    const armCount = integer('arm_count', 4, 8);
    if (![4,6,8].includes(armCount)) throw new Error('Supported arm counts are 4, 6, or 8');
    if (!MODES.includes(o.mode)) throw new Error('Unsupported operating mode');
    if (!OVERALL.includes(o.overall)) throw new Error('Unsupported overall condition');
    if (o.mode !== 'idle' && o.overall === 'idle') throw new Error('Idle condition conflicts with operating mode');
    if (!Array.isArray(o.arms) || o.arms.length !== armCount) throw new Error('Arm count and results disagree');
    const arms = o.arms.map(a => {
      if (!a || !Number.isSafeInteger(a.id) || a.id < 1 || a.id > armCount || !STATUS.includes(a.state) || !Number.isSafeInteger(a.faults) || a.faults < 0 || a.faults > 7) throw new Error('Invalid arm result');
      if (['normal','invalid','unassessed'].includes(a.state) && a.faults !== 0) throw new Error('Arm state conflicts with fault flags');
      return {id:a.id, state:a.state, faults:a.faults};
    }).sort((a,b) => a.id-b.id);
    if (arms.some((a,i) => a.id !== i+1)) throw new Error('Arm IDs must be unique and complete');
    for (const [key,min,max] of [['lora_rssi_dbm',-200,30],['lora_snr_db',-100,100]]) {
      if (o[key] != null && (typeof o[key] !== 'number' || !Number.isFinite(o[key]) || o[key] < min || o[key] > max)) throw new Error(`${key} is out of range`);
    }
    const ageMs = integer('last_drone_packet_age_ms', 0, 0xffffffff);
    return {type:'telemetry', droneId, sessionId, sequence, sampleMs, armCount, mode:o.mode, overall:o.overall,
      arms, rssi:o.lora_rssi_dbm == null ? null : Math.trunc(o.lora_rssi_dbm), snr:o.lora_snr_db ?? null, ageMs};
  }

  function acceptFrame(t) {
    const old = state.telemetry;
    if (old) {
      if (t.droneId !== old.droneId) return false;
      if (t.sessionId === old.sessionId) {
        if (t.armCount !== old.armCount) return false;
        const seqDelta = (t.sequence - old.sequence) & 0xffff;
        const timeDelta = (t.sampleMs - old.sampleMs) >>> 0;
        if (seqDelta < 1 || seqDelta > 32767 || timeDelta < 1 || timeDelta > 0x7fffffff) return false;
      } else {
        if (state.closedSessions.has(t.sessionId)) return false;
        state.closedSessions.add(old.sessionId);
      }
    }
    state.telemetry = t;
    state.receivedAt = now();
    state.lastBaseContact = now();
    state.receiverReady = true;
    state.baseReportedAge = t.ageMs;
    state.baseReportAt = now();
    state.station ||= 'Base station';
    const signature = `${t.mode}:${t.overall}:${JSON.stringify(t.arms)}`;
    if (signature !== state.previousCondition) {
      const affected = t.arms.filter(a => ['warning','danger','invalid'].includes(a.state));
      const detail = affected.length ? affected.map(a => `Arm ${a.id}: ${armDescription(a)}`).join('; ')
        : (t.mode === 'idle' ? 'Propellers stationary. Waiting to begin assessment.' : 'Arm assessments updated.');
      addEvent(`${labels[t.mode]} · ${labels[displayCondition(t)]}`, detail);
      state.previousCondition = signature;
    }
    if ($('connectScreen')) $('connectScreen').hidden = true;
    $('dashboard').hidden = false;
    renderDashboard();
    return true;
  }

  function receiveLine(line) {
    if (!line.trim()) return;
    try {
      const message = validateMessage(line.trim());
      if (message.type === 'base_status') {
        state.lastBaseContact = now();
        state.receiverReady = message.receiverReady;
        state.baseReportedAge = message.age ?? 0;
        state.baseReportAt = now();
        if (message.receiverReady === false) $('liveMessage').textContent = 'Base station reports that its LoRa receiver is not ready.';
      } else if (!state.telemetry && message.ageMs > state.timeoutMs) {
        state.lastBaseContact = now();
        state.receiverReady = true;
        state.baseReportedAge = message.ageMs;
        state.baseReportAt = now();
        $('liveMessage').textContent = 'The base station has an old assessment. Waiting for fresh drone telemetry.';
      } else {
        acceptFrame(message);
      }
    } catch (error) {
      state.invalidPackets++;
      $('liveMessage').textContent = `Unreadable telemetry ignored (${error.message}).`;
    }
    updateFreshness();
  }

  function addBytes(bytes) {
    const text = new TextDecoder().decode(bytes, {stream:true});
    for (const ch of text) {
      if (ch === '\n') {
        if (!state.discardingLine && state.receiveBuffer.trim()) receiveLine(state.receiveBuffer.replace(/\r$/, ''));
        state.receiveBuffer = '';
        state.discardingLine = false;
      } else if (!state.discardingLine) {
        if (state.receiveBuffer.length >= 8192) { state.receiveBuffer = ''; state.discardingLine = true; }
        else state.receiveBuffer += ch;
      }
    }
  }

  async function connectLive(kind) {
    const isBluetooth=kind==='bluetooth';
    const sourceLabel=isBluetooth?'Bluetooth SPP base station':'LoRa board (USB serial)';
    if (!('serial' in navigator)) {
      $('connectMessage').textContent = 'Web Serial is unavailable in this browser. Use desktop Chrome or Edge, or explore the demo.';
      return;
    }
    try {
      $('connectMessage').textContent = isBluetooth
        ? 'Choose the previously paired Bluetooth SPP base station in the browser prompt.'
        : 'Connect the LoRa board by USB, then choose its USB serial port in the browser prompt.';
      const port = await navigator.serial.requestPort(isBluetooth
        ? {filters:[{bluetoothServiceClassId:'00001101-0000-1000-8000-00805f9b34fb'}]}
        : {});
      const portInfo=port.getInfo?.()||{};
      if (isBluetooth && portInfo.bluetoothServiceClassId && portInfo.bluetoothServiceClassId.toLowerCase()!=='00001101-0000-1000-8000-00805f9b34fb') {
        $('connectMessage').textContent = 'Select a Bluetooth Serial Port Profile (SPP) device.';
        return;
      }
      if (!isBluetooth && portInfo.bluetoothServiceClassId) {
        $('connectMessage').textContent = 'That is a Bluetooth port. Choose the LoRa board USB serial port instead.';
        return;
      }
      const generation = ++state.connectGeneration;
      state.port = port;
      await port.open({baudRate:Number($('baudRate').value)});
      state.link = 'connected';
      state.demo = false;
      state.station = sourceLabel;
      state.lastBaseContact = 0;
      state.receiverReady = null;
      state.telemetry = null;
      state.invalidPackets = 0;
      state.events = [];
      state.closedSessions.clear();
      state.previousCondition = '';
      state.receiveBuffer = '';
      state.discardingLine = false;
      $('connectScreen').hidden = false;
      $('dashboard').hidden = true;
      $('connectMessage').textContent = 'Connected. Waiting for the base station to send telemetry…';
      addEvent('Base station connected', state.station);
      renderHeader();
      while (port.readable && generation === state.connectGeneration) {
        const reader = port.readable.getReader();
        state.reader = reader;
        try {
          while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            if (value) addBytes(value);
          }
        } catch (error) {
            if (generation === state.connectGeneration) $('liveMessage').textContent = `${isBluetooth?'Bluetooth':'USB serial'} stream ended: ${error.message}`;
        } finally {
          reader.releaseLock();
          if (state.reader === reader) state.reader = null;
        }
      }
      if (generation === state.connectGeneration && state.link === 'connected') {
        state.link = 'disconnected';
        addEvent(`${isBluetooth?'Bluetooth':'USB'} disconnected`, 'Live monitoring has stopped.');
        updateFreshness();
      }
    } catch (error) {
      if (error.name !== 'NotFoundError') $('connectMessage').textContent = isBluetooth
        ? `Could not connect: ${error.message}. Pair the base station first, then retry.`
        : `Could not connect: ${error.message}. Check the USB cable, select the LoRa board port, and verify its baud rate.`;
    }
  }

  async function disconnect() {
    state.connectGeneration++;
    const wasDemo = state.demo;
    const hadLink = state.link !== 'disconnected';
    state.demoPaused = false;
    state.demo = false;
    state.demoFrame = null;
    if (state.demoTimer) { clearInterval(state.demoTimer); state.demoTimer = null; }
    state.link = 'disconnected';
    state.station = '';
    state.lastBaseContact = 0;
    state.receiverReady = null;
    state.telemetry = null;
    state.fresh = false;
    state.receiveBuffer = '';
    state.previousCondition = '';
    state.events = [];
    state.closedSessions.clear();
    try { await state.reader?.cancel(); } catch (_) {}
    try { await state.port?.close(); } catch (_) {}
    state.reader = null; state.port = null;
    $('dashboard').hidden = true;
    $('connectScreen').hidden = false;
    $('connectMessage').textContent = '';
    $('liveMessage').textContent = '';
    if (hadLink && !wasDemo) addEvent('Disconnected', 'Session ended.');
    renderHeader();
  }

  function startDemo() {
    disconnect().then(() => {
      const count = Number($('demoArms').value);
      state.link = 'connecting'; state.demo = true; state.demoPaused = false; state.station = 'Demo base station';
      state.demoControlsArmId = null;
      state.invalidPackets = 0; state.events = []; state.demoSequence = 0; state.demoStarted = Date.now();
      state.closedSessions.clear(); state.previousCondition = '';
      state.demoFrame = {type:'telemetry', droneId:12, sessionId:(Date.now() & 0xffff), sequence:0, sampleMs:0,
        armCount:count, mode:'idle', overall:'idle', arms:Array.from({length:count},(_,i)=>({id:i+1,state:'unassessed',faults:0})),rssi:-91,snr:8.5,ageMs:0};
      $('connectScreen').hidden = true; $('dashboard').hidden = false;
      setTimeout(() => {
        if (!state.demo) return;
        state.link = 'connected'; state.receiverReady = true; state.lastBaseContact = now();
        addEvent('Demo connected', 'Simulated data. No aircraft is being controlled.');
        emitDemo(); renderDashboard();
        if (state.demoTimer) clearInterval(state.demoTimer);
        state.demoTimer = setInterval(() => { if (state.demo && !state.demoPaused) emitDemo(); }, 1000);
      }, 450);
      renderDashboard(); renderHeader();
    });
  }

  function emitDemo() {
    if (!state.demoFrame) return;
    const t = {...state.demoFrame, sequence:(state.demoSequence = (state.demoSequence + 1) & 0xffff), sampleMs:((Date.now()-state.demoStarted)>>>0), ageMs:0};
    state.lastBaseContact = now(); state.receiverReady = true;
    acceptFrame(t); updateFreshness();
  }
  function changeDemoMode(mode) {
    if (!state.demoFrame || !MODES.includes(mode) || mode === 'unknown') return;
    state.demoFrame.mode = mode;
    state.demoFrame.overall = mode === 'idle' ? 'idle' : 'normal';
    state.demoFrame.arms = state.demoFrame.arms.map(a => ({id:a.id,state:mode === 'idle' ? 'unassessed' : 'normal',faults:0}));
    state.demoControlsArmId = null;
    renderDashboard();
    if (!state.demoPaused) { state.demoControlsArmId = null; emitDemo(); }
  }
  function applyDemoFault() {
    if (!state.demoFrame || state.demoFrame.mode === 'idle') return;
    const armId = Number($('armSelect').value);
    const mask = [...document.querySelectorAll('#faultChoices input:checked')].reduce((s,input)=>s+Number(input.value),0);
    const danger = $('dangerFlag').checked && mask > 0;
    const invalid = $('invalidFlag').checked;
    state.demoFrame.arms = state.demoFrame.arms.map(a => a.id === armId ? {id:a.id,state:invalid?'invalid':danger?'danger':mask?'warning':'normal',faults:invalid?0:mask} : a);
    state.demoFrame.overall = state.demoFrame.arms.some(a=>a.state==='danger')?'danger':state.demoFrame.arms.some(a=>a.state==='warning')?'warning':state.demoFrame.arms.some(a=>a.state==='invalid')?'unknown':'normal';
    state.demoControlsArmId = null;
    emitDemo(); renderDashboard();
  }
  function toggleDemoPause() {
    state.demoPaused = !state.demoPaused;
    $('pauseDemo').textContent = state.demoPaused ? 'Resume stream' : 'Pause stream';
    if (!state.demoPaused) emitDemo();
    renderDashboard();
  }

  function overallLabel(t) {
    if (!state.fresh) return 'Data unavailable';
    return labels[displayCondition(t)];
  }
  function statusClass(status) { return ['normal','warning','danger','idle','unknown'].includes(status) ? status : 'unknown'; }
  function pointFor(i,n) {
    const angle = -Math.PI/2 + Math.PI/n + i*2*Math.PI/n;
    return {x:300+Math.cos(angle)*175,y:240+Math.sin(angle)*175,a:angle};
  }
  function diagramSvg(t) {
    const n=t.armCount;
    const arms=t.arms;
    const active=state.fresh && ['ground','thrust','flight'].includes(t.mode);
    const outer=arms.map((arm,i)=>{
      const p=pointFor(i,n), color=state.fresh?colors[arm.state]:'#96adba';
      const hx=p.x-Math.cos(p.a)*10, hy=p.y-Math.sin(p.a)*10;
      const spinClass=active?'propeller':'propeller paused';
      const spinDirection=i%2===0?'normal':'reverse';
      const spinDelay=`-${(i*.035).toFixed(3)}s`;
      const labelX=Math.cos(p.a)*31, labelY=Math.sin(p.a)*31;
      const crackLocal=arm.state==='warning'&&arm.faults&2?'<path d="M-4 -7l4 6-3 3 5 5" class="cracked" stroke="#ffca75" stroke-width="3" fill="none"/>':'';
      return `<line x1="300" y1="240" x2="${hx}" y2="${hy}" class="airframe-arm"/><line x1="300" y1="240" x2="${hx}" y2="${hy}" stroke="${color}" stroke-opacity=".46" stroke-width="3" stroke-linecap="round"/><g class="arm-hit" transform="translate(${p.x} ${p.y})" role="button" tabindex="0" aria-label="Arm ${arm.id}: ${esc(state.fresh?armDescription(arm):'Data unavailable')}" data-arm="${arm.id}" style="--arm-color:${color}"><g class="${spinClass}" style="animation-direction:${spinDirection};animation-delay:${spinDelay}"><path d="M-3 -3C-11 -9-33 -16-43 -9c-7 5-4 13 5 16 13 4 27-1 35-5z"/><path d="M3 3C11 9 33 16 43 9c7-5 4-13-5-16-13-4-27 1-35 5z"/></g><circle class="motor-ring" cx="0" cy="0" r="19"/><circle class="motor-core" cx="0" cy="0" r="5"/>${crackLocal}<text x="${labelX}" y="${labelY}" class="arm-number">${arm.id}</text></g>`;
    }).join('');
    return `<svg viewBox="0 0 600 480" role="img" aria-label="Top view of ${n}-arm aircraft, front at top. Arm one is front right, numbered clockwise."><circle cx="300" cy="240" r="188" fill="none" stroke="#253744" stroke-dasharray="3 9"/><circle cx="300" cy="240" r="119" fill="none" stroke="#253744"/><path d="M300 38l-5 11h10z" fill="#6ae5b3"/><text x="300" y="27" text-anchor="middle" fill="#96adba" font-size="10" font-family="Manrope">FRONT</text>${outer}<path class="airframe-core" d="M300 204l28 19-8 39h-40l-8-39z"/><rect x="285" y="225" width="30" height="23" rx="6" fill="#152d37" stroke="#6ae5b3"/><path d="M296 236h8m-4-4v8" stroke="#6ae5b3" stroke-width="2" stroke-linecap="round"/></svg>`;
  }

  function renderDiagram(t) {
    $('droneDiagram').innerHTML=diagramSvg(t);
    $('droneDiagram').querySelectorAll('[data-arm]').forEach(el=>{
      el.addEventListener('click',()=>showArm(Number(el.dataset.arm)));
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showArm(Number(el.dataset.arm));}});
    });
  }
  function renderArms(t) {
    $('armCards').innerHTML=t.arms.map(a=>{
      const status=state.fresh?a.state:'unknown';
      return `<button class="arm-card" style="--arm-color:${colors[status]}" data-arm="${a.id}"><i class="arm-status"></i><span><b>ARM ${pad(a.id)}</b><small>${esc(state.fresh?armDescription(a):'Data unavailable')}</small></span></button>`;
    }).join('');
    $('armCards').querySelectorAll('[data-arm]').forEach(el=>el.addEventListener('click',()=>showArm(Number(el.dataset.arm))));
  }
  function renderDashboard() {
    const t=state.telemetry;
    if (!t) return;
    $('aircraftName').textContent=`${names[t.armCount].toUpperCase()} · DRONE ${String(t.droneId).padStart(3,'0')}`;
    $('dashboardTitle').textContent=names[t.armCount];
    $('dashboardSubtitle').textContent=`Drone ${String(t.droneId).padStart(3,'0')} · ${t.armCount} arms · Session ${t.sessionId}`;
    $('demoBanner').hidden=!state.demo;
    $('baseConnection').textContent=state.link==='connected'?(state.station||'Connected'):'Disconnected';
    $('receiverState').textContent=state.receiverReady===true?'Ready':state.receiverReady===false?'Not ready':'Unknown';
    $('invalidCount').textContent=String(state.invalidPackets);
    $('dataAge').textContent=`${(state.ageMs/1000).toFixed(1)} s`;
    $('freshness').textContent=state.fresh?'Live':state.telemetry?'Stale':'Waiting';
    $('freshness').className=state.fresh?'fresh-text':state.telemetry?'stale-text':'';
    $('modeText').textContent=`${labels[t.mode]} mode`;
    $('overallCondition').textContent=overallLabel(t);
    const cond=state.fresh?displayCondition(t):'unknown';
    $('conditionIcon').textContent=state.fresh?(cond==='normal'?'✓':cond==='warning'?'!':cond==='danger'?'×':cond==='idle'?'Ⅱ':'?'):'?';
    $('conditionIcon').style.setProperty('--state-color',state.fresh?colors[cond]:'#96adba');
    $('conditionIcon').style.color=state.fresh?colors[cond]:'#96adba';
    $('conditionPanel')?.style.setProperty('--state-color',state.fresh?colors[cond]:'#96adba');
    const incomplete=t.arms.filter(a=>['invalid','unassessed'].includes(a.state)).length;
    $('incompleteCount').textContent=String(incomplete);
    $('loraStatus').textContent=t.rssi==null?'No signal data':`${t.rssi} dBm${t.snr==null?'':` · ${t.snr} dB SNR`}`;
    const notices=[];
    if (!state.fresh) notices.push(`<div class="notice">${state.link!=='connected'?'Base station disconnected. Reconnect to resume monitoring.':'Drone data is stale or unavailable. Arm conditions are not current.'}</div>`);
    if (state.fresh&&incomplete>0&&['warning','danger'].includes(cond)) notices.push('<div class="notice">Some arms also have unavailable assessments.</div>');
    $('noticeArea').innerHTML=notices.join('');
    renderDiagram(t); renderArms(t); renderDemoControls(); renderHeader();
  }
  function renderHeader() {
    const el=$('headerStatus');
    if (state.link==='connected'&&state.fresh) {el.className='header-status connected';el.innerHTML='<span class="status-dot"></span><span>Live telemetry</span>';}
    else if (state.link==='connected') {el.className='header-status stale';el.innerHTML='<span class="status-dot"></span><span>Connected · waiting</span>';}
    else {el.className='header-status';el.innerHTML='<span class="status-dot"></span><span>Not connected</span>';}
  }
  function syncDemoFaultControls() {
    const armId=Number($('armSelect').value), arm=state.telemetry?.arms.find(a=>a.id===armId);
    if(!arm) return;
    $('faultChoices').querySelectorAll('input').forEach(input=>input.checked=(arm.faults&Number(input.value))!==0);
    $('dangerFlag').checked=arm.state==='danger';
    $('invalidFlag').checked=arm.state==='invalid';
    state.demoControlsArmId=armId;
  }
  function renderDemoControls() {
    $('demoControls').hidden=!state.demo;
    if (!state.demo || !state.telemetry) return;
    $('demoMode').value=state.telemetry.mode;
    $('pauseDemo').textContent=state.demoPaused?'Resume stream':'Pause stream';
    $('demoMode').disabled=state.demoPaused;
    const armSelect=$('armSelect'), selectedArm=armSelect.value, arms=state.telemetry.arms;
    const optionsMatch=armSelect.options.length===arms.length&&arms.every((arm,i)=>armSelect.options[i].value===String(arm.id));
    if(!optionsMatch) armSelect.innerHTML=arms.map(a=>`<option value="${a.id}">Arm ${pad(a.id)}</option>`).join('');
    armSelect.value=arms.some(a=>String(a.id)===selectedArm)?selectedArm:String(arms[0].id);
    if(state.demoControlsArmId!==Number(armSelect.value)) syncDemoFaultControls();
    $('faultChoices').querySelectorAll('input').forEach(input=>input.disabled=state.telemetry.mode==='idle'||state.demoPaused);
    $('dangerFlag').disabled=state.telemetry.mode==='idle'||state.demoPaused;
    $('invalidFlag').disabled=state.telemetry.mode==='idle'||state.demoPaused;
    $('applyFault').disabled=state.telemetry.mode==='idle'||state.demoPaused;
  }
  function showArm(id) {
    const t=state.telemetry, arm=t?.arms.find(a=>a.id===id); if(!arm)return;
    $('dialogArmTitle').textContent=`Arm ${pad(id)}`;
    $('dialogArmState').textContent=state.fresh?armDescription(arm):'Current assessment unavailable';
    $('dialogArmState').style.color=state.fresh?colors[arm.state]:'#96adba';
    const faultNames=wireFaultNames(arm.faults);
    $('dialogFaults').innerHTML=faultNames.map(n=>`<span class="fault-tag">Possible ${esc(n)}</span>`).join('')||'<span class="muted">No fault flags reported.</span>';
    $('dialogHint').textContent=arm.state==='unassessed'&&state.fresh?'Fault assessment begins when the drone reports a monitoring mode.':faultNames.length?'Reported by the drone detector. These are possible faults, not a confirmed inspection result.':'';
    $('armDialog').showModal();
  }

  function renderEvents() {
    $('eventCount').textContent=String(state.events.length);
    $('eventsList').innerHTML=state.events.length?state.events.map(e=>`<article class="event-item"><time class="event-time">${esc(e.time)}</time><div><b>${esc(e.title)}</b><p>${esc(e.detail)}</p></div></article>`).join(''):'<p class="empty-events">Events will appear when telemetry arrives.</p>';
  }
  function setTab(tab) {
    state.activeTab=tab;
    document.querySelectorAll('.tab').forEach(el=>el.classList.toggle('active',el.dataset.tab===tab));
    for(const name of ['monitor','events','settings']) $(`${name}Tab`).hidden=name!==tab;
  }
  function exportSession() {
    const payload={app:'Drone Doctor',version:'0.1.0-web',demo:state.demo,exported_at:new Date().toISOString(),telemetry_fresh:state.fresh,
      data_age_ms:Math.round(state.ageMs),invalid_packets:state.invalidPackets,latest_telemetry:state.telemetry,events:[...state.events].reverse()};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url; a.download='drone-doctor-session.json'; a.click(); URL.revokeObjectURL(url);
  }

  $('connectBluetooth').addEventListener('click',()=>connectLive('bluetooth'));
  $('connectUsb').addEventListener('click',()=>connectLive('usb'));
  $('startDemo').addEventListener('click',startDemo);
  $('disconnect').addEventListener('click',disconnect);
  $('demoMode').addEventListener('change',e=>changeDemoMode(e.target.value));
  $('armSelect').addEventListener('change',syncDemoFaultControls);
  $('applyFault').addEventListener('click',applyDemoFault);
  $('pauseDemo').addEventListener('click',toggleDemoPause);
  $('timeoutSelect').addEventListener('change',e=>{state.timeoutMs=Number(e.target.value)*1000;updateFreshness();});
  $('exportSession').addEventListener('click',exportSession);
  $('clearEvents').addEventListener('click',()=>{state.events=[];renderEvents();});
  document.querySelectorAll('.tab').forEach(el=>el.addEventListener('click',()=>setTab(el.dataset.tab)));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  setInterval(updateFreshness,250);
  renderEvents();
  setTimeout(()=>{const w=$('welcome');if(w)w.remove();},2450);
})();

