// Cámara FPV: aplica posición de ojos, rumbo (yaw) y pitch. El roll es siempre 0.

import * as THREE from 'three';

export const BASE_FOV = 75;

export function createCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 4000);
  camera.rotation.order = 'YXZ';
  camera.rotation.z = 0;
  return camera;
}

/**
 * Sincroniza la cámara con el jugador.
 * rotation.z se fuerza a 0 en cada frame: la vista gira, nunca se inclina.
 */
export function updateCamera(camera, { position, yaw, pitch = 0 }) {
  const wrappedYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  camera.position.set(position.x, position.y, position.z);
  camera.rotation.set(pitch, wrappedYaw, 0, 'YXZ');
  camera.rotation.y = wrappedYaw;
  camera.rotation.z = 0;
  camera.updateMatrixWorld();
}
