import * as THREE from 'three';

// Cockpit FPV de una bici de descenso: manillar ancho, frenos hidráulicos,
// horquilla dorada, rueda delantera y cables. Se construye una vez y vive
// colgado de la cámara, así que no recibe sombras ni culling.
export function createBikeCockpit() {
  const root = new THREE.Group();
  root.name = 'fpv-bike-cockpit';

  const materials = {
    frame: new THREE.MeshStandardMaterial({ color: 0x1c2422, roughness: 0.38, metalness: 0.55 }),
    frameAccent: new THREE.MeshStandardMaterial({ color: 0xc85a2b, roughness: 0.45, metalness: 0.2 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.55, metalness: 0.35 }),
    alloy: new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.28, metalness: 0.9 }),
    darkAlloy: new THREE.MeshStandardMaterial({ color: 0x3a4042, roughness: 0.4, metalness: 0.8 }),
    stanchion: new THREE.MeshStandardMaterial({ color: 0xb58a4a, roughness: 0.22, metalness: 0.95 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.92, metalness: 0.02 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.85, metalness: 0.05 }),
  };

  const add = (mesh) => {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    root.add(mesh);
    return mesh;
  };

  // Tubo entre dos puntos con radio inicial y final.
  function tube(start, end, radius, material, sides = 10, radiusEnd = radius) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const direction = new THREE.Vector3().subVectors(b, a);
    const geometry = new THREE.CylinderGeometry(radiusEnd, radius, direction.length(), sides, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return add(mesh);
  }

  // --- Manillar -------------------------------------------------------------
  const BAR_Y = -0.36;
  const BAR_Z = -0.62;
  const BAR_HALF = 0.42;
  const BAR_RADIUS = 0.0175;
  tube([-BAR_HALF, BAR_Y, BAR_Z], [BAR_HALF, BAR_Y, BAR_Z], BAR_RADIUS, materials.carbon, 12);
  // Curva hacia el piloto en los extremos.
  for (const side of [-1, 1]) {
    tube(
      [side * BAR_HALF, BAR_Y, BAR_Z],
      [side * (BAR_HALF + 0.05), BAR_Y - 0.012, BAR_Z + 0.11],
      BAR_RADIUS,
      materials.carbon,
      12,
      BAR_RADIUS * 0.92,
    );
    // Puño y tapa naranja.
    tube(
      [side * (BAR_HALF + 0.05), BAR_Y - 0.012, BAR_Z + 0.11],
      [side * (BAR_HALF + 0.052), BAR_Y - 0.014, BAR_Z + 0.215],
      0.0235,
      materials.grip,
      12,
      0.022,
    );
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0235, 0.026, 0.03, 12), materials.frameAccent);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(side * (BAR_HALF + 0.052), BAR_Y - 0.014, BAR_Z + 0.232);
    add(cap);
  }
  // Abrazadera central y potencia.
  const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.075, 14), materials.darkAlloy);
  clamp.rotation.z = Math.PI / 2;
  clamp.position.set(0, BAR_Y, BAR_Z);
  add(clamp);
  tube([0, BAR_Y - 0.01, BAR_Z], [0, BAR_Y - 0.035, BAR_Z + 0.09], 0.028, materials.alloy, 10, 0.024);
  tube([0, BAR_Y - 0.035, BAR_Z + 0.09], [0, BAR_Y - 0.075, BAR_Z + 0.14], 0.022, materials.alloy, 10, 0.019);

  // --- Frenos ---------------------------------------------------------------
  for (const side of [-1, 1]) {
    const pivot = [side * 0.2, BAR_Y + 0.005, BAR_Z + 0.01];
    // Maneta.
    tube(pivot, [side * 0.25, BAR_Y - 0.055, BAR_Z + 0.15], 0.009, materials.alloy, 8, 0.006);
    tube(
      [side * 0.25, BAR_Y - 0.055, BAR_Z + 0.15],
      [side * 0.235, BAR_Y - 0.075, BAR_Z + 0.2],
      0.006,
      materials.alloy,
      8,
      0.004,
    );
    // Cuerpo del depósito.
    const reservoir = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.032, 0.075), materials.carbon);
    reservoir.position.set(side * 0.195, BAR_Y + 0.028, BAR_Z + 0.02);
    reservoir.rotation.x = -0.18;
    add(reservoir);
    // Tapa naranja del depósito.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.006, 0.05), materials.frameAccent);
    cap.position.set(side * 0.195, BAR_Y + 0.046, BAR_Z + 0.02);
    cap.rotation.x = -0.18;
    add(cap);
    // Latiguillo que baja hacia la horquilla.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.2, BAR_Y - 0.02, BAR_Z + 0.02),
      new THREE.Vector3(side * 0.14, BAR_Y - 0.16, BAR_Z + 0.02),
      new THREE.Vector3(side * 0.09, BAR_Y - 0.26, BAR_Z - 0.06),
      new THREE.Vector3(side * 0.07, BAR_Y - 0.3, BAR_Z - 0.13),
    ]);
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.006, 6, false), materials.rubber));
  }

  // --- Dirección y horquilla ------------------------------------------------
  tube([0, BAR_Y - 0.075, BAR_Z + 0.14], [0, BAR_Y - 0.2, BAR_Z + 0.02], 0.034, materials.frame, 12, 0.03);
  const headset = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.05, 10), materials.frameAccent);
  headset.rotation.x = Math.PI / 2;
  headset.position.set(0, BAR_Y - 0.205, BAR_Z + 0.015);
  add(headset);

  const crownY = BAR_Y - 0.33;
  const crownZ = BAR_Z - 0.05;
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.085), materials.darkAlloy);
  crown.position.set(0, crownY, crownZ);
  add(crown);
  // Corona inferior y barras doradas.
  for (const side of [-1, 1]) {
    tube([side * 0.085, crownY - 0.02, crownZ], [side * 0.095, crownY - 0.4, crownZ + 0.16], 0.024, materials.stanchion, 12, 0.023);
    tube([side * 0.095, crownY - 0.37, crownZ + 0.15], [side * 0.1, crownY - 0.52, crownZ + 0.28], 0.031, materials.carbon, 12, 0.029);
  }
  const lowerCrown = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.07), materials.darkAlloy);
  lowerCrown.position.set(0, crownY - 0.37, crownZ + 0.15);
  lowerCrown.rotation.x = 0.16;
  add(lowerCrown);

  // --- Rueda delantera ------------------------------------------------------
  const wheelRadius = 0.37;
  const wheel = new THREE.Group();
  wheel.name = 'front-wheel';
  const tire = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.072, 10, 34), materials.rubber);
  wheel.add(tire);
  // Tacos del neumático.
  const lugGeometry = new THREE.BoxGeometry(0.055, 0.028, 0.075);
  const lugCount = 26;
  const lugs = new THREE.InstancedMesh(lugGeometry, materials.rubber, lugCount);
  const lugDummy = new THREE.Object3D();
  for (let i = 0; i < lugCount; i++) {
    const angle = (i / lugCount) * Math.PI * 2;
    lugDummy.position.set(Math.cos(angle) * (wheelRadius + 0.07), Math.sin(angle) * (wheelRadius + 0.07), 0);
    lugDummy.rotation.set(0, 0, angle);
    lugDummy.updateMatrix();
    lugs.setMatrixAt(i, lugDummy.matrix);
  }
  lugs.instanceMatrix.needsUpdate = true;
  wheel.add(lugs);
  // Llanta y radios.
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius - 0.062, 0.018, 6, 30), materials.darkAlloy);
  wheel.add(rim);
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, wheelRadius - 0.08, 4), materials.alloy);
    spoke.position.set(Math.cos(angle) * (wheelRadius - 0.08) / 2, Math.sin(angle) * (wheelRadius - 0.08) / 2, 0);
    spoke.rotation.z = angle - Math.PI / 2;
    wheel.add(spoke);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.085, 12), materials.frameAccent);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  wheel.position.set(0, crownY - 0.62, crownZ + 0.34);
  wheel.rotation.y = Math.PI / 2;
  root.add(wheel);

  // --- Tubo superior del cuadro --------------------------------------------
  tube([0, BAR_Y - 0.24, BAR_Z + 0.03], [0, BAR_Y - 0.4, BAR_Z + 0.5], 0.031, materials.frame, 12, 0.026);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.012, 0.11), materials.frameAccent);
  badge.position.set(0, BAR_Y - 0.235, BAR_Z + 0.09);
  badge.rotation.x = -0.22;
  add(badge);

  root.traverse((object) => {
    if (object.isMesh) object.frustumCulled = false;
  });
  // Aleja el conjunto del punto de vista para que no invada la pantalla.
  root.position.z = -0.14;
  root.scale.setScalar(0.95);
  root.userData.wheel = wheel;
  return root;
}
