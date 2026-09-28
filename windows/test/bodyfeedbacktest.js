import assert from 'node:assert/strict';
import * as THREE from '../node_modules/three/build/three.module.js';
import './random.js';
import { Fly } from '../src/flymodel.js';

const fly = new Fly({ x: 17, y: -23 });
const parent = new THREE.Object3D();
parent.add(fly.node);
// All pose sources use the same scene graph contract, including transformed
// parents and the flight scale. Compare against public three.js conversions.
for (let tick = 0; tick < 360; tick++) {
  const dt = [1 / 120, 1 / 60, 1 / 240][tick % 3];
  parent.position.set(tick * .01, 12, -3);
  parent.rotation.set(.02, -.01, tick * .003);
  fly.node.position.z = tick % 3 === 0 ? 0 : 10;
  fly.node.rotation.z = tick * .02;
  fly.node.scale.setScalar(tick % 2 ? 1.15 : 1.8);
  fly.state = tick % 3 === 0 ? 'grooming' : 'flying';
  const before = fly.legFeedback.map(f => ({ ...f }));
  fly.model.legs.forEach((leg, i) => {
    leg.angle = Math.sin(tick * .03 + i) * .3;
    leg.lift = .5 + .2 * Math.cos(tick * .07 + i);
    leg.kneeAngle = .8 + .2 * Math.sin(tick * .04 - i);
    leg.apply();
  });
  fly.sampleLegFeedback(dt);
  for (let i = 0; i < 6; i++) {
    const leg = fly.model.legs[i], actual = fly.legFeedback[i];
    const reference = fly.node.worldToLocal(leg.ankle.localToWorld(new THREE.Vector3(leg.geometry.tarsus, 0, 0)));
    assert.equal(actual.footX, reference.x);
    assert.equal(actual.footY, reference.y);
    assert.equal(actual.footHeight, reference.z + fly.node.position.z);
    assert.equal(actual.hipVelocity, (leg.angle - before[i].hipAngle) / dt);
    assert.equal(actual.kneeVelocity, (leg.kneeAngle - before[i].kneeAngle) / dt);
    assert.equal(actual.contact, fly.state !== 'flying' && actual.footHeight <= .015);
    assert.ok(Object.values(actual).every(v => typeof v === 'boolean' || Number.isFinite(v)));
  }
}
const saved = structuredClone(fly.legFeedback);
const other = new Fly({ x: 1, y: 2 });
other.sampleLegFeedback(1 / 120);
assert.deepEqual(fly.legFeedback, saved, 'shared scratch objects cannot mutate another fly');
console.log('bodyfeedbacktest: PASS — 2,160 exact foot transforms, joint rates, contact and independent snapshots');
