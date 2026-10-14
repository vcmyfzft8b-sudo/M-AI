import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {nextStop, stickInput, STICK_RADIUS, STICK_RUN_DISTANCE} from '../src/lib/palace/navigation.ts';
import '../src/lib/palace/atmosphere.ts';

test('the stick rests in the middle, walks inside the rim and runs past it', () => {
  assert.deepEqual(stickInput(2, -3), {forward: 0, right: 0, running: false, knobX: 0, knobY: 0});

  const walk = stickInput(0, -STICK_RADIUS / 2);
  assert.ok(Math.abs(walk.forward - 0.5) < 1e-9);
  assert.equal(walk.right, 0);
  assert.equal(walk.running, false);

  const rim = stickInput(STICK_RADIUS, 0);
  assert.equal(rim.right, 1);
  assert.equal(rim.running, false, 'the rim itself still walks');

  const run = stickInput(0, -(STICK_RUN_DISTANCE + 1));
  assert.equal(run.forward, 1);
  assert.equal(run.running, true);
  assert.ok(Math.abs(run.knobY + STICK_RADIUS) < 1e-9, 'the knob stops at the rim');
});

test('the next stop is the picked one if still waiting, otherwise the nearest', () => {
  const stations = [{id: 'near', x: 0, z: 10}, {id: 'far', x: 0, z: 50}, {id: 'done', x: 0, z: 2}];
  const here = {x: 0, z: 0, cameraYaw: 0};
  assert.equal(nextStop(here, stations, new Set(['done'])).station.id, 'near');
  assert.equal(nextStop(here, stations, new Set(['done']), 'far').station.id, 'far');
  assert.equal(nextStop(here, stations, new Set(['done', 'far']), 'far').station.id, 'near');
  assert.equal(nextStop(here, stations, new Set(['near', 'far', 'done'])), null);
});

test('the pointer turns with the camera: ahead is up, the walker\'s right is right', () => {
  const angle = (x, z, cameraYaw = 0) => nextStop({x: 0, z: 0, cameraYaw}, [{id: 'a', x, z}], new Set()).angle;
  /* Looking along +z, the walker's right hand is -x (see stepCharacter). */
  assert.ok(Math.abs(angle(0, 20)) < 1e-9);
  assert.ok(Math.abs(angle(-20, 0) - 90) < 1e-9);
  assert.ok(Math.abs(angle(20, 0) + 90) < 1e-9);
  assert.ok(Math.abs(Math.abs(angle(0, -20)) - 180) < 1e-9);
  /* Turned to face the stop, it is ahead again, whichever way round the yaw wrapped. */
  assert.ok(Math.abs(angle(20, 0, Math.PI / 2)) < 1e-9);
  assert.ok(Math.abs(angle(20, 0, Math.PI / 2 + Math.PI * 4)) < 1e-6);
});

test('shadows are filtered without screen-fixed noise', () => {
  /* A three upgrade that rewrites the chunk would quietly bring the crawling grain back. */
  assert.ok(!THREE.ShaderChunk.shadowmap_pars_fragment.includes('interleavedGradientNoise( gl_FragCoord.xy ) * PI2'));
  assert.ok(THREE.ShaderChunk.shadowmap_pars_fragment.includes('vogelDiskSample'));
});
