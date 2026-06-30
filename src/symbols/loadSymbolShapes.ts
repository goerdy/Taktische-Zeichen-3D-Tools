import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { TagConfig } from "../geometry/tagConfig";
import { getSymbolAnchorY } from "../geometry/molleShape";
import { flatGeometriesToShapes, subtractShapes } from "../geometry/polygonBoolean";
import { resolveSymbolAssetPath } from "./assetPath";
import { inlineSvgTextAsPaths } from "./svgTextToPath";
import { cloneSymbolLayers, type SymbolLayer } from "./symbolLayer";

const cache = new Map<string, SymbolLayer[]>();

export async function loadSymbolLayers(path: string, config: TagConfig): Promise<SymbolLayer[]> {
  const cacheKey = `${path}:${config.width}:${config.height}:${config.symbolScale}:${config.minLineThickness}:${config.symbolYOffset}`;
  const cached = cache.get(cacheKey);
  if (cached) return cloneSymbolLayers(cached);

  const resolvedPath = resolveSymbolAssetPath(path);
  const response = await fetch(resolvedPath);
  if (!response.ok) {
    throw new Error(`Symbol konnte nicht geladen werden: ${resolvedPath}`);
  }

  const originalSvg = await response.text();
  const pathSvg = await inlineSvgTextAsPaths(originalSvg);
  const loader = new SVGLoader();
  const data = loader.parse(pathSvg);
  const pendingItems: PendingSymbolLayer[] = [];

  for (const svgPath of data.paths) {
    const style = svgPath.userData?.style ?? {};
    const fillColor = normalizePaint(style.fill);
    if (fillColor) {
      const shapes = SVGLoader.createShapes(svgPath);
      pendingItems.push({
        color: fillColor,
        shapes: restoreCompoundHoles(shapes),
        flatGeometries: [],
        strokeWidth: null,
      });
    }

    const strokeColor = normalizePaint(style.stroke);
    const strokeWidth = Number(style.strokeWidth ?? 0);
    if (strokeColor && strokeWidth > 0) {
      pendingItems.push({
        color: strokeColor,
        shapes: [],
        flatGeometries: [],
        strokeWidth,
        subPaths: svgPath.subPaths.map((subPath) => subPath.getPoints(24)),
      });
    }
  }

  const scale = computeSourceScale(pendingItems, config);
  const minStrokeWidthSvg = config.minLineThickness > 0 ? config.minLineThickness / scale : 0;
  const items = pendingItems.flatMap((item) => {
    if (item.subPaths) {
      const strokeGeometries: THREE.BufferGeometry[] = [];
      const effectiveWidth = Math.max(item.strokeWidth ?? 0, minStrokeWidthSvg);
      for (const points of item.subPaths) {
        const strokeGeometry = SVGLoader.pointsToStroke(
          points,
          {
            strokeWidth: effectiveWidth,
            strokeColor: item.color,
            strokeLineJoin: "miter",
            strokeLineCap: "butt",
            strokeMiterLimit: 4,
          },
          12,
          0.001,
        );
        if (strokeGeometry) strokeGeometries.push(strokeGeometry);
      }
      if (strokeGeometries.length > 0) {
        return [
          {
            color: item.color,
            shapes: [],
            flatGeometries: strokeGeometries,
          },
        ];
      }
      return [];
    }

    return [
      {
        color: item.color,
        shapes: item.shapes,
        flatGeometries: item.flatGeometries,
      },
    ];
  });

  const normalized = safeBuildLayers(items, config);
  cache.set(cacheKey, cloneSymbolLayers(normalized));
  return normalized;
}

type PendingSymbolLayer = {
  color: string;
  shapes: THREE.Shape[];
  flatGeometries: THREE.BufferGeometry[];
  strokeWidth: number | null;
  subPaths?: THREE.Vector2[][];
};

function computeSourceScale(items: PendingSymbolLayer[], config: TagConfig) {
  const points = [
    ...items.flatMap((layer) => layer.shapes.flatMap((shape) => shape.getPoints(24))),
    ...items.flatMap((layer) => layer.flatGeometries.flatMap((geometry) => geometryPoints([geometry]))),
    ...items.flatMap((layer) => layer.subPaths?.flatMap((subPath) => subPath) ?? []),
  ];
  if (points.length === 0) return 1;

  const box = new THREE.Box2().setFromPoints(points);
  const sourceWidth = Math.max(box.max.x - box.min.x, 0.0001);
  const sourceHeight = Math.max(box.max.y - box.min.y, 0.0001);
  const targetWidth = config.width * (config.symbolScale / 100);
  const targetHeight = config.height * (config.symbolScale / 100);
  return Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
}

function safeBuildLayers(items: SymbolLayer[], config: TagConfig): SymbolLayer[] {
  try {
    const normalized = groupLayers(
      applyStackCutouts(convertFlatGeometriesToShapes(normalizeLayers(items, config))),
    );
    if (normalized.length > 0) return normalized;
  } catch {
    // Fall through to the simple path.
  }

  return groupLayers(
    convertFlatGeometriesToShapes(
      normalizeLayers(
        items.map((item) => ({
          color: item.color,
          shapes: [...item.shapes],
          flatGeometries: [...item.flatGeometries],
        })),
        config,
      ),
    ),
  );
}

function normalizeLayers(layers: SymbolLayer[], config: TagConfig): SymbolLayer[] {
  const points = [
    ...layers.flatMap((layer) => layer.shapes.flatMap((shape) => shape.getPoints(24))),
    ...layers.flatMap((layer) => geometryPoints(layer.flatGeometries)),
  ];
  if (points.length === 0) return [];

  const box = new THREE.Box2().setFromPoints(points);
  const sourceWidth = box.max.x - box.min.x;
  const sourceHeight = box.max.y - box.min.y;
  const targetWidth = config.width * (config.symbolScale / 100);
  const targetHeight = config.height * (config.symbolScale / 100);
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const center = box.getCenter(new THREE.Vector2());
  const targetCenter = new THREE.Vector2(0, getSymbolAnchorY(config) + config.symbolYOffset);

  return layers.map((layer) => ({
    color: layer.color,
    shapes: layer.shapes.map((shape) =>
      transformShape(shape, (point) => {
        const x = (point.x - center.x) * scale + targetCenter.x;
        const y = -(point.y - center.y) * scale + targetCenter.y;
        return new THREE.Vector2(x, y);
      }),
    ),
    flatGeometries: layer.flatGeometries.map((geometry) =>
      transformFlatGeometry(geometry, (point) => {
        const x = (point.x - center.x) * scale + targetCenter.x;
        const y = -(point.y - center.y) * scale + targetCenter.y;
        return new THREE.Vector2(x, y);
      }),
    ),
  }));
}

function transformShape(
  shape: THREE.Shape,
  transform: (point: THREE.Vector2) => THREE.Vector2,
): THREE.Shape {
  const next = new THREE.Shape(transformPoints(shape.getPoints(48), transform));
  next.holes = shape.holes.map((hole) => new THREE.Path(transformPoints(hole.getPoints(48), transform)));
  return next;
}

function restoreCompoundHoles(shapes: THREE.Shape[]): THREE.Shape[] {
  const entries = shapes.map((shape) => {
    const points = shape.getPoints(64);
    return {
      shape,
      points,
      box: new THREE.Box2().setFromPoints(points),
      area: Math.abs(signedArea(points)),
      parent: -1,
    };
  });

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const center = entry.box.getCenter(new THREE.Vector2());
    let bestParent = -1;
    let bestArea = Number.POSITIVE_INFINITY;

    for (let candidateIndex = 0; candidateIndex < entries.length; candidateIndex += 1) {
      if (candidateIndex === index) continue;
      const candidate = entries[candidateIndex];
      if (candidate.area <= entry.area || candidate.area >= bestArea) continue;
      if (!candidate.box.containsPoint(center)) continue;
      if (!pointInPolygon(center, candidate.points)) continue;

      bestParent = candidateIndex;
      bestArea = candidate.area;
    }

    entry.parent = bestParent;
  }

  const result: THREE.Shape[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.parent >= 0) {
      entries[entry.parent].shape.holes.push(pointsToPath(entry.points));
    } else {
      result.push(entry.shape);
    }
  }

  return result;
}

function signedArea(points: THREE.Vector2[]) {
  let area = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    area += points[previous].x * points[index].y - points[index].x * points[previous].y;
  }
  return area / 2;
}

function transformPoints(
  points: THREE.Vector2[],
  transform: (point: THREE.Vector2) => THREE.Vector2,
) {
  return points.map((point) => transform(point));
}

function normalizePaint(paint: unknown) {
  if (typeof paint !== "string") return null;
  const value = paint.trim();
  if (!value || value === "none" || value === "transparent") return null;
  if (value.startsWith("#")) return normalizeHex(value);

  const color = new THREE.Color(value);
  return `#${color.getHexString().toUpperCase()}`;
}

function normalizeHex(value: string) {
  if (value.length === 4) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return value.slice(0, 7).toUpperCase();
}

function geometryPoints(geometries: THREE.BufferGeometry[]) {
  const points: THREE.Vector2[] = [];
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      points.push(new THREE.Vector2(position.getX(index), position.getY(index)));
    }
  }
  return points;
}

function transformFlatGeometry(
  geometry: THREE.BufferGeometry,
  transform: (point: THREE.Vector2) => THREE.Vector2,
) {
  const next = geometry.clone();
  const position = next.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) {
    const point = transform(new THREE.Vector2(position.getX(index), position.getY(index)));
    position.setXY(index, point.x, point.y);
  }
  position.needsUpdate = true;
  return next;
}

function pointInPolygon(point: THREE.Vector2, polygon: THREE.Vector2[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointsToPath(points: THREE.Vector2[]) {
  const path = new THREE.Path();
  if (points.length === 0) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    path.lineTo(points[index].x, points[index].y);
  }
  path.closePath();
  return path;
}

function applyStackCutouts(items: SymbolLayer[]): SymbolLayer[] {
  return items.map((item, index) => {
    const cutters = items
      .slice(index + 1)
      .flatMap((later) => later.shapes);
    if (item.shapes.length === 0 || cutters.length === 0) return item;

    return {
      ...item,
      shapes: subtractShapes(item.shapes, cutters),
    };
  });
}

function convertFlatGeometriesToShapes(items: SymbolLayer[]): SymbolLayer[] {
  return items.map((item) => ({
    color: item.color,
    shapes: [...item.shapes, ...flatGeometriesToShapes(item.flatGeometries)],
    flatGeometries: [],
  }));
}

function groupLayers(items: SymbolLayer[]): SymbolLayer[] {
  const layers = new Map<string, SymbolLayer>();

  for (const item of items) {
    const existing = layers.get(item.color);
    if (existing) {
      existing.shapes.push(...item.shapes);
      existing.flatGeometries.push(...item.flatGeometries);
    } else {
      layers.set(item.color, {
        color: item.color,
        shapes: [...item.shapes],
        flatGeometries: [...item.flatGeometries],
      });
    }
  }

  return Array.from(layers.values()).filter(
    (layer) => layer.shapes.length > 0 || layer.flatGeometries.length > 0,
  );
}
