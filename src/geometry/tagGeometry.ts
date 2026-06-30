import * as THREE from "three";
import type { TagConfig } from "./tagConfig";
import { createBaseShape, createSymbolPlaceholderShape } from "./molleShape";
import type { SymbolLayer } from "../symbols/symbolLayer";
import { flatGeometriesToShapes, intersectShapes, subtractShapes, unionShapes } from "./polygonBoolean";

export type TagGeometries = {
  baseBottom: THREE.BufferGeometry;
  baseTop: THREE.BufferGeometry;
  inlays: Array<{
    color: string;
    geometry: THREE.BufferGeometry;
  }>;
};

const inlaySideOverlap = 0.015;
const inlayBottomOverlap = 0.06;

export function createTagGeometries(config: TagConfig, symbolLayers?: SymbolLayer[]): TagGeometries {
  const baseShape = createBaseShape(config);
  const hasBacksideInlays = config.baseFormId === "schluesselanhaenger-klein" && config.doubleSided;
  const fallbackLayer = {
    color: config.inlayColor,
    shapes: [createSymbolPlaceholderShape(config)],
    flatGeometries: [],
  };
  const layers = symbolLayers?.length ? symbolLayers : [fallbackLayer];
  const baseClipShapes = [createBaseShape(config)];
  const topLayerShapes = layers.map((layer) => intersectShapes(getLayerFootprintShapes(layer), baseClipShapes));
  const topInlayShapes = topLayerShapes.map((shapes) =>
    shapes.flatMap((shape) => intersectShapes([offsetShape(shape, inlaySideOverlap)], baseClipShapes)),
  );
  const backLayerShapes = hasBacksideInlays
    ? topInlayShapes.map((shapes) => shapes.map((shape) => mirrorShapeX(shape)))
    : [];
  const topPocketFootprintShapes = unionShapes(topInlayShapes.flat());
  const backPocketFootprintShapes = hasBacksideInlays ? unionShapes(backLayerShapes.flat()) : [];
  const bottomThickness = Math.max(0.1, config.baseThickness - config.inlayThickness);
  const bottomPocketCeilingZ = Math.min(config.inlayThickness, config.baseThickness - 0.1);

  const baseTopShapes = subtractShapes([createBaseShape(config)], topPocketFootprintShapes);
  const baseBottomShapes = hasBacksideInlays
    ? subtractShapes([createBaseShape(config)], backPocketFootprintShapes)
    : [baseShape];
  const baseBottom = hasBacksideInlays
    ? createDoubleSidedSteppedBaseGeometry(
        baseShape,
        baseBottomShapes,
        baseTopShapes,
        backPocketFootprintShapes,
        topPocketFootprintShapes,
        bottomPocketCeilingZ,
        bottomThickness,
        config.baseThickness,
      )
    : createSteppedBaseGeometry(
        baseShape,
        baseTopShapes,
        topPocketFootprintShapes,
        bottomThickness,
        config.baseThickness,
      );
  const baseTop = new THREE.BufferGeometry();

  const inlays = layers.map((layer, layerIndex) => {
    const bottomOverlap = Math.min(inlayBottomOverlap, Math.max(0, bottomThickness - 0.02));
    const inlayDepth = Math.max(0.05, config.inlayThickness + bottomOverlap);
    const geometries = [
      ...topInlayShapes[layerIndex].map((shape) =>
        createInlayGeometry(shape, bottomThickness - bottomOverlap, inlayDepth),
      ),
    ];

    if (hasBacksideInlays) {
      geometries.push(
        ...backLayerShapes[layerIndex].map((shape) => createInlayGeometry(shape, 0, inlayDepth)),
      );
    }

    const geometry = mergeGeometries(geometries);

    return {
      color: layer.color,
      geometry,
    };
  });

  return { baseBottom, baseTop, inlays };
}

function getLayerFootprintShapes(layer: SymbolLayer) {
  return [...layer.shapes, ...flatGeometriesToShapes(layer.flatGeometries)];
}

function offsetShape(shape: THREE.Shape, overlap: number): THREE.Shape {
  const allPoints = [
    ...shape.getPoints(64),
    ...shape.holes.flatMap((hole) => hole.getPoints(64)),
  ];
  if (allPoints.length === 0) return shape;

  const box = new THREE.Box2().setFromPoints(allPoints);
  const size = box.getSize(new THREE.Vector2());
  const center = box.getCenter(new THREE.Vector2());
  const scaleX = size.x > overlap * 4 ? Math.max(0.01, (size.x + overlap * 2) / size.x) : 1;
  const scaleY = size.y > overlap * 4 ? Math.max(0.01, (size.y + overlap * 2) / size.y) : 1;
  const transform = (point: THREE.Vector2) =>
    new THREE.Vector2(
      center.x + (point.x - center.x) * scaleX,
      center.y + (point.y - center.y) * scaleY,
    );

  const next = new THREE.Shape(shape.getPoints(64).map(transform));
  next.holes = shape.holes.map((hole) => new THREE.Path(hole.getPoints(64).map(transform)));
  return next;
}

function mirrorShapeX(shape: THREE.Shape): THREE.Shape {
  const mirror = (point: THREE.Vector2) => new THREE.Vector2(-point.x, point.y);
  const contour = dedupeClosingPoint(shape.getPoints(96)).map(mirror).reverse();
  const mirrored = new THREE.Shape(contour);
  mirrored.holes = shape.holes.map(
    (hole) => new THREE.Path(dedupeClosingPoint(hole.getPoints(96)).map(mirror).reverse()),
  );
  return mirrored;
}

function createInlayGeometry(shape: THREE.Shape, z: number, depth: number) {
  const geometry = extrude(shape, depth, false);
  geometry.translate(0, 0, z);
  return geometry;
}

function extrude(shape: THREE.Shape, depth: number, bevelEnabled: boolean) {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled,
    bevelSize: bevelEnabled ? 0.12 : 0,
    bevelThickness: bevelEnabled ? 0.12 : 0,
    bevelSegments: bevelEnabled ? 2 : 0,
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

function createDoubleSidedSteppedBaseGeometry(
  baseShape: THREE.Shape,
  bottomShapes: THREE.Shape[],
  topShapes: THREE.Shape[],
  bottomPocketShapes: THREE.Shape[],
  topPocketShapes: THREE.Shape[],
  bottomPocketCeilingZ: number,
  topPocketFloorZ: number,
  topZ: number,
) {
  const positions: number[] = [];
  const indices: number[] = [];

  for (const shape of bottomShapes) {
    addShapeFace(positions, indices, shape, 0, false);
  }
  for (const shape of topShapes) {
    addShapeFace(positions, indices, shape, topZ, true);
  }
  for (const shape of bottomPocketShapes) {
    addShapeFace(positions, indices, shape, bottomPocketCeilingZ, false);
  }
  for (const shape of topPocketShapes) {
    addShapeFace(positions, indices, shape, topPocketFloorZ, true);
  }

  addShapeWalls(positions, indices, baseShape, 0, topZ, false);
  for (const shape of bottomPocketShapes) {
    addShapeWalls(positions, indices, shape, 0, bottomPocketCeilingZ, true);
  }
  for (const shape of topPocketShapes) {
    addShapeWalls(positions, indices, shape, topPocketFloorZ, topZ, true);
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
  const result = points.map((point) => point.clone());
  while (
    result.length > 1 &&
    result[0].distanceToSquared(result[result.length - 1]) < 1e-10
  ) {
    result.pop();
  }
  return result;
}

function orientPoints(points: THREE.Vector2[], counterClockwise: boolean) {
  const isCounterClockwise = signedArea(points) > 0;
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
  if (geometries.length === 0) return merged;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const geometry of geometries) {
    const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = nonIndexed.getAttribute("position");
    const normal = nonIndexed.getAttribute("normal");

    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      indices.push(vertexOffset + index);
    }

    vertexOffset += position.count;
    if (nonIndexed !== geometry) nonIndexed.dispose();
    geometry.dispose();
  }

  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}
