import type { PalaceHouse } from "./layout";
import type { CityPart } from "./architecture";

export const NEIGHBORHOOD_KINDS = ["townhouse", "greenhouse", "warehouse", "pavilion", "windmill", "pyramid"] as const;
export type NeighborhoodKind = typeof NEIGHBORHOOD_KINDS[number];

/** Small buildings give the skyline breathing room and the route distinct roofs. */
export function neighborhoodBuilding(house: PalaceHouse, kind: NeighborhoodKind, base: number, variant: number): CityPart[] {
  const parts: CityPart[] = [];
  const w=house.width, d=house.depth;
  const trim=0xeee6d5, timber=0x624c3c, slate=0x455b65;
  const paint=[0xb77d65,0x90a79c,0xbeb08c,0x9e94ae,0xc8b9a6][variant%5];
  const box=(x:number,y:number,z:number,width:number,height:number,depth:number,color=trim,extra:Partial<CityPart>={})=>parts.push({shape:"box",x,y,z,width,height,depth,color,...extra});
  const pitched=(y:number,width:number,depth:number,rise:number,color:number)=>{
    parts.push({shape:"gable",x:0,y:y+rise/2,z:0,width,height:rise,depth,color:paint});
    const angle=Math.atan2(rise,width/2);
    for(const side of [-1,1]) box(side*width/4,y+rise/2+.11,0,Math.hypot(width/2,rise)+.45,.2,depth+.8,color,{tiltZ:-side*angle});
  };
  const windows=(y:number,width=w,depth=d)=>{
    for(const side of [-1,1]) for(const along of [-.3,.3]) {
      box(along*width,y,side*(depth/2+.09),1.5,1.95,.12,trim);
      box(along*width,y,side*(depth/2+.17),1.25,1.7,.08,0x7ca6b2,{glass:true});
      box(side*(width/2+.09),y,along*depth,.12,1.95,1.5,trim);
      box(side*(width/2+.17),y,along*depth,.08,1.7,1.25,0x7ca6b2,{glass:true});
    }
  };
  // Every address keeps the same clear door and furnished ground floor.
  for(const side of [-1,1]) box(side*1.52,1.9,d/2+.16,.18,3.8,.25,trim);
  box(0,3.9,d/2+.16,3.25,.2,.25,trim);
  if(kind!=="pyramid") windows(2.65);
  box(0,base,0,w+.5,.25,d+.5,trim);

  if(kind==="pyramid") {
    const sandstone=0xc8a971;
    // A stepped pyramid over a full-height entrance chamber. Solid tiers and
    // a closed square cap avoid roof holes while preserving the walking route.
    for(let level=0;level<8;level++) {
      const scale=1-level*.1;
      box(0,base+level*1.12+.56,0,(w+.6)*scale,1.12,(d+.6)*scale,sandstone,{surface:"stone"});
      box(0,base+level*1.12+.06,0,(w+.6)*scale+.12,.12,(d+.6)*scale+.12,0xddc18c);
    }
    parts.push({shape:"pyramid",x:0,y:base+9.85,z:0,width:(w+.6)*.3,height:1.8,depth:(d+.6)*.3,color:0xc4a04f});
    for(const side of [-1,1]) {
      box(side*(w/4+1),base/2,d/2+.15,w/2-2,base,.32,sandstone,{surface:"stone"});
      for(let course=0;course<6;course++) box(side*(w/4+1),course*.92+.2,d/2+.33,w/2-2,.045,.03,0xa88b5c);
      box(side*1.65,2,d/2+.36,.35,4,.5,0xb09158,{surface:"stone"});
    }
    box(0,4.15,d/2+.36,3.65,.35,.5,sandstone,{surface:"stone"});
  } else if(kind==="townhouse") {
    const floors=1+variant%2;
    box(0,base+floors*1.5,0,w,floors*3,d,paint,{surface:"stone"});
    for(let floor=0;floor<floors;floor++) {
      const y=base+floor*3;
      windows(y+1.5);
      box(0,y,0,w+.3,.16,d+.3,trim);
      // Projecting balconies have open rails, rather than solid floating boxes.
      for(const side of [-1,1]) {
        const x=side*w*.3;
        box(x,y+.35,d/2+.6,2.35,.16,1.2,trim);
        box(x,y+1.25,d/2+1.15,2.35,.08,.08,slate);
        for(let rail=0;rail<5;rail++) box(x+(rail-2)*.5,y+.8,d/2+1.15,.05,.9,.05,slate);
      }
    }
    pitched(base+floors*3,w+.25,d,2.6,slate);
    box(w*.3,base+floors*3+2,-d*.25,.65,3,.7,paint,{surface:"stone"});
  } else if(kind==="greenhouse") {
    const rise=3.8;
    // A glass conservatory roof with exposed bronze rafters and raised planters.
    const angle=Math.atan2(rise,w/2);
    for(const side of [-1,1]) {
      // Close both triangular ends; the slopes alone leave a visible hole.
      parts.push({shape:"gable",x:0,y:base+rise/2,z:side*d/2,width:w,height:rise,depth:.14,color:0x83c4c0,glass:true});
      box(0,base+rise/2,side*(d/2+.09),.14,rise,.14,0x806a44);
      box(0,base+.08,side*(d/2+.09),w,.16,.16,trim);
    }
    for(const side of [-1,1]) {
      box(side*w/4,base+rise/2+.1,0,Math.hypot(w/2,rise),.12,d,0x83c4c0,{glass:true,tiltZ:-side*angle});
      for(let rib=0;rib<7;rib++) box(side*w/4,base+rise/2+.2,(rib/6-.5)*d,Math.hypot(w/2,rise)+.25,.13,.12,0x806a44,{tiltZ:-side*angle});
      box(side*w*.2,base+.5,0,1.6,.8,d*.75,paint);
      for(let plant=0;plant<5;plant++) parts.push({shape:"sphere",x:side*w*.2,y:base+1.05,z:(plant/4-.5)*d*.6,width:1.05,height:.75,depth:1.05,color:0x6f9549});
    }
    box(0,base+rise+.2,0,.18,.18,d+.3,trim);
  } else if(kind==="warehouse") {
    // Three parallel sawtooth roof bays, each properly capped and supported.
    const bay=w/3, rise=2.2;
    box(0,base+.55,0,w,1.1,d,paint,{surface:"stone"});
    for(let i=0;i<3;i++) {
      const x=(i-1)*bay;
      parts.push({shape:"gable",x,y:base+1.1+rise/2,z:0,width:bay,height:rise,depth:d,color:paint});
      for(const side of [-1,1]) box(x+side*bay/4,base+1.1+rise/2+.1,0,Math.hypot(bay/2,rise)+.12,.14,d+.6,slate,{tiltZ:-side*Math.atan2(rise,bay/2)});
    }
    for(const side of [-1,1]) box(side*w*.43,base/2,d/2+.15,.45,base,.3,paint,{surface:"stone"});
  } else if(kind==="pavilion") {
    // A broad overhanging copper hip roof and a small raised lantern.
    parts.push({shape:"pyramid",x:0,y:base+1.6,z:0,width:w+1,height:3,depth:d+1,color:0x5a857d});
    box(0,base+3.55,0,2.3,.8,2.3,0x8bbac2,{glass:true});
    parts.push({shape:"pyramid",x:0,y:base+4.4,z:0,width:2.9,height:1,depth:2.9,color:slate});
    for(const side of [-1,1]) box(side*(w/2-.15),base/2,d/2+.3,.3,base,.35,timber,{surface:"wood"});
  } else {
    // A windmill is a rare civic landmark, with sails fully above the doorway.
    parts.push({shape:"cylinder",x:0,y:base+3.5,z:0,width:w*.55,height:7,depth:w*.55,color:paint});
    parts.push({shape:"cone",x:0,y:base+8.5,z:0,width:w*.7,height:3,depth:w*.7,color:slate});
    const hubY=base+5, front=w*.28+.35;
    for(let blade=0;blade<4;blade++) {
      const angle=blade*Math.PI/2+.25;
      box(Math.sin(angle)*2.25,hubY+Math.cos(angle)*2.25,front,.25,4.5,.22,timber,{tiltZ:-angle});
      for(let slat=0;slat<6;slat++) {
        const reach=1.3+slat*.48;
        box(Math.sin(angle)*reach,hubY+Math.cos(angle)*reach,front+.15,1.2,.18,.12,trim,{tiltZ:-angle});
      }
    }
    parts.push({shape:"sphere",x:0,y:hubY,z:front+.2,width:.7,height:.7,depth:.7,color:timber});
  }
  return parts;
}
