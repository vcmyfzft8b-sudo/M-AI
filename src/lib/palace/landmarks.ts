import type { PalaceHouse } from "./layout";
import type { CityPart } from "./architecture";

export type LandmarkKind = "cottage" | "houseboat" | "clocktower" | "observatory";

/** The same walkable room footprint serves very different, recognizable places.
 * Decorations above head height never change the route to a remembered object. */
export function landmarkBuilding(house: PalaceHouse, kind: LandmarkKind, base: number, variant: number): CityPart[] {
  const parts: CityPart[] = [];
  const w = house.width, d = house.depth;
  const cream = 0xeee4cf, stone = 0xb9b5a8, timber = 0x634537, brass = 0xbe9757;
  const roof = [0x8e4939, 0x495666, 0x426c65, 0x665268][Math.floor(variant / 9) % 4];
  const add = (shape: CityPart["shape"], x: number, y: number, z: number, width: number, height: number, depth: number, color: number, extra: Partial<CityPart> = {}) => {
    parts.push({shape, x, y, z, width, height, depth, color, ...extra});
  };
  const box = (x: number, y: number, z: number, width: number, height: number, depth: number, color = cream, extra: Partial<CityPart> = {}) => add("box", x, y, z, width, height, depth, color, extra);
  const window = (x: number, y: number, z: number, rotation = 0, shutters = false) => {
    const place = (offset: number) => ({x:x + Math.cos(rotation) * offset, z:z - Math.sin(rotation) * offset});
    const frame = place(0);
    box(frame.x,y,frame.z,1.75,2.15,.16,cream,{rotation});
    // A slight offset in front of the frame prevents coplanar surfaces.
    box(x + Math.sin(rotation)*.1,y,z + Math.cos(rotation)*.1,1.43,1.82,.08,0x659ea7,{glass:true,rotation});
    box(x + Math.sin(rotation)*.16,y,z + Math.cos(rotation)*.16,.075,1.88,.05,cream,{rotation});
    box(x + Math.sin(rotation)*.16,y,z + Math.cos(rotation)*.16,1.5,.075,.05,cream,{rotation});
    if(shutters) for(const side of [-1,1]) {
      const p=place(side*1.16);
      box(p.x,y,p.z,.48,2.05,.13,roof,{rotation});
      for(let slat=0;slat<7;slat++) box(p.x+Math.sin(rotation)*.08,y-.78+slat*.26,p.z+Math.cos(rotation)*.08,.42,.05,.035,timber,{rotation});
    }
  };
  const gable = (y: number, width: number, depth: number, rise: number) => {
    add("gable",0,y+rise/2,0,width,rise,depth,cream);
    const angle = Math.atan2(rise,width/2);
    for(const side of [-1,1]) {
      box(side*width/4,y+rise/2+.09,0,Math.hypot(width/2,rise)+.35,.17,depth+.75,roof,{tiltZ:-side*angle,surface:"stone"});
      // Evenly spaced seams follow the pitch rather than floating above it.
      for(let seam=0;seam<=8;seam++) box(side*width/4,y+rise/2+.19,(seam/8-.5)*(depth+.55),Math.hypot(width/2,rise)+.28,.035,.04,roof,{tiltZ:-side*angle});
    }
  };
  // A full-height clear entrance shared by the city colliders (2.8 m wide).
  for(const side of [-1,1]) box(side*1.53,1.85,d/2+.18,.2,3.7,.35,kind==="cottage"?timber:brass);
  box(0,3.78,d/2+.18,3.25,.22,.35,kind==="cottage"?timber:brass);
  if(kind === "cottage") {
    for(const side of [-1,1]) {
      window(side*w*.31,2.75,d/2+.14,0,true);
      for(const z of [-.26,.26]) window(side*(w/2+.14),2.75,z*d,side*Math.PI/2,true);
      box(side*(w/2-.08),base/2,d/2+.17,.22,base,.2,timber,{surface:"wood"});
      box(side*1.8,1.9,d/2+.85,.16,3.8,.16,timber,{surface:"wood"});
    }
    box(0,base-.08,d/2+.2,w,.22,.25,timber,{surface:"wood"});
    gable(base,w+.3,d,3.15+(variant%3)*.25);
    box(-w*.28,base+2.5,-d*.22,1.0,3.5,1.1,0x997565,{surface:"stone"});
    box(-w*.28,base+4.32,-d*.22,1.25,.18,1.35,stone);
    box(0,3.98,d/2+.8,4.2,.18,1.7,roof,{tiltX:.12});
  } else if(kind === "houseboat") {
    // A recessed-looking marina basin, bounded by a stone quay. The stern
    // gangway is level with the room floor, so it works with walking on mobile.
    box(0,.045,-.5,w+3.6,.045,d+5,0x367c8b,{surface:"water"});
    for(const side of [-1,1]) {
      box(side*(w/2+1.85),.17,-.5,.25,.26,d+5.25,stone,{surface:"stone"});
      box(side*(w/2+.32),.5,-.15,.56,1.05,d+.8,0x23475d);
      box(side*(w/2+.33),1.03,-.15,.6,.12,d+.85,cream);
      for(const z of [-.32,.08,.37]) {
        // Round brass portholes on the cabin sides.
        add("cylinder",side*(w/2+.17),2.8,z*d,1.45,.16,1.45,brass,{tiltZ:Math.PI/2});
        add("cylinder",side*(w/2+.27),2.8,z*d,1.12,.07,1.12,0x4b91a7,{glass:true,tiltZ:Math.PI/2});
      }
      const px=side*w*.3;
      add("cylinder",px,2.8,d/2+.16,1.85,.14,1.85,brass,{tiltX:Math.PI/2});
      add("cylinder",px,2.8,d/2+.25,1.5,.08,1.5,0x619cab,{glass:true,tiltX:Math.PI/2});
      box(side*(w/4+.8),.55,d/2+.16,w/2-1.6,1.05,.18,0x23475d);
      box(side*(w/4+.8),1.12,d/2+.19,w/2-1.6,.12,.22,cream);
      for(const z of [-d/2+.4,d/2-.4]) {
        box(side*(w/2+1.25),.65,z,.16,1.3,.16,timber,{surface:"wood"});
        add("sphere",side*(w/2+.5),.8,z,.28,.55,.28,0x252a2b);
      }
      box(side*1.7,.9,d/2+1.1,.09,1.5,2.5,cream);
      box(side*1.7,1.68,d/2+1.1,.13,.1,2.5,timber);
    }
    // Tapered bow behind the cabin and a contrasting waterline make this read
    // as a moored vessel rather than a rectangular building painted blue.
    add("bow",0,.55,-d/2-.95,w+1.1,1.1,1.9,0x23475d);
    box(0,.17,-d/2-3.05,w+3.8,.26,.25,stone,{surface:"stone"});
    for(const side of [-1,1]) box(side*(w/4+1.35),.17,d/2+2.05,w/2-.65,.26,.25,stone,{surface:"stone"});
    box(0,.085,d/2+1.12,3.15,.1,2.5,timber,{surface:"wood"});
    for(let plank=0;plank<12;plank++) box(0,.143,d/2+.02+plank*.2,3.1,.016,.025,0xa88960);
    box(0,base,0,w+1.1,.28,d+1.1,cream);
    box(0,base+.22,0,w+.75,.16,d+.75,timber,{surface:"wood"});
    for(const side of [-1,1]) {
      box(side*(w/2+.32),base+1.42,0,.09,.09,d+.7,cream);
      box(0,base+1.42,side*(d/2+.32),w+.7,.09,.09,cream);
      for(let post=0;post<6;post++) {
        box(side*(w/2+.32),base+.85,(post/5-.5)*(d+.6),.075,1.15,.075,cream);
        box((post/5-.5)*(w+.6),base+.85,side*(d/2+.32),.075,1.15,.075,cream);
      }
    }
    // A mast and furled triangular sail distinguish the vessel from a cabin.
    add("cylinder",0,base+5,-d*.14,.18,10,.18,timber);
    add("sail",w*.22,base+5.3,-d*.14,w*.43,7.5,.07,0xf0e6cc);
    box(w*.22,base+1.5,-d*.14,w*.45,.12,.12,timber);
    box(-w*.25,base+1.4,-d*.2,.45,2.4,.45,cream);
    box(-w*.25,base+2.7,-d*.2,.7,.3,.7,0x35424b);
    add("cylinder",w*.27,3.3,d/2+.33,1.2,.18,1.2,0xcc653f,{tiltX:Math.PI/2});
    add("cylinder",w*.27,3.3,d/2+.45,.7,.05,.7,cream,{tiltX:Math.PI/2});
  } else if(kind === "clocktower") {
    for(const side of [-1,1]) {
      window(side*w*.3,2.7,d/2+.13);
      box(side*(w/2-.12),base/2,d/2+.18,.5,base,.45,stone,{surface:"stone"});
    }
    box(0,base,0,w+.4,.3,d+.4,stone);
    const tw=Math.min(w,d)*.59;
    box(0,base+6,0,tw,12,tw,0xbba88b,{surface:"stone"});
    for(let level=0;level<3;level++) box(0,base+level*4,0,tw+.45,.25,tw+.45,cream);
    const clockY=base+10;
    for(let side=0;side<4;side++) {
      const a=side*Math.PI/2, sx=Math.sin(a), sz=Math.cos(a);
      add("cylinder",sx*(tw/2+.1),clockY,sz*(tw/2+.1),3.3,.14,3.3,brass,{rotation:a,tiltX:Math.PI/2});
      add("cylinder",sx*(tw/2+.19),clockY,sz*(tw/2+.19),2.95,.06,2.95,cream,{rotation:a,tiltX:Math.PI/2});
      for(let tick=0;tick<12;tick++) {
        const t=tick*Math.PI/6, dx=Math.sin(t)*1.18;
        box(sx*(tw/2+.24)+Math.cos(a)*dx,clockY+Math.cos(t)*1.18,sz*(tw/2+.24)-Math.sin(a)*dx,.085,.22,.04,0x344249,{rotation:a,tiltZ:-t});
      }
      box(sx*(tw/2+.27),clockY+.4,sz*(tw/2+.27),.09,.85,.05,0x344249,{rotation:a});
      box(sx*(tw/2+.29)+Math.cos(a)*.3,clockY+.06,sz*(tw/2+.29)-Math.sin(a)*.3,.66,.09,.05,0x344249,{rotation:a});
    }
    box(0,base+12,0,tw+.7,.26,tw+.7,cream);
    add("pyramid",0,base+14.13,0,tw+1,4,tw+1,roof);
    add("sphere",0,base+16.33,0,.35,.5,.35,brass);
  } else {
    for(const side of [-1,1]) {
      window(side*w*.3,2.7,d/2+.14);
      box(side*(w/2-.3),base/2,d/2+.2,.5,base,.5,stone);
    }
    box(0,base,0,w+.4,.3,d+.4,stone);
    const diameter=Math.min(w,d)*.93;
    add("cylinder",0,base+1.2,0,diameter,2.4,diameter,cream);
    add("dome",0,base+2.4,0,diameter,diameter/2,diameter,0x648e89);
    // Meridional slit housing and raised telescope are specific visual cues.
    box(0,base+diameter*.37+2.4,0,.5,.2,diameter*.64,brass,{tiltX:.18});
    add("cylinder",0,base+diameter*.48+2.3,0,.6,4.2,.6,0xd4d0bb,{tiltX:.85});
    add("cylinder",0,base+diameter*.48+3.66,1.58,.88,.22,.88,0x314d61,{tiltX:.85});
  }
  return parts;
}

/** Water stays behind a low quay. The central gangway remains clear. */
export function marinaBarriers(house: PalaceHouse) {
  const w=house.width,d=house.depth;
  return [
    {x:-(w/2+1.2),z:-.5,width:2.4,depth:d+5.4},
    {x:w/2+1.2,z:-.5,width:2.4,depth:d+5.4},
    {x:0,z:-d/2-1.6,width:w,depth:3.2},
    {x:-(w/4+.85),z:d/2+1.2,width:w/2-1.7,depth:2.4},
    {x:w/4+.85,z:d/2+1.2,width:w/2-1.7,depth:2.4},
  ];
}
