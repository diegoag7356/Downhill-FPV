// Cámara FPV: aplica posición de ojos, rumbo (yaw), pitch y roll. La cámara va
// montada en la bici, así que acompaña su inclinación y su rotación.

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
 * El roll llega ya ponderado desde el juego: la cámara acompaña a la bici.
 */
export function updateCamera(camera, { position, yaw, pitch = 0, roll = 0 }) {
  const wrappedYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  camera.position.set(position.x, position.y, position.z);
  camera.rotation.set(pitch, wrappedYaw, roll, 'YXZ');
  camera.updateMatrixWorld();
}
