import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";
import { materials } from "./textures.js";

// ===== KONFIG ŚWIATA =====
const WORLD_HEIGHT = 100;        // wysokość w blokach
const WORLD_MAX = 1000;          // 1000x1000 bloków max
const HALF_WORLD = WORLD_MAX / 2;
const CHUNK_SIZE = 16;
const VIEW_DISTANCE = 3;         // promień chunków wczytywanych
const WATER_LEVEL = 52;          // poziom wody (płaska tafla)
const blockSize = 2;             // rozmiar bloku w jednostkach 3D

// ===== RENDERER, SCENA, KAMERA =====
const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 50, 350);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(0, 70 * (blockSize / 2), 80);
camera.lookAt(0, 60 * (blockSize / 2), 0);

// ===== ŚWIATŁO =====
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xffffff, 0.9);
sun.position.set(60, 200, 40);
sun.castShadow = false;
scene.add(sun);

// ===== STAN PAUZY / MENU =====
let paused = false;
const pauseMenuEl = document.getElementById("pauseMenu");
const resumeBtn = document.getElementById("resumeBtn");

function setPaused(value) {
  paused = value;
  pauseMenuEl.style.display = paused ? "flex" : "none";
  if (paused && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
}

resumeBtn.addEventListener("click", () => setPaused(false));

// ===== FPS & KOORDY =====
const fpsEl = document.getElementById("fps");
const coordsEl = document.getElementById("coords");
let fpsFrames = 0;
let fpsTime = 0;
let lastFpsUpdate = performance.now();

function updateCoords() {
  const bx = Math.round(camera.position.x / blockSize);
  const by = Math.round(camera.position.y / blockSize);
  const bz = Math.round(camera.position.z / blockSize);
  coordsEl.textContent = `XYZ: ${bx} / ${by} / ${bz}`;
}

// ===== HOTBAR (9 TYPÓW, BEZ BEDROCKU) =====
const blockTypes = [
  "grass",
  "dirt",
  "stone",
  "wood",
  "leaves",
  "sand",
  "water",
  "planks",
  "brick"
];
let currentBlockType = "grass";
const hotbarEl = document.getElementById("hotbar");

function renderHotbar() {
  hotbarEl.innerHTML = "";
  blockTypes.forEach((type, idx) => {
    const div = document.createElement("div");
    div.className = "slot" + (type === currentBlockType ? " active" : "");
    div.innerHTML = `
      <span class="slot-key">${idx + 1}</span>
      <span class="slot-name">${type}</span>
    `;
    hotbarEl.appendChild(div);
  });
}
renderHotbar();

// ===== DANE ŚWIATA: CHUNKI, BLOKI, MAPA ZAJĘTOŚCI =====
const worldMeshes = [];                         // instanced meshe do raycastu
const occupancy = new Map();                    // "bx,by,bz" -> { type, bx, by, bz, chunkKey }
const chunks = new Map();                       // "cx,cz" -> {cx,cz,blocks:[], renderMeshes: Map}
const blockGeometry = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
const dirtyChunks = new Set();
const tempObject = new THREE.Object3D();

function blockKey(bx, by, bz) {
  return `${bx},${by},${bz}`;
}

function getBlockAt(bx, by, bz) {
  return occupancy.get(blockKey(bx, by, bz)) || null;
}

function chunkKeyFromCoords(cx, cz) {
  return `${cx},${cz}`;
}

// ===== PIACH – FIZYKA =====
function settleSand(block) {
  if (!block) return;
  if (block.type !== "sand") return;

  let { bx, by, bz } = block;
  let targetY = by;

  while (targetY > 1) {
    const below = getBlockAt(bx, targetY - 1, bz);
    if (!below) {
      targetY--;
    } else if (below.type === "water") {
      // piasek wpada do wody – zamiana wody na piasek
      removeBlockData(below, { skipVisibilityUpdate: true });
      targetY--;
    } else {
      break;
    }
  }

  if (targetY !== by) {
    const oldKey = blockKey(bx, by, bz);
    occupancy.delete(oldKey);
    block.by = targetY;
    occupancy.set(blockKey(bx, targetY, bz), block);
    markChunksDirtyAround(bx, bz);
  }
}

function updateSandPhysicsAround(bx, by, bz) {
  const radius = 1;
  const maxDy = 10;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = 0; dy <= maxDy; dy++) {
        const mx = bx + dx;
        const my = by + dy;
        const mz = bz + dz;
        const block = getBlockAt(mx, my, mz);
        if (block && block.type === "sand") {
          settleSand(block);
        }
      }
    }
  }
}

function addBlockAt(bx, by, bz, type, chunkKey = null, worldGen = false) {
  if (by < 0 || by >= WORLD_HEIGHT) return null;
  if (Math.abs(bx) > HALF_WORLD || Math.abs(bz) > HALF_WORLD) return null;

  const key = blockKey(bx, by, bz);
  if (occupancy.has(key)) return null;

  const block = {
    type,
    bx,
    by,
    bz,
    chunkKey
  };

  occupancy.set(key, block);

  if (chunkKey && chunks.has(chunkKey)) {
    chunks.get(chunkKey).blocks.push(block);
  }

  if (!worldGen) {
    markChunksDirtyAround(bx, bz);
    if (type === "sand") {
      updateSandPhysicsAround(bx, by, bz);
    }
  }

  return block;
}

function removeBlockData(block, { skipVisibilityUpdate = false } = {}) {
  if (!block) return;
  if (block.type === "bedrock") return; // bedrock niezniszczalny

  const { bx, by, bz, chunkKey } = block;
  const key = blockKey(bx, by, bz);

  occupancy.delete(key);

  if (chunkKey && chunks.has(chunkKey)) {
    const arr = chunks.get(chunkKey).blocks;
    const i2 = arr.indexOf(block);
    if (i2 !== -1) arr.splice(i2, 1);
  }

  if (!skipVisibilityUpdate) {
    markChunksDirtyAround(bx, bz);
    updateSandPhysicsAround(bx, by, bz);
  }
}

function removeBlock(block) {
  if (!block) return;
  removeBlockData(block);
}

function isBlockExposed(block) {
  if (!block) return false;
  const { bx, by, bz, type } = block;
  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  for (const [dx, dy, dz] of neighbors) {
    const neighbor = getBlockAt(bx + dx, by + dy, bz + dz);
    if (!neighbor) return true;
    if (neighbor.type === "water" && type !== "water") return true;
    if (type === "water" && neighbor.type !== "water") return true;
  }
  return false;
}

function clearChunkMeshes(chunk) {
  if (!chunk || !chunk.renderMeshes) return;
  for (const mesh of chunk.renderMeshes.values()) {
    scene.remove(mesh);
    const idx = worldMeshes.indexOf(mesh);
    if (idx !== -1) worldMeshes.splice(idx, 1);
  }
  chunk.renderMeshes.clear();
}

function rebuildChunkRender(chunk) {
  if (!chunk) return;
  if (!chunk.renderMeshes) chunk.renderMeshes = new Map();

  clearChunkMeshes(chunk);

  const buckets = new Map();
  for (const block of chunk.blocks) {
    if (!block) continue;
    if (!isBlockExposed(block)) continue;
    if (!buckets.has(block.type)) buckets.set(block.type, []);
    buckets.get(block.type).push(block);
  }

  for (const [type, blocks] of buckets.entries()) {
    const mesh = new THREE.InstancedMesh(
      blockGeometry,
      materials[type],
      blocks.length
    );
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData = {
      chunkKey: chunkKeyFromCoords(chunk.cx, chunk.cz),
      type,
      instanceBlocks: blocks
    };

    blocks.forEach((block, index) => {
      tempObject.position.set(
        block.bx * blockSize,
        block.by * blockSize,
        block.bz * blockSize
      );
      tempObject.updateMatrix();
      mesh.setMatrixAt(index, tempObject.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    scene.add(mesh);
    worldMeshes.push(mesh);
    chunk.renderMeshes.set(type, mesh);
  }
}

function markChunksDirtyAround(bx, bz) {
  const cx = Math.floor(bx / CHUNK_SIZE);
  const cz = Math.floor(bz / CHUNK_SIZE);
  const localX = ((bx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  const localZ = ((bz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

  dirtyChunks.add(chunkKeyFromCoords(cx, cz));

  if (localX === 0) dirtyChunks.add(chunkKeyFromCoords(cx - 1, cz));
  if (localX === CHUNK_SIZE - 1) dirtyChunks.add(chunkKeyFromCoords(cx + 1, cz));
  if (localZ === 0) dirtyChunks.add(chunkKeyFromCoords(cx, cz - 1));
  if (localZ === CHUNK_SIZE - 1) dirtyChunks.add(chunkKeyFromCoords(cx, cz + 1));
}

function flushDirtyChunks() {
  if (dirtyChunks.size === 0) return;
  const toProcess = Array.from(dirtyChunks);
  dirtyChunks.clear();
  for (const key of toProcess) {
    const chunk = chunks.get(key);
    if (chunk) rebuildChunkRender(chunk);
  }
}

// ===== GENERATOR TERENU =====
function terrainHeight(bx, bz) {
  const s1 = 0.03;
  const s2 = 0.01;
  const s3 = 0.06;

  const n1 = Math.sin(bx * s1) * 8 + Math.cos(bz * s1 * 0.8) * 6;
  const n2 = Math.sin((bx + 100) * s2) * 12 + Math.cos((bz - 50) * s2) * 10;
  const n3 = Math.sin((bx - bz) * s3) * 4;

  let h = 50 + 0.5 * n1 + 0.3 * n2 + 0.2 * n3;
  if (h < 50) h = 50;
  if (h > WORLD_HEIGHT - 5) h = WORLD_HEIGHT - 5;
  return Math.floor(h);
}

function generateChunk(cx, cz) {
  const key = chunkKeyFromCoords(cx, cz);
  if (chunks.has(key)) return;

  const startBx = cx * CHUNK_SIZE;
  const startBz = cz * CHUNK_SIZE;

  if (Math.abs(startBx) > HALF_WORLD || Math.abs(startBz) > HALF_WORLD) {
    return;
  }

  const blocks = [];

  for (let bx = startBx; bx < startBx + CHUNK_SIZE; bx++) {
    if (Math.abs(bx) > HALF_WORLD) continue;
    for (let bz = startBz; bz < startBz + CHUNK_SIZE; bz++) {
      if (Math.abs(bz) > HALF_WORLD) continue;

      const surface = terrainHeight(bx, bz);

      // bedrock na dnie
      const bedrockBlock = addBlockAt(bx, 0, bz, "bedrock", key, true);
      if (bedrockBlock) blocks.push(bedrockBlock);

      if (surface <= WATER_LEVEL) {
        // dno zbiornika
        const bottomStart = Math.max(1, surface - 3);
        for (let y = bottomStart; y <= surface; y++) {
          let type = "stone";
          if (y >= surface - 1) type = "sand"; // plaża dna
          const block = addBlockAt(bx, y, bz, type, key, true);
          if (block) blocks.push(block);
        }
        // woda od powierzchni do WATER_LEVEL
        for (let y = surface + 1; y <= WATER_LEVEL; y++) {
          const block = addBlockAt(bx, y, bz, "water", key, true);
          if (block) blocks.push(block);
        }
      } else {
        // ląd nad poziomem wody
        const grassHeight = surface;
        const startSolid = Math.max(1, grassHeight - 3);

        for (let y = startSolid; y < grassHeight; y++) {
          let type = "stone";
          if (y >= grassHeight - 2) type = "dirt";
          const block = addBlockAt(bx, y, bz, type, key, true);
          if (block) blocks.push(block);
        }

        // blok powierzchni – trawa, piasek przy brzegach świata
        let topType = "grass";
        const distEdge = Math.max(Math.abs(bx), Math.abs(bz));
        if (distEdge > HALF_WORLD * 0.7) topType = "sand";
        const topBlock = addBlockAt(bx, grassHeight, bz, topType, key, true);
        if (topBlock) blocks.push(topBlock);

        // drzewa tylko na lądzie
        if (topType === "grass" && Math.random() > 0.985) {
          const treeHeight = 4 + Math.floor(Math.random() * 2);
          for (let y = 1; y <= treeHeight; y++) {
            const block = addBlockAt(
              bx,
              grassHeight + y,
              bz,
              "wood",
              key,
              true
            );
            if (block) blocks.push(block);
          }

          const topY = grassHeight + treeHeight + 1;
          for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
              for (let ly = -1; ly <= 1; ly++) {
                const dd =
                  Math.abs(lx) + Math.abs(lz) + Math.abs(ly);
                if (dd <= 3) {
                  const block = addBlockAt(
                    bx + lx,
                    topY + ly,
                    bz + lz,
                    "leaves",
                    key,
                    true
                  );
                  if (block) blocks.push(block);
                }
              }
            }
          }
        }
      }
    }
  }

  const chunk = { cx, cz, blocks };
  chunks.set(key, chunk);
  finalizeChunkVisibility(chunk);
}

function finalizeChunkVisibility(chunk) {
  if (!chunk) return;
  rebuildChunkRender(chunk);
}

function updateChunksAroundPlayer() {
  const playerBx = Math.floor(camera.position.x / blockSize);
  const playerBz = Math.floor(camera.position.z / blockSize);
  const pcx = Math.floor(playerBx / CHUNK_SIZE);
  const pcz = Math.floor(playerBz / CHUNK_SIZE);

  // wczytywanie chunków
  for (let cx = pcx - VIEW_DISTANCE; cx <= pcx + VIEW_DISTANCE; cx++) {
    for (let cz = pcz - VIEW_DISTANCE; cz <= pcz + VIEW_DISTANCE; cz++) {
      generateChunk(cx, cz);
    }
  }

  // usuwanie odległych chunków (żeby nie zabić FPS)
  const keysToRemove = [];
  for (const [key, chunk] of chunks.entries()) {
    const dx = chunk.cx - pcx;
    const dz = chunk.cz - pcz;
    if (Math.abs(dx) > VIEW_DISTANCE + 1 || Math.abs(dz) > VIEW_DISTANCE + 1) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    const chunk = chunks.get(key);
    if (!chunk) continue;
    for (const block of chunk.blocks) {
      if (!block) continue;
      const { bx, by, bz } = block;
      occupancy.delete(blockKey(bx, by, bz));
    }
    clearChunkMeshes(chunk);
    chunks.delete(key);
    markChunksDirtyAround(chunk.cx * CHUNK_SIZE, chunk.cz * CHUNK_SIZE);
    markChunksDirtyAround((chunk.cx + 1) * CHUNK_SIZE - 1, chunk.cz * CHUNK_SIZE);
    markChunksDirtyAround(chunk.cx * CHUNK_SIZE, (chunk.cz + 1) * CHUNK_SIZE - 1);
    markChunksDirtyAround((chunk.cx + 1) * CHUNK_SIZE - 1, (chunk.cz + 1) * CHUNK_SIZE - 1);
  }
}

// startowe chunki
updateChunksAroundPlayer();

let lastChunkX = null;
let lastChunkZ = null;
let lastChunkUpdate = 0;
const CHUNK_UPDATE_INTERVAL = 250;

// ===== STEROWANIE / FIZYKA GRACZA =====
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let moveUp = false;
let moveDown = false;

let rotY = 0;
let rotX = 0;

let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

let pointerLocked = false;

const PLAYER_HALF_WIDTH = 0.6 * blockSize;
const PLAYER_HALF_HEIGHT = 0.9 * blockSize;

function onKeyDown(e) {
  if (e.repeat) return;

  if (e.key === "Escape") {
    setPaused(!paused);
    return;
  }

  switch (e.key) {
    case "w":
    case "W":
      moveForward = true;
      break;
    case "s":
    case "S":
      moveBackward = true;
      break;
    case "a":
    case "A":
      moveLeft = true;
      break;
    case "d":
    case "D":
      moveRight = true;
      break;
    case " ":
      moveUp = true;
      break;
    case "Shift":
      moveDown = true;
      break;
    case "1": case "2": case "3": case "4":
    case "5": case "6": case "7": case "8": case "9": {
      const idx = parseInt(e.key, 10) - 1;
      if (blockTypes[idx]) {
        currentBlockType = blockTypes[idx];
        renderHotbar();
      }
      break;
    }
  }
}

function onKeyUp(e) {
  switch (e.key) {
    case "w":
    case "W":
      moveForward = false;
      break;
    case "s":
    case "S":
      moveBackward = false;
      break;
    case "a":
    case "A":
      moveLeft = false;
      break;
    case "d":
    case "D":
      moveRight = false;
      break;
    case " ":
      moveUp = false;
      break;
    case "Shift":
      moveDown = false;
      break;
  }
}

function onMouseDownDoc(e) {
  if (e.button === 1 && !pointerLocked) {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
}

function onMouseUpDoc(e) {
  if (e.button === 1) {
    isDragging = false;
  }
}

function onMouseMove(e) {
  const sensitivity = 0.003;

  if (pointerLocked && !paused) {
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    rotY -= dx * sensitivity;
    rotX -= dy * sensitivity;
  } else if (isDragging && !paused) {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    rotY -= dx * sensitivity;
    rotX -= dy * sensitivity;
  }

  const limit = Math.PI / 2 - 0.1;
  rotX = Math.max(-limit, Math.min(limit, rotX));
}

function onWheel(e) {
  e.preventDefault();
  const idx = blockTypes.indexOf(currentBlockType);
  if (e.deltaY > 0) {
    currentBlockType = blockTypes[(idx + 1) % blockTypes.length];
  } else {
    currentBlockType =
      blockTypes[(idx - 1 + blockTypes.length) % blockTypes.length];
  }
  renderHotbar();
}

document.addEventListener("pointerlockchange", () => {
  pointerLocked = document.pointerLockElement === canvas;
});

// ===== RAYCAST + PICK BLOCK =====
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

function pickBlockUnderCrosshair() {
  mouse.x = 0;
  mouse.y = 0;
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(worldMeshes);
  if (intersects.length === 0) return;
  const hit = intersects[0];
  const instanceId = hit.instanceId;
  const blocks = hit.object.userData?.instanceBlocks;
  const block = blocks && instanceId !== undefined ? blocks[instanceId] : null;
  const type = block?.type;
  if (!type) return;
  if (!blockTypes.includes(type)) return; // bez bedrocku itp.
  currentBlockType = type;
  renderHotbar();
}

function handleBlockClick(e) {
  if (paused) return;

  if (pointerLocked) {
    mouse.x = 0;
    mouse.y = 0;
  } else {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(worldMeshes);

  if (intersects.length === 0) return;
  const hit = intersects[0];
  const instanceId = hit.instanceId;
  const blocks = hit.object.userData?.instanceBlocks;
  const targetBlock = blocks && instanceId !== undefined ? blocks[instanceId] : null;
  if (!targetBlock) return;

  if (e.button === 0) {
    // niszczenie bloku (bez bedrocku)
    removeBlock(targetBlock);
  } else if (e.button === 2) {
    // stawianie bloku – nie pozwalamy klikać bedrocku
    if (targetBlock.type === "bedrock") return;

    const normal = hit.face?.normal;
    if (!normal) return;

    const bx = targetBlock.bx + Math.round(normal.x);
    const by = targetBlock.by + Math.round(normal.y);
    const bz = targetBlock.bz + Math.round(normal.z);

    if (by <= 0) return; // nie stawiamy w miejscu bedrocku ani poniżej

    const cx = Math.floor(bx / CHUNK_SIZE);
    const cz = Math.floor(bz / CHUNK_SIZE);
    const ck = chunkKeyFromCoords(cx, cz);
    if (!chunks.has(ck)) chunks.set(ck, { cx, cz, blocks: [] });

    addBlockAt(bx, by, bz, currentBlockType, ck, false);
  }
}

renderer.domElement.addEventListener("mousedown", (e) => {
  if (e.button === 1) {
    // środkowy – pick block gdy mamy pointer lock
    if (pointerLocked && !paused) {
      pickBlockUnderCrosshair();
    } else {
      onMouseDownDoc(e); // drag kamery bez pointer locka
    }
    return;
  }

  // LPM – pointer lock
  if (!pointerLocked && !paused && e.button === 0) {
    canvas.requestPointerLock();
    return;
  }

  if (paused) return;

  if (e.button === 0 || e.button === 2) {
    handleBlockClick(e);
  }
});

renderer.domElement.addEventListener("contextmenu", (e) =>
  e.preventDefault()
);

// ===== OBSŁUGA ZDARZEŃ GLOBALNYCH =====
document.addEventListener("keydown", onKeyDown);
document.addEventListener("keyup", onKeyUp);
document.addEventListener("mousedown", onMouseDownDoc);
document.addEventListener("mouseup", onMouseUpDoc);
document.addEventListener("mousemove", onMouseMove);
renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// ===== KOLIZJE Z BLOKAMI =====
function moveWithCollisions(deltaX, deltaY, deltaZ) {
  const newPos = camera.position.clone();

  function moveAxis(axis, delta) {
    if (delta === 0) return;

    newPos[axis] += delta;

    const halfX = PLAYER_HALF_WIDTH;
    const halfY = PLAYER_HALF_HEIGHT;
    const halfZ = PLAYER_HALF_WIDTH;

    const minX = newPos.x - halfX;
    const maxX = newPos.x + halfX;
    const minY = newPos.y - halfY;
    const maxY = newPos.y + halfY;
    const minZ = newPos.z - halfZ;
    const maxZ = newPos.z + halfZ;

    const startBx = Math.floor(minX / blockSize);
    const endBx = Math.floor(maxX / blockSize);
    const startBy = Math.floor(minY / blockSize);
    const endBy = Math.floor(maxY / blockSize);
    const startBz = Math.floor(minZ / blockSize);
    const endBz = Math.floor(maxZ / blockSize);

    for (let by = startBy; by <= endBy; by++) {
      if (by < 0 || by >= WORLD_HEIGHT) continue;
      for (let bx = startBx; bx <= endBx; bx++) {
        for (let bz = startBz; bz <= endBz; bz++) {
          const block = getBlockAt(bx, by, bz);
          if (!block) continue;

          const centerX = bx * blockSize;
          const centerY = by * blockSize;
          const centerZ = bz * blockSize;

          const bMinX = centerX - blockSize / 2;
          const bMaxX = centerX + blockSize / 2;
          const bMinY = centerY - blockSize / 2;
          const bMaxY = centerY + blockSize / 2;
          const bMinZ = centerZ - blockSize / 2;
          const bMaxZ = centerZ + blockSize / 2;

          const overlapX = Math.min(maxX, bMaxX) - Math.max(minX, bMinX);
          const overlapY = Math.min(maxY, bMaxY) - Math.max(minY, bMinY);
          const overlapZ = Math.min(maxZ, bMaxZ) - Math.max(minZ, bMinZ);

          if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
            if (axis === "x") {
              if (delta > 0) newPos.x = bMinX - PLAYER_HALF_WIDTH - 0.001;
              else newPos.x = bMaxX + PLAYER_HALF_WIDTH + 0.001;
            } else if (axis === "y") {
              if (delta > 0) newPos.y = bMinY - PLAYER_HALF_HEIGHT - 0.001;
              else newPos.y = bMaxY + PLAYER_HALF_HEIGHT + 0.001;
            } else if (axis === "z") {
              if (delta > 0) newPos.z = bMinZ - PLAYER_HALF_WIDTH - 0.001;
              else newPos.z = bMaxZ + PLAYER_HALF_WIDTH + 0.001;
            }
            return;
          }
        }
      }
    }
  }

  moveAxis("x", deltaX);
  moveAxis("z", deltaZ);
  moveAxis("y", deltaY);

  const maxCoord = HALF_WORLD * blockSize;
  newPos.x = Math.max(-maxCoord, Math.min(maxCoord, newPos.x));
  newPos.z = Math.max(-maxCoord, Math.min(maxCoord, newPos.z));
  newPos.y = Math.max(
    0.5 * blockSize,
    Math.min((WORLD_HEIGHT + 2) * blockSize, newPos.y)
  );

  camera.position.copy(newPos);
}

function isInWater() {
  const bx = Math.round(camera.position.x / blockSize);
  const bz = Math.round(camera.position.z / blockSize);
  const footY = Math.floor(
    (camera.position.y - PLAYER_HALF_HEIGHT) / blockSize
  );
  const block = getBlockAt(bx, footY, bz);
  return block && block.type === "water";
}

// ===== MAIN LOOP =====
let lastTime = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  const delta = (now - lastTime) / 1000;
  lastTime = now;

  if (!paused) {
    const baseSpeed = 14 * blockSize / 2;
    const speed = baseSpeed * (isInWater() ? 0.4 : 1) * delta;

    const forward = new THREE.Vector3(
      Math.sin(rotY),
      0,
      Math.cos(rotY)
    ).normalize();
    const right = new THREE.Vector3(
      Math.cos(rotY),
      0,
      -Math.sin(rotY)
    ).normalize();

    let moveX = 0, moveY = 0, moveZ = 0;
    if (moveForward) {
      moveX += -forward.x * speed;
      moveZ += -forward.z * speed;
    }
    if (moveBackward) {
      moveX += forward.x * speed;
      moveZ += forward.z * speed;
    }
    if (moveLeft) {
      moveX += -right.x * speed;
      moveZ += -right.z * speed;
    }
    if (moveRight) {
      moveX += right.x * speed;
      moveZ += right.z * speed;
    }
    if (moveUp) moveY += speed;
    if (moveDown) moveY -= speed;

    moveWithCollisions(moveX, moveY, moveZ);

    camera.rotation.order = "YXZ";
    camera.rotation.y = rotY;
    camera.rotation.x = rotX;

    const playerBx = Math.floor(camera.position.x / blockSize);
    const playerBz = Math.floor(camera.position.z / blockSize);
    const pcx = Math.floor(playerBx / CHUNK_SIZE);
    const pcz = Math.floor(playerBz / CHUNK_SIZE);
    if (
      pcx !== lastChunkX ||
      pcz !== lastChunkZ ||
      now - lastChunkUpdate > CHUNK_UPDATE_INTERVAL
    ) {
      updateChunksAroundPlayer();
      lastChunkX = pcx;
      lastChunkZ = pcz;
      lastChunkUpdate = now;
    }
  }

  flushDirtyChunks();

  // FPS
  fpsFrames++;
  fpsTime += delta;
  const nowMs = now;
  if (nowMs - lastFpsUpdate > 250) {
    const fps = fpsTime > 0 ? Math.round(fpsFrames / fpsTime) : 0;
    fpsEl.textContent = `FPS: ${fps}`;
    fpsFrames = 0;
    fpsTime = 0;
    lastFpsUpdate = nowMs;
  }

  updateCoords();
  renderer.render(scene, camera);
}

animate(performance.now());
