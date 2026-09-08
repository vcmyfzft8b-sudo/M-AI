import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPalaceLayout} from '../src/lib/palace/layout.ts';
import {chooseRelocation, relocationSpots, relocatedStation, parsePalaceLocations, practiceAnswerKnown} from '../src/lib/palace/relocation.ts';

for (const count of [1,3,60]) test(`all ${count} items can repeatedly move to separated pavement locations`, () => {
  for (let seed=0;seed<8;seed++) {
    const layout=buildPalaceLayout({seedSource:`retry-${seed}`, items:Array.from({length:count},(_,i)=>({id:`item-${i}`,kind:['card','quiz','test'][i%3],sectionId:null})), sections:[]});
    const spots=relocationSpots(layout);
    assert.ok(spots.length>count);
    for(let round=0;round<4;round++) for(let index=0;index<count;index++) {
      const old=layout.stations[index];
      const choice=chooseRelocation(old,layout.stations,spots,()=>((seed+round+index)%10)/10);
      assert.notEqual(choice,null);
      const moved=relocatedStation(old,spots[choice]);
      assert.ok(Math.hypot(moved.x-old.x,moved.z-old.z)>=18);
      assert.ok(layout.stations.every(other=>other.id===old.id||Math.hypot(other.x-moved.x,other.z-moved.z)>=6));
      assert.equal(moved.id,old.id);assert.equal(moved.kind,old.kind);
      layout.stations[index]=moved;
    }
  }
});

test('saved locations reject invalid, stale and out-of-range entries',()=>{
  const spots=[{x:1,z:2,houseIndex:0}];
  assert.deepEqual(parsePalaceLocations('{"a":0,"b":-1,"c":1,"d":"0","stale":0}',spots,['a','b','c','d']),{a:0});
  for(const input of [null,'broken','[]','null','12']) assert.deepEqual(parsePalaceLocations(input,spots,['a']),{});
});
test('zero points retries; positive partial credit counts; unavailable grades do neither',()=>{
  for(const score of [1,2,3,4,5]) assert.equal(practiceAnswerKnown({marked:true,score}),true);
  assert.equal(practiceAnswerKnown({marked:true,score:0}),false);
  for(const mark of [{marked:false,score:0},{marked:true},{marked:true,score:NaN}]) assert.equal(practiceAnswerKnown(mark),null);
});
