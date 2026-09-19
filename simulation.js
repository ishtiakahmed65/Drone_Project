export const PHASES=[['takeoff',0,6],['hover',6,13],['forward',13,23],['turn',23,33],['landing',33,41],['ground',41,45]];
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
export const flexEnvelope=s=>s*s*(3-s)/2;

// Scripted kinematics, not a flight-dynamics solver. UI labels all outputs simulated.
export function flightPose(time){
  time=clamp(time,0,44.9999);const [phase,start,end]=PHASES.find(p=>time>=p[1]&&time<p[2]);const u=(time-start)/(end-start),e=smooth(u);
  const pose={phase,u,alt:2,x:0,z:0,roll:0,pitch:0,yaw:0,speed:0,baseRpm:3700};
  if(phase==='takeoff'){pose.alt=2*e;pose.baseRpm=3700*smooth(u*4)+310*Math.sin(Math.PI*u);}
  if(phase==='hover'){pose.alt=2+.025*Math.sin(u*6*Math.PI);pose.x=.025*Math.sin(u*4*Math.PI);}
  if(phase==='forward'){pose.z=-1.5*e;pose.pitch=-.17*Math.sin(Math.PI*u);pose.baseRpm=3700+140*Math.sin(Math.PI*u);pose.speed=.9*Math.sin(Math.PI*u);}
  if(phase==='turn'){pose.x=1.5*Math.sin(e*Math.PI/2);pose.z=-1.5*Math.cos(e*Math.PI/2);pose.roll=-.22*Math.sin(Math.PI*u);pose.yaw=-Math.PI/2*e;pose.baseRpm=3700/Math.sqrt(Math.max(.8,Math.cos(pose.roll)));pose.speed=.65*Math.sin(Math.PI*u);}
  if(phase==='landing'){pose.x=1.5*(1-e);pose.alt=2*(1-e);pose.yaw=-Math.PI/2;pose.baseRpm=u>.92?3700*(1-smooth((u-.92)/.08)):3700-190*Math.sin(Math.PI*u)+120*Math.exp(-(((u-.82)/.08)**2));pose.speed=.5*Math.sin(Math.PI*u);}
  if(phase==='ground'){pose.alt=0;pose.baseRpm=0;pose.yaw=-Math.PI/2;}
  return pose;
}

export function rotorTargets(pose,time){
  if(pose.baseRpm<1)return Array(8).fill(0);
  // Differential response is largest during attitude transitions, not a permanent
  // torque proportional to a held bank angle. Total relative allocation averages 1.
  const next=flightPose(Math.min(44.99,time+.01));
  const rollRate=clamp((next.roll-pose.roll)/.01,-.5,.5),pitchRate=clamp((next.pitch-pose.pitch)/.01,-.5,.5);
  const q=Array.from({length:8},(_,i)=>{const a=Math.PI/8+i*Math.PI/4;return Math.max(.65,1+rollRate*.45*Math.cos(a)-pitchRate*.45*Math.sin(a));});
  const mean=q.reduce((a,b)=>a+b,0)/8;
  return q.map((thrust,i)=>pose.baseRpm*Math.sqrt(thrust/mean)+8*Math.sin(time*1.8+i*.9));
}

export function vibrationAmplitude(rpm,mode,selected,index){
  if(rpm<5)return 0;
  const local=(mode==='normal'||selected!==index)?.11:mode==='propeller'?.58:.72;
  return local*(rpm/3700)**2;
}

export function signalAt(t,axis,frequency,amplitude,mode){
  const phase=axis*1.25;
  return amplitude*((.70-axis*.10)*Math.sin(2*Math.PI*frequency*t+phase)+.16*Math.sin(4*Math.PI*frequency*t+phase*.7)+(mode==='arm'?.38*Math.sin(2*Math.PI*11*t+phase):.05*Math.sin(2*Math.PI*19*t+phase)));
}
