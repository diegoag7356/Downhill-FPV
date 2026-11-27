import * as THREE from 'three';
import { Input } from './input.js';
import { createBikeCockpit } from './bike.js';
import { Player, SPEED_REFERENCE } from './player.js';
import { createCamera, updateCamera, BASE_FOV } from './camera.js';
import { Debug } from './debug.js';
import { hashSeed, mulberry32, seedFromUrl, randomSeed, normalizeSeed } from './rng.js';
import { createFixedTrack, generateTrack } from './trackgen.js';
import { createTerrain } from './terrain.js';
import { createTrackMeshes } from './trackmesh.js';
import { calculateDifficulty, classifyDifficulty, tierLabel } from './difficulty.js';
import seedLadder from './seed-ladder.json';
import { loadRecords } from './records.js';
import { RaceSession, RACE_STATES } from './race.js';
import { createContactShadow, loadBikeModel } from './models.js';

const FIXED_DT = 1 / 120;
const MAX_STEPS = 16;
const MAX_DPR = 1.5;
// La vista apunta algo por debajo del horizonte para que se vea la bici sin
// perder la pista.
const CAMERA_TILT = -0.09;
// La cámara va montada en la bici: sigue su rumbo, su inclinación y la rotación
// del aire. Se aplica casi entera para que la vista gire con la bici.
const AIR_ROLL_FOLLOW = 0.8;
const AIR_PITCH_FOLLOW = 0.55;
const AIR_YAW_FOLLOW = 0.7;
const LEAN_FOLLOW = 0.35;

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x777777);
const camera = createCamera(window.innerWidth / window.innerHeight);
const cockpit = createBikeCockpit();
cockpit.visible = false;
// El pivote está en el centro de la bici, no en el ojo: así el roll y el pitch
// la giran sobre sí misma en vez de hacerla orbitar la cámara.
const cockpitPivot = new THREE.Group();
cockpitPivot.name = 'fpv-bike-pivot';
cockpitPivot.position.set(0, -0.72, -0.5);
camera.add(cockpitPivot);
cockpitPivot.add(cockpit);
cockpit.position.sub(cockpitPivot.position);
// La cámara debe formar parte del grafo para que sus hijos (la bici) se
// rendericen.
scene.add(camera);
const player = new Player();
const input = new Input(renderer.domElement);
const debug = new Debug(document.getElementById('hud'));
const hemisphere = new THREE.HemisphereLight(0xdfeaf2, 0x3c2f24, 1.05);
const sun = new THREE.DirectionalLight(0xfff1da, 1.1);
sun.position.set(120, 180, 60);
scene.add(hemisphere, sun);
const showcase = new THREE.Group();
showcase.name = 'showcase';
scene.add(showcase);
let showcaseBike = null;
let showcaseShadow = null;

const ui = {
  menu: document.getElementById('menu'),
  raceHud: document.getElementById('race-hud'),
  pause: document.getElementById('pause'),
  finish: document.getElementById('finish'),
  seed: document.getElementById('seed-input'),
  trackList: document.getElementById('track-list'),
  trackName: document.getElementById('track-name'),
  timer: document.getElementById('timer'),
  progress: document.getElementById('progress-fill'),
  checkpoint: document.getElementById('checkpoint'),
  best: document.getElementById('best-time'),
  finishTime: document.getElementById('finish-time'),
  finishBest: document.getElementById('finish-best'),
  resultMessage: document.getElementById('result-message'),
  copySeed: document.getElementById('copy-seed'),
  touchControls: document.getElementById('touch-controls'),
  speed: document.getElementById('speed-readout'),
  air: document.getElementById('air-state'),
};

let seed = normalizeSeed(seedFromUrl()) ?? 'v1:0';
let track = null;
let terrain = null;
let trackVisual = null;
let race = null;
let wireframe = false;
let debugCenterline = false;
let centerline = null;
let clockLast = performance.now();
let accumulator = 0;
let frameCount = 0;
let gameMode = 'menu';

function setSeedInUrl(next) {
  seed = normalizeSeed(next) ?? 'v1:0';
  const url = new URL(window.location.href);
  url.searchParams.set('seed', seed);
  window.history.replaceState(null, '', url);
  ui.seed.value = seed;
  debug.setSeed(seed);
}

function makeTrack(id) {
  if (trackVisual) {
    scene.remove(trackVisual.root);
    trackVisual.dispose();
    trackVisual = null;
  }
  if (centerline) {
    scene.remove(centerline);
    centerline.geometry.dispose();
    centerline.material.dispose();
    centerline = null;
  }
  track = id === 'fixed-greybox' ? createFixedTrack() : generateTrack(id);
  terrain = createTerrain(track);
  trackVisual = createTrackMeshes(track, { visual: true });
  scene.add(trackVisual.root);
  const palette = trackVisual.palette;
  scene.background.setHex(palette.sky);
  sun.color.setHex(palette.sun ?? 0xfff1da);
  scene.fog = new THREE.Fog(palette.fog, 70, 780);
  placeShowcase();
  race = new RaceSession(track, player, { storage: safeStorage() });
  seed = track.id;
  debug.setSeed(seed);
  const metrics = calculateDifficulty(track);
  ui.trackName.textContent = track.id === 'fixed-greybox' ? 'Circuito de práctica' : `${track.id} · ${tierLabel(classifyDifficulty(metrics.score))}`;
  ui.checkpoint.textContent = 'Salida';
  return metrics;
}

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

// Coloca el modelo de bici generado con Hunyuan3D en la salida del menú.
function placeShowcase() {
  if (!track) return;
  const start = track.sampleAt(8);
  if (showcaseBike) {
    showcaseBike.position.set(start.x, start.y, start.z);
    showcaseBike.rotation.y = start.yaw + Math.PI * 0.25;
  }
  if (showcaseShadow) {
    showcaseShadow.position.set(start.x, start.y + 0.03, start.z);
    showcaseShadow.rotation.set(-Math.PI / 2, 0, -start.yaw);
  }
}

async function loadShowcase() {
  try {
    const bike = await loadBikeModel();
    if (!bike) return;
    showcaseBike = bike;
    showcaseShadow = createContactShadow();
    showcase.add(showcaseBike, showcaseShadow);
    placeShowcase();
  } catch (error) {
    console.warn('No se pudo cargar bicicleta.glb', error);
  }
}

function startRace(nextSeed = seed) {
  try {
    const normalized = normalizeSeed(nextSeed) ?? 'v1:0';
    makeTrack(normalized);
    setSeedInUrl(normalized);
    race.start();
    gameMode = 'racing';
    ui.menu.hidden = true;
    ui.pause.hidden = true;
    ui.finish.hidden = true;
    ui.raceHud.hidden = false;
    ui.touchControls.hidden = false;
    if (showcaseBike) showcaseBike.visible = false;
    if (showcaseShadow) showcaseShadow.visible = false;
    cockpit.visible = true;
    renderer.domElement.focus();
  } catch (error) {
    showMessage(`No se pudo generar ${nextSeed}: ${error.message}`);
  }
}

function openMenu() {
  gameMode = 'menu';
  if (race?.state === RACE_STATES.RACING || race?.state === RACE_STATES.PAUSED) race.state = RACE_STATES.MENU;
  ui.menu.hidden = false;
  ui.raceHud.hidden = true;
  ui.pause.hidden = true;
  ui.finish.hidden = true;
  ui.touchControls.hidden = true;
  document.exitPointerLock?.();
  if (showcaseBike) showcaseBike.visible = true;
  if (showcaseShadow) showcaseShadow.visible = true;
  cockpit.visible = false;
  if (track) player.speed = 0;
}

function togglePause() {
  if (!race) return;
  if (race.state === RACE_STATES.RACING) {
    race.pause();
    gameMode = 'paused';
    ui.pause.hidden = false;
    ui.touchControls.hidden = true;
    document.exitPointerLock?.();
  } else if (race.state === RACE_STATES.PAUSED) {
    race.pause();
    gameMode = 'racing';
    ui.pause.hidden = true;
    ui.touchControls.hidden = false;
  }
}

function updateRaceHud() {
  if (!race) return;
  ui.timer.textContent = formatTime(race.elapsedMs);
  ui.progress.style.width = `${(race.progress * 100).toFixed(1)}%`;
  const next = race.checkpoints[race.checkpointIndex];
  ui.checkpoint.textContent = race.state === RACE_STATES.FINISHED ? 'Meta' : next ? `CP ${race.checkpointIndex + 1}/3` : 'Meta';
  if (race.state === RACE_STATES.FINISHED) {
    gameMode = 'finished';
    ui.raceHud.hidden = true;
    ui.finish.hidden = false;
    ui.touchControls.hidden = true;
    ui.finishTime.textContent = formatTime(race.elapsedMs);
    const records = loadRecords(safeStorage());
    const key = `record:${race.track.id}`;
    ui.finishBest.textContent = records[key] ? formatTime(records[key]) : '—';
    ui.resultMessage.textContent = race.bestMs ? 'Nuevo récord personal' : 'Vuelta completada';
  }
}

function showMessage(message) {
  ui.resultMessage.textContent = message;
  ui.finish.hidden = false;
  ui.raceHud.hidden = true;
  ui.touchControls.hidden = true;
  gameMode = 'finished';
}

function loadSeedList() {
  const records = loadRecords(safeStorage());
  const sorted = seedLadder.tracks.map((item) => {
    const route = generateTrack(item.id);
    const difficulty = calculateDifficulty(route);
    return { id: item.id, difficulty, tier: item.tier, record: records[`record:${item.id}`] ?? null };
  });
  ui.trackList.replaceChildren();
  for (const item of sorted) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'track-option';
    button.innerHTML = `<span>${tierLabel(item.tier)} <small>${item.id}</small></span><span>${item.record ? formatTime(item.record) : `${item.difficulty.score.toFixed(0)} pts`}</span>`;
    button.addEventListener('click', () => startRace(item.id));
    ui.trackList.append(button);
  }
}

function createCenterline() {
  if (centerline) {
    scene.remove(centerline);
    centerline.geometry.dispose();
    centerline.material.dispose();
  }
  const positions = [];
  for (const p of track.points) positions.push(p.x, p.y + 0.45, p.z);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  centerline = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x2c2c2c }));
  centerline.visible = debugCenterline;
  scene.add(centerline);
}

function updateControls(dt) {
  if (gameMode !== 'racing' || !track || race?.state !== RACE_STATES.RACING) return;
  player.update(dt, input, terrain);
  race.update(terrain);
  updateRaceHud();
}

function tick(dt) {
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    player.savePrev();
    updateControls(FIXED_DT);
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_STEPS) accumulator = 0;
  const alpha = Math.min(accumulator / FIXED_DT, 1);
  updateCamera(camera, {
    position: player.eyePosition(alpha),
    yaw: player.renderYaw(alpha) + player.airYaw * AIR_YAW_FOLLOW,
    pitch: player.renderPitch(alpha) + CAMERA_TILT + player.airPitch * AIR_PITCH_FOLLOW,
    roll: player.airRoll * AIR_ROLL_FOLLOW + player.lean * LEAN_FOLLOW,
  });
  const targetFov = BASE_FOV + Math.min(player.speed / SPEED_REFERENCE, 1) * 10;
  camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-dt * 8));
  camera.updateProjectionMatrix();
  // Inclinación por el giro en el suelo y rotación libre en el aire (roll Q/E,
  // pitch W/S, yaw A/D), todo alrededor del centro de la bici.
  cockpitPivot.rotation.set(player.airPitch, player.airYaw, player.lean + player.airRoll, 'YXZ');
  const wheel = cockpit.userData.wheel;
  if (wheel) wheel.rotation.z -= player.speed * dt * 2.6;
  renderer.render(scene, camera);
  ui.speed.textContent = `${Math.round(player.speed * 3.6)} KM/H`;
  ui.air.textContent = player.airborne ? 'AIRE' : '';
  if (showcaseBike && gameMode === 'menu') showcaseBike.rotation.y += dt * 0.55;
  debug.update(dt, renderer, player, { mode: gameMode, track, race });
}

function frame(now) {
  requestAnimationFrame(frame);
  frameCount++;
  let dt = (now - clockLast) / 1000;
  clockLast = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  tick(Math.min(dt, 0.25));
}

function formatTime(milliseconds) {
  const total = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(2).padStart(5, '0');
  return `${minutes}:${seconds}`;
}

function showDebugLine(on) {
  debugCenterline = on;
  if (!centerline && track) createCenterline();
  if (centerline) centerline.visible = on;
}

input.onKey = (code) => {
  if (code === 'KeyH') debug.toggle();
  else if (code === 'KeyF') {
    wireframe = !wireframe;
    if (trackVisual) trackVisual.root.traverse((object) => { if (object.isMesh) object.material.wireframe = wireframe; });
    debug.setWireframe(wireframe);
  } else if (code === 'KeyL') showDebugLine(!debugCenterline);
  else if (code === 'Escape') {
    if (race?.state === RACE_STATES.RACING || race?.state === RACE_STATES.PAUSED) togglePause();
    else openMenu();
  } else if (code === 'KeyR' && gameMode === 'racing') {
    race.reset();
  } else if (code === 'KeyN' && gameMode === 'menu') {
    const next = randomSeed();
    setSeedInUrl(next);
    ui.seed.value = next;
  }
};

ui.seed.value = seed;
ui.trackName.textContent = 'Pista generada';
input.bindTouchControls(ui.touchControls);
ui.copySeed.addEventListener('click', async () => {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set('seed', normalizeSeed(ui.seed.value) ?? 'v1:0');
  try {
    await navigator.clipboard?.writeText(shareUrl.href);
    ui.copySeed.textContent = 'Enlace copiado';
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = shareUrl.href;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand('copy');
    temporary.remove();
    ui.copySeed.textContent = copied ? 'Enlace copiado' : 'No se pudo copiar';
  }
});
ui.menu.addEventListener('click', (event) => {
  if (event.target.id === 'start-seed') startRace(ui.seed.value);
  if (event.target.id === 'random-seed') {
    setSeedInUrl(randomSeed());
    ui.seed.focus();
  }
  if (event.target.id === 'start-fixed') startRace('fixed-greybox');
});
ui.pause.addEventListener('click', (event) => {
  if (event.target.id === 'resume') togglePause();
  if (event.target.id === 'pause-restart') race?.reset();
  if (event.target.id === 'pause-menu') openMenu();
});
ui.finish.addEventListener('click', (event) => {
  if (event.target.id === 'again') startRace(seed);
  if (event.target.id === 'finish-menu') openMenu();
});

loadSeedList();
makeTrack(seed);
loadShowcase();
createCenterline();
ui.menu.hidden = false;
ui.raceHud.hidden = true;
updateCamera(camera, { position: player.eyePosition(0), yaw: player.yaw, pitch: CAMERA_TILT });
renderer.render(scene, camera);
debug.setSeed(seed);
debug.update(0, renderer, player, { mode: gameMode, track, race });
requestAnimationFrame(frame);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__game = {
  THREE, renderer, scene, camera, player, input, debug, cockpit, cockpitPivot,
  get seed() { return seed; },
  get track() { return track; },
  get race() { return race; },
  get mode() { return gameMode; },
  get frames() { return frameCount; },
  startRace, openMenu, togglePause, tick, hashSeed, mulberry32,
};
