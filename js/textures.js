import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

function createTexture(base, detail, pattern) {
  const size = 64;
  const canvasTex = document.createElement("canvas");
  canvasTex.width = canvasTex.height = size;
  const ctx = canvasTex.getContext("2d");

  if (pattern === "grass") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = detail;
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.fillRect(x, y, 2, 2);
    }
  } else if (pattern === "dirt") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = detail;
      const x = Math.random() * size;
      const y = Math.random() * size;
      const s = 3 + Math.random() * 2;
      ctx.fillRect(x, y, s, s);
    }
  } else if (pattern === "stone") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = detail;
      const x = Math.random() * size;
      const y = Math.random() * size;
      const s = 1 + Math.random() * 4;
      ctx.fillRect(x, y, s, s);
    }
  } else if (pattern === "sand") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = detail;
      const x = Math.random() * size;
      const y = Math.random() * size;
      ctx.fillRect(x, y, 1, 1);
    }
  } else if (pattern === "wood") {
    for (let y = 0; y < size; y++) {
      const t = y / size;
      const c = t < 0.5 ? base : detail;
      ctx.fillStyle = c;
      ctx.fillRect(0, y, size, 1);
      if (y % 8 === 0) {
        ctx.fillStyle = detail;
        ctx.fillRect(0, y, size, 1);
      }
    }
  } else if (pattern === "leaves") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = detail;
      const x = Math.random() * size;
      const y = Math.random() * size;
      const s = 3 + Math.random() * 3;
      ctx.fillRect(x, y, s, s);
    }
  } else if (pattern === "water") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = detail;
    ctx.lineWidth = 2;
    for (let y = 4; y < size; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < size; x += 8) {
        ctx.quadraticCurveTo(
          x + 4,
          y + (Math.random() * 4 - 2),
          x + 8,
          y
        );
      }
      ctx.stroke();
    }
  } else if (pattern === "planks") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = detail;
    ctx.lineWidth = 1;
    for (let x = 0; x <= size; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y <= size; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  } else if (pattern === "brick") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = detail;
    ctx.lineWidth = 2;
    const brickW = 16;
    const brickH = 8;
    for (let y = 0; y < size + brickH; y += brickH) {
      const offset = (y / brickH) % 2 === 0 ? 0 : brickW / 2;
      for (let x = -offset; x < size + brickW; x += brickW) {
        ctx.strokeRect(x, y, brickW, brickH);
      }
    }
  } else if (pattern === "bedrock") {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = detail;
      const x = Math.random() * size;
      const y = Math.random() * size;
      const w = 2 + Math.random() * 4;
      const h = 2 + Math.random() * 4;
      ctx.fillRect(x, y, w, h);
    }
  }

  const tex = new THREE.CanvasTexture(canvasTex);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

const textures = {
  grass: [
    createTexture("#2d5016", "#3a6b1f", "grass"),
    createTexture("#2d5016", "#3a6b1f", "grass"),
    createTexture("#7a5c3a", "#5f4428", "dirt"),
    createTexture("#2d5016", "#3a6b1f", "grass"),
    createTexture("#2d5016", "#3a6b1f", "grass"),
    createTexture("#2d5016", "#3a6b1f", "grass")
  ],
  dirt: Array(6).fill(createTexture("#7a5c3a", "#5f4428", "dirt")),
  stone: Array(6).fill(createTexture("#777777", "#5a5a5a", "stone")),
  sand: Array(6).fill(createTexture("#e8d8a0", "#d4c490", "sand")),
  wood: Array(6).fill(createTexture("#8b6f47", "#6c5434", "wood")),
  leaves: Array(6).fill(createTexture("#2f7a33", "#205821", "leaves")),
  water: Array(6).fill(createTexture("#1b4f72", "#5dade2", "water")),
  planks: Array(6).fill(createTexture("#c69c6d", "#8b6f47", "planks")),
  brick: Array(6).fill(createTexture("#b03a2e", "#641e16", "brick")),
  bedrock: Array(6).fill(createTexture("#555555", "#222222", "bedrock"))
};

const materials = {};
for (const key in textures) {
  materials[key] = textures[key].map(
    (t) => new THREE.MeshLambertMaterial({ map: t })
  );
}

export { materials };
