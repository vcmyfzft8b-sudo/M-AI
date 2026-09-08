import * as THREE from "three";

/** A square footprint, unlike an inscribed cone that leaves the tower's corners
 * poking through its eaves. Unit dimensions match the other instanced parts. */
export function pyramidRoofGeometry() {
  const corners = [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5]];
  const vertices: number[] = [];
  for(let side=0;side<4;side++) vertices.push(...corners[side],0,.5,0,...corners[(side+1)%4]);
  vertices.push(...corners[0],...corners[1],...corners[2],...corners[0],...corners[2],...corners[3]);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals();
  return geometry;
}
