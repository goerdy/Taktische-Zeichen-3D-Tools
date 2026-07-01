import * as THREE from "three";
import type { TagConfig } from "./tagConfig";

export function getSymbolAnchorY(config: TagConfig) {
  if (config.baseFormId === "schluesselanhaenger-klein") {
    return config.width / 2;
  }

  return config.height / 2;
}

export function createBaseShape(config: TagConfig): THREE.Shape {
  if (config.baseFormId === "schluesselanhaenger-klein") {
    return createSmallKeychainShape(config);
  }

  if (
    config.baseFormId === "c-profil-40" ||
    config.baseFormId === "c-profil-50" ||
    config.baseFormId === "magnet-neodyn-rueckseite"
  ) {
    return createRoundedRectangleShape(config.width, config.height, config.cornerRadius);
  }

  return createMolleTagShape(config);
}

function createSmallKeychainShape(config: TagConfig): THREE.Shape {
  const width = config.width;
  const half = width / 2;
  const radius = width / 2;
  const rectangleHeight = Math.max(radius, config.height - radius);
  const topY = rectangleHeight + radius;
  const holeRadius = 2.5;
  const holeCenterY = topY - 3 - holeRadius;
  const cornerRadius = Math.max(0, Math.min(config.cornerRadius, half, rectangleHeight / 2));
  const shape = new THREE.Shape();

  shape.moveTo(-half + cornerRadius, 0);
  shape.lineTo(half - cornerRadius, 0);
  if (cornerRadius > 0) {
    shape.quadraticCurveTo(half, 0, half, cornerRadius);
  }
  shape.lineTo(half, rectangleHeight);
  shape.absarc(0, rectangleHeight, radius, 0, Math.PI, false);
  shape.lineTo(-half, cornerRadius);
  if (cornerRadius > 0) {
    shape.quadraticCurveTo(-half, 0, -half + cornerRadius, 0);
  }
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, holeCenterY, holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  return shape;
}

export function createMolleTagShape(config: TagConfig): THREE.Shape {
  const half = config.width / 2;
  const inner = half - config.hookDepth;
  const notch = inner + config.hookStep;
  const h = config.height;

  const points = [
    [-half, 0],
    [half, 0],
    [half, 15],
    [notch, 15],
    [notch, 5],
    [inner, 5],
    [inner, 32],
    [notch, 32],
    [notch, 22],
    [half, 22],
    [half, h],
    [-half, h],
    [-half, 22],
    [-notch, 22],
    [-notch, 32],
    [-inner, 32],
    [-inner, 5],
    [-notch, 5],
    [-notch, 15],
    [-half, 15],
  ] as const;

  const shape = new THREE.Shape();
  roundedPolygon(shape, points, config.cornerRadius);
  return shape;
}

function createRoundedRectangleShape(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const halfW = width / 2;
  const effectiveRadius = Math.max(0, Math.min(radius, halfW, height / 2));

  if (effectiveRadius === 0) {
    shape.moveTo(-halfW, 0);
    shape.lineTo(halfW, 0);
    shape.lineTo(halfW, height);
    shape.lineTo(-halfW, height);
    shape.closePath();
    return shape;
  }

  shape.moveTo(-halfW + effectiveRadius, 0);
  shape.lineTo(halfW - effectiveRadius, 0);
  shape.quadraticCurveTo(halfW, 0, halfW, effectiveRadius);
  shape.lineTo(halfW, height - effectiveRadius);
  shape.quadraticCurveTo(halfW, height, halfW - effectiveRadius, height);
  shape.lineTo(-halfW + effectiveRadius, height);
  shape.quadraticCurveTo(-halfW, height, -halfW, height - effectiveRadius);
  shape.lineTo(-halfW, effectiveRadius);
  shape.quadraticCurveTo(-halfW, 0, -halfW + effectiveRadius, 0);
  shape.closePath();
  return shape;
}

export function createSymbolPlaceholderShape(config: TagConfig): THREE.Shape {
  const size = (Math.min(config.width, config.height) * config.symbolScale) / 100;
  const half = size / 2;
  const y = getSymbolAnchorY(config) + config.symbolYOffset;
  const x = 0;
  const shape = new THREE.Shape();

  shape.moveTo(x, y + half);
  shape.lineTo(x + half, y);
  shape.lineTo(x, y - half);
  shape.lineTo(x - half, y);
  shape.lineTo(x, y + half);

  return shape;
}

function roundedPolygon(
  shape: THREE.Shape,
  points: readonly (readonly [number, number])[],
  radius: number,
) {
  const count = points.length;
  const effectiveRadius = Math.max(0, radius);

  if (effectiveRadius === 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < count; index += 1) {
      shape.lineTo(points[index][0], points[index][1]);
    }
    shape.closePath();
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const prev = new THREE.Vector2(...points[(index - 1 + count) % count]);
    const current = new THREE.Vector2(...points[index]);
    const next = new THREE.Vector2(...points[(index + 1) % count]);

    const toPrev = prev.clone().sub(current).normalize();
    const toNext = next.clone().sub(current).normalize();
    const prevLength = prev.distanceTo(current);
    const nextLength = next.distanceTo(current);
    const cornerRadius = Math.min(effectiveRadius, prevLength / 2, nextLength / 2);
    const start = current.clone().add(toPrev.multiplyScalar(cornerRadius));
    const end = current.clone().add(toNext.multiplyScalar(cornerRadius));

    if (index === 0) {
      shape.moveTo(start.x, start.y);
    } else {
      shape.lineTo(start.x, start.y);
    }
    shape.quadraticCurveTo(current.x, current.y, end.x, end.y);
  }
  shape.closePath();
}
