import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { parse as parseFont, type Font } from "opentype.js";
import type { AtemschutzConfig } from "./atemschutzConfig";
import { resolveSymbolAssetPath } from "../symbols/assetPath";
import { subtractShapes, unionShapes } from "../geometry/polygonBoolean";

export type AtemschutzInlay = {
  name: string;
  color: string;
  geometry: THREE.BufferGeometry;
};

export type AtemschutzGeometries = {
  baseBottom: THREE.BufferGeometry;
  baseTop: THREE.BufferGeometry;
  inlays: AtemschutzInlay[];
};

type TextBox = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  rotateAlongY: boolean;
};

type PreparedText = {
  shapes: THREE.Shape[];
  sourceSize: THREE.Vector2;
  sourceCenter: THREE.Vector2;
};

type InlayShape = {
  name: string;
  color: string;
  shapes: THREE.Shape[];
};

const fontSourcePath = "/symbols/THW_Personen/Gruppenführer_BrB.svg";
const inlaySideOverlap = 0.015;
const inlayBottomOverlap = 0.06;
let fontPromise: Promise<Font> | null = null;

export async function createAtemschutzGeometries(config: AtemschutzConfig): Promise<AtemschutzGeometries> {
  const font = await loadEmbeddedFont();
  const baseShape = createBaseShape(config);
  const inlayShapes = createTextInlayShapes(config, font);
  const pocketShapes = unionShapes(
    inlayShapes.flatMap((entry) => entry.shapes.map((shape) => offsetShape(shape, inlaySideOverlap))),
  );
  const pocketFloorZ = Math.max(0.1, config.thickness - config.textThickness);
  const baseBottom = pocketShapes.length
    ? createSteppedBaseGeometry(baseShape, subtractShapes([baseShape], pocketShapes), pocketShapes, pocketFloorZ, config.thickness)
    : extrude(baseShape, config.thickness);
  const baseTop = new THREE.BufferGeometry();
  const bottomOverlap = Math.min(inlayBottomOverlap, Math.max(0, pocketFloorZ - 0.02));
  const inlayDepth = Math.max(0.05, config.textThickness + bottomOverlap);
  const inlays = inlayShapes.map((entry) => ({
    name: entry.name,
    color: entry.color,
    geometry: mergeGeometries(
      entry.shapes.map((shape) => createInlayGeometry(shape, pocketFloorZ - bottomOverlap, inlayDepth)),
    ),
  }));

  return { baseBottom, baseTop, inlays };
}

function createBaseShape(config: AtemschutzConfig) {
  const halfWidth = config.width / 2;
  const bottomRadius = Math.max(0, Math.min(config.cornerRadius, halfWidth, config.height / 2));
  const topRadius = halfWidth;
  const holeRadius = config.holeDiameter / 2;
  const holeY = config.height - config.holeOffsetFromTop;
  const shape = new THREE.Shape();

  shape.moveTo(-halfWidth + bottomRadius, 0);
  shape.lineTo(halfWidth - bottomRadius, 0);
  shape.quadraticCurveTo(halfWidth, 0, halfWidth, bottomRadius);
  shape.lineTo(halfWidth, config.height - topRadius);
  shape.absarc(0, config.height - topRadius, topRadius, 0, Math.PI, false);
  shape.lineTo(-halfWidth, bottomRadius);
  shape.quadraticCurveTo(-halfWidth, 0, -halfWidth + bottomRadius, 0);
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, holeY, holeRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  return shape;
}

function createTextInlayShapes(config: AtemschutzConfig, font: Font): InlayShape[] {
  const inlays: InlayShape[] = [];
  const mainLines = [
    { name: "Haupttext 1", text: config.mainTextLine1, color: config.mainTextLine1Color },
    { name: "Haupttext 2", text: config.mainTextLine2, color: config.mainTextLine2Color },
  ].filter((line) => line.text.trim());
  const mainArea = {
    xMin: -config.width / 2 + 2.2,
    xMax: config.width / 2 - 2.2,
    yMin: 28,
    yMax: config.height - config.holeOffsetFromTop - config.holeDiameter / 2 - 6,
  };
  const mainTextLayouts = mainLines.flatMap((line, index) => {
    const stripWidth = (mainArea.xMax - mainArea.xMin) / mainLines.length;
    const xMin = mainLines.length === 1 ? mainArea.xMin : mainArea.xMin + stripWidth * index;
    const xMax = mainLines.length === 1 ? mainArea.xMax : xMin + stripWidth;
    const prepared = prepareTextShapes(font, line.text);
    if (!prepared) return [];

    return [
      {
        line,
        box: {
          xMin,
          xMax,
          yMin: mainArea.yMin,
          yMax: mainArea.yMax,
          rotateAlongY: true,
        },
        prepared,
      },
    ];
  });

  if (mainTextLayouts.length > 0) {
    const mainScale = getSharedTextScale(mainTextLayouts);
    for (const { line, box, prepared } of mainTextLayouts) {
      inlays.push({
        name: line.name,
        color: line.color,
        shapes: createFittedTextShapes(prepared, box, mainScale),
      });
    }
  }

  if (config.mainTextSeparator && mainLines.length === 2) {
    inlays.push({
      name: "Trennlinie Haupttext",
      color: config.mainTextLine1Color,
      shapes: [createMainTextSeparatorShape(mainArea)],
    });
  }

  const bottomLines = [
    { name: "Kurztext 1", text: config.bottomTextLine1, color: config.bottomTextLine1Color },
    { name: "Kurztext 2", text: config.bottomTextLine2, color: config.bottomTextLine2Color },
  ].filter((line) => line.text.trim());
  const bottomArea = {
    xMin: -config.width / 2 + 2,
    xMax: config.width / 2 - 2,
    yMin: 5,
    yMax: 24,
  };
  const bottomTextLayouts = bottomLines.flatMap((line, index) => {
    const rowHeight = (bottomArea.yMax - bottomArea.yMin) / bottomLines.length;
    const yMax = bottomLines.length === 1 ? bottomArea.yMax : bottomArea.yMax - rowHeight * index;
    const yMin = bottomLines.length === 1 ? bottomArea.yMin : yMax - rowHeight;
    const prepared = prepareTextShapes(font, line.text);
    if (!prepared) return [];

    return [
      {
        line,
        box: {
          xMin: bottomArea.xMin,
          xMax: bottomArea.xMax,
          yMin,
          yMax,
          rotateAlongY: false,
        },
        prepared,
      },
    ];
  });

  if (bottomTextLayouts.length > 0) {
    const bottomScale = getSharedTextScale(bottomTextLayouts);
    for (const { line, box, prepared } of bottomTextLayouts) {
      inlays.push({
        name: line.name,
        color: line.color,
        shapes: createFittedTextShapes(prepared, box, bottomScale),
      });
    }
  }

  return inlays;
}

function createMainTextSeparatorShape(area: { yMin: number; yMax: number }) {
  const lineWidth = 0.65;
  const halfLineWidth = lineWidth / 2;
  const shape = new THREE.Shape();

  shape.moveTo(-halfLineWidth, area.yMin);
  shape.lineTo(halfLineWidth, area.yMin);
  shape.lineTo(halfLineWidth, area.yMax);
  shape.lineTo(-halfLineWidth, area.yMax);
  shape.closePath();

  return shape;
}

function prepareTextShapes(font: Font, text: string): PreparedText | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const path = font.getPath(trimmed, 0, 0, 1000);
  const loader = new SVGLoader();
  const data = loader.parse(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="${path.toPathData(3)}" fill="#ffffff"/></svg>`,
  );
  const shapes = data.paths.flatMap((svgPath) => SVGLoader.createShapes(svgPath));
  if (shapes.length === 0) return null;

  const points = shapes.flatMap((shape) => shape.getPoints(64));
  const sourceBox = new THREE.Box2().setFromPoints(points);
  return {
    shapes,
    sourceSize: sourceBox.getSize(new THREE.Vector2()),
    sourceCenter: sourceBox.getCenter(new THREE.Vector2()),
  };
}

function getSharedTextScale(layouts: Array<{ box: TextBox; prepared: PreparedText }>) {
  return Math.min(...layouts.map(({ box, prepared }) => getFittedTextScale(prepared, box)));
}

function getFittedTextScale(prepared: PreparedText, box: TextBox) {
  const targetWidth = box.xMax - box.xMin;
  const targetHeight = box.yMax - box.yMin;
  const effectiveSourceWidth = box.rotateAlongY ? prepared.sourceSize.y : prepared.sourceSize.x;
  const effectiveSourceHeight = box.rotateAlongY ? prepared.sourceSize.x : prepared.sourceSize.y;
  return Math.min(
    (targetWidth * 0.94) / Math.max(effectiveSourceWidth, 0.0001),
    (targetHeight * 0.94) / Math.max(effectiveSourceHeight, 0.0001),
  );
}

function createFittedTextShapes(prepared: PreparedText, box: TextBox, scale: number) {
  const targetCenter = new THREE.Vector2((box.xMin + box.xMax) / 2, (box.yMin + box.yMax) / 2);

  return prepared.shapes.map((shape) =>
    transformShape(shape, (point) => {
      const x = (point.x - prepared.sourceCenter.x) * scale;
      const y = -(point.y - prepared.sourceCenter.y) * scale;
      if (box.rotateAlongY) {
        return new THREE.Vector2(targetCenter.x - y, targetCenter.y + x);
      }
      return new THREE.Vector2(targetCenter.x + x, targetCenter.y + y);
    }),
  );
}

function transformShape(shape: THREE.Shape, transform: (point: THREE.Vector2) => THREE.Vector2) {
  const next = new THREE.Shape(shape.getPoints(64).map(transform));
  next.holes = shape.holes.map((hole) => new THREE.Path(hole.getPoints(64).map(transform)));
  return next;
}

function offsetShape(shape: THREE.Shape, overlap: number): THREE.Shape {
  const allPoints = [...shape.getPoints(64), ...shape.holes.flatMap((hole) => hole.getPoints(64))];
  if (allPoints.length === 0) return shape;

  const box = new THREE.Box2().setFromPoints(allPoints);
  const size = box.getSize(new THREE.Vector2());
  const center = box.getCenter(new THREE.Vector2());
  const scaleX = size.x > overlap * 4 ? Math.max(0.01, (size.x + overlap * 2) / size.x) : 1;
  const scaleY = size.y > overlap * 4 ? Math.max(0.01, (size.y + overlap * 2) / size.y) : 1;
  return transformShape(shape, (point) =>
    new THREE.Vector2(
      center.x + (point.x - center.x) * scaleX,
      center.y + (point.y - center.y) * scaleY,
    ),
  );
}

function createInlayGeometry(shape: THREE.Shape, z: number, depth: number) {
  const geometry = extrude(shape, depth);
  geometry.translate(0, 0, z);
  return geometry;
}

function extrude(shape: THREE.Shape, depth: number) {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
  });
}

function createSteppedBaseGeometry(
  baseShape: THREE.Shape,
  topShapes: THREE.Shape[],
  pocketShapes: THREE.Shape[],
  pocketFloorZ: number,
  topZ: number,
) {
  const positions: number[] = [];
  const indices: number[] = [];

  addShapeFace(positions, indices, baseShape, 0, false);
  for (const shape of topShapes) {
    addShapeFace(positions, indices, shape, topZ, true);
  }
  for (const shape of pocketShapes) {
    addShapeFace(positions, indices, shape, pocketFloorZ, true);
  }

  addShapeWalls(positions, indices, baseShape, 0, topZ, false);
  for (const shape of pocketShapes) {
    addShapeWalls(positions, indices, shape, pocketFloorZ, topZ, true);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addShapeFace(
  positions: number[],
  indices: number[],
  shape: THREE.Shape,
  z: number,
  normalUp: boolean,
) {
  const contour = orientPoints(dedupeClosingPoint(shape.getPoints(96)), true);
  const holes = shape.holes.map((hole) => orientPoints(dedupeClosingPoint(hole.getPoints(96)), false));
  if (contour.length < 3) return;

  const offset = positions.length / 3;
  const allPoints = [...contour, ...holes.flat()];
  for (const point of allPoints) {
    positions.push(point.x, point.y, z);
  }

  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const triangle of triangles) {
    if (normalUp) {
      indices.push(offset + triangle[0], offset + triangle[1], offset + triangle[2]);
    } else {
      indices.push(offset + triangle[2], offset + triangle[1], offset + triangle[0]);
    }
  }
}

function addShapeWalls(
  positions: number[],
  indices: number[],
  shape: THREE.Shape,
  zMin: number,
  zMax: number,
  reverse: boolean,
) {
  addRingWall(positions, indices, orientPoints(dedupeClosingPoint(shape.getPoints(96)), true), zMin, zMax, reverse);
  for (const hole of shape.holes) {
    addRingWall(positions, indices, orientPoints(dedupeClosingPoint(hole.getPoints(96)), false), zMin, zMax, reverse);
  }
}

function addRingWall(
  positions: number[],
  indices: number[],
  ring: THREE.Vector2[],
  zMin: number,
  zMax: number,
  reverse: boolean,
) {
  if (ring.length < 2) return;

  for (let index = 0; index < ring.length; index += 1) {
    const nextIndex = (index + 1) % ring.length;
    const a = ring[index];
    const b = ring[nextIndex];
    if (a.distanceToSquared(b) < 1e-10) continue;

    const offset = positions.length / 3;
    positions.push(a.x, a.y, zMin, b.x, b.y, zMin, a.x, a.y, zMax, b.x, b.y, zMax);
    if (reverse) {
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
    } else {
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
    }
  }
}

function dedupeClosingPoint(points: THREE.Vector2[]) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.distanceToSquared(last) > 1e-10) return points;
  return points.slice(0, -1);
}

function orientPoints(points: THREE.Vector2[], counterClockwise: boolean) {
  if (points.length < 3) return points;
  const area = signedArea(points);
  const isCounterClockwise = area > 0;
  if (isCounterClockwise === counterClockwise) return points;
  return [...points].reverse();
}

function signedArea(points: THREE.Vector2[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function mergeGeometries(geometries: THREE.BufferGeometry[]) {
  const merged = new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const geometry of geometries) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute("position");

    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      indices.push(vertexOffset + index);
    }

    vertexOffset += position.count;
    if (source !== geometry) source.dispose();
    geometry.dispose();
  }

  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}

async function loadEmbeddedFont() {
  fontPromise ??= loadFont();
  return fontPromise;
}

async function loadFont() {
  const response = await fetch(resolveSymbolAssetPath(fontSourcePath));
  if (!response.ok) {
    throw new Error("Schrift konnte nicht geladen werden");
  }

  const svgText = await response.text();
  const match = svgText.match(/data:application\/font-woff[^,]*,([^")]+)/);
  if (!match) {
    throw new Error("Eingebettete Schrift wurde nicht gefunden");
  }

  const binary = atob(match[1]);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return parseFont(buffer);
}
