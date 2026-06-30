import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { parse as parseFont, type Font } from "opentype.js";
import type { TagConfig } from "../geometry/tagConfig";
import { resolveSymbolAssetPath } from "./assetPath";
import { cloneSymbolLayers, type SymbolLayer } from "./symbolLayer";

const cache = new Map<string, SymbolLayer[]>();
const fontCache = new Map<string, Font>();
const fontSourcePath = "/symbols/THW_Personen/Gruppenführer_BrB.svg";

export async function loadLabelLayers(text: string, config: TagConfig): Promise<SymbolLayer[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const cacheKey = `${trimmed}:${config.width}:${config.height}`;
  const cached = cache.get(cacheKey);
  if (cached) return cloneSymbolLayers(cached);

  const font = await loadEmbeddedFont();
  const path = font.getPath(trimmed, 0, 0, 1000);
  const loader = new SVGLoader();
  const data = loader.parse(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="${path.toPathData(3)}" fill="#111111"/></svg>`,
  );

  const shapes = data.paths.flatMap((svgPath) => SVGLoader.createShapes(svgPath));
  if (shapes.length === 0) return [];

  const normalized = normalizeTextShapes(shapes, config);
  const layers = [
    {
      color: "#111111",
      shapes: normalized,
      flatGeometries: [],
    },
  ];
  cache.set(cacheKey, cloneSymbolLayers(layers));
  return layers;
}

async function loadEmbeddedFont() {
  const resolvedPath = resolveSymbolAssetPath(fontSourcePath);
  const response = await fetch(resolvedPath);
  if (!response.ok) {
    throw new Error(`Schrift konnte nicht geladen werden: ${resolvedPath}`);
  }

  const svgText = await response.text();
  const match = svgText.match(/data:application\/font-woff[^,]*,([^")]+)/);
  if (!match) {
    throw new Error("Eingebettete Schrift wurde nicht gefunden");
  }

  const base64 = match[1];
  const cached = fontCache.get(base64);
  if (cached) return cached;

  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const font = parseFont(buffer);
  fontCache.set(base64, font);
  return font;
}

function normalizeTextShapes(shapes: THREE.Shape[], config: TagConfig) {
  const points = shapes.flatMap((shape) => shape.getPoints(48));
  const box = new THREE.Box2().setFromPoints(points);
  const sourceWidth = Math.max(box.max.x - box.min.x, 0.0001);
  const sourceHeight = Math.max(box.max.y - box.min.y, 0.0001);
  const targetWidth = config.width * 0.78;
  const targetHeight = config.height * 0.11;
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const center = box.getCenter(new THREE.Vector2());
  const targetCenter = new THREE.Vector2(0, config.height * 0.14);

  return shapes.map((shape) =>
    transformShape(shape, (point) => {
      const x = (point.x - center.x) * scale + targetCenter.x;
      const y = -(point.y - center.y) * scale + targetCenter.y;
      return new THREE.Vector2(x, y);
    }),
  );
}

function transformShape(
  shape: THREE.Shape,
  transform: (point: THREE.Vector2) => THREE.Vector2,
): THREE.Shape {
  const next = new THREE.Shape(shape.getPoints(48).map(transform));
  next.holes = shape.holes.map((hole) => new THREE.Path(hole.getPoints(48).map(transform)));
  return next;
}
