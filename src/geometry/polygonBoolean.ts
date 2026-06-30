import * as THREE from "three";
import polygonClipping from "polygon-clipping";

type Ring = Array<[number, number]>;
type Polygon = Ring[];
type MultiPolygon = Polygon[];

export function shapesToMultiPolygon(shapes: THREE.Shape[]): MultiPolygon {
  return shapes.flatMap((shape) => shapeToPolygons(shape));
}

export function multiPolygonToShapes(multiPolygon: MultiPolygon): THREE.Shape[] {
  const shapes: THREE.Shape[] = [];

  for (const polygon of multiPolygon) {
    const [outer, ...holes] = polygon;
    if (!outer || outer.length < 4) continue;

    const shape = new THREE.Shape(ringToPoints(outer));
    shape.holes = holes
      .filter((hole) => hole.length >= 4)
      .map((hole) => new THREE.Path(ringToPoints(hole)));
    shapes.push(shape);
  }

  return shapes;
}

export function subtractShapes(source: THREE.Shape[], cutters: THREE.Shape[]): THREE.Shape[] {
  const sourcePolygon = shapesToMultiPolygon(source);
  const cutterPolygon = shapesToMultiPolygon(cutters);
  if (sourcePolygon.length === 0 || cutterPolygon.length === 0) return source;

  const result = polygonClipping.difference(sourcePolygon, cutterPolygon) as MultiPolygon;
  return multiPolygonToShapes(result);
}

export function intersectShapes(source: THREE.Shape[], clipShapes: THREE.Shape[]): THREE.Shape[] {
  const sourcePolygon = shapesToMultiPolygon(source);
  const clipPolygon = shapesToMultiPolygon(clipShapes);
  if (sourcePolygon.length === 0 || clipPolygon.length === 0) return [];

  const result = polygonClipping.intersection(sourcePolygon, clipPolygon) as MultiPolygon;
  return multiPolygonToShapes(result);
}

export function unionShapes(shapes: THREE.Shape[]): THREE.Shape[] {
  const polygons = shapesToMultiPolygon(shapes);
  if (polygons.length === 0) return [];

  const result = (polygonClipping.union as (...polygons: MultiPolygon[]) => MultiPolygon)(
    ...polygons.map((polygon) => [polygon]),
  );
  return multiPolygonToShapes(result);
}

export function flatGeometriesToShapes(geometries: THREE.BufferGeometry[]): THREE.Shape[] {
  const trianglePolygons: MultiPolygon[] = [];

  for (const geometry of geometries) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = source.getAttribute("position");

    for (let index = 0; index < position.count; index += 3) {
      const ring = closeRing([
        [round(position.getX(index)), round(position.getY(index))],
        [round(position.getX(index + 1)), round(position.getY(index + 1))],
        [round(position.getX(index + 2)), round(position.getY(index + 2))],
      ]);
      if (ring.length >= 4) trianglePolygons.push([[orientRing(ring, true)]]);
    }

    if (source !== geometry) source.dispose();
  }

  if (trianglePolygons.length === 0) return [];
  const union = (polygonClipping.union as (...polygons: MultiPolygon[]) => MultiPolygon)(
    ...trianglePolygons,
  );
  return multiPolygonToShapes(union);
}

function shapeToPolygons(shape: THREE.Shape): MultiPolygon {
  const outer = orientRing(closeRing(pointsToRing(shape.getPoints(64))), true);
  if (outer.length < 4) return [];

  const holes = shape.holes
    .map((hole) => orientRing(closeRing(pointsToRing(hole.getPoints(64))), false))
    .filter((ring) => ring.length >= 4);

  return [[outer, ...holes]];
}

function pointsToRing(points: THREE.Vector2[]): Ring {
  return points.map((point) => [round(point.x), round(point.y)]);
}

function ringToPoints(ring: Ring): THREE.Vector2[] {
  const withoutClosingPoint = ring.slice(0, -1);
  return withoutClosingPoint.map(([x, y]) => new THREE.Vector2(x, y));
}

function closeRing(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function orientRing(ring: Ring, counterClockwise: boolean): Ring {
  const area = signedArea(ring);
  const isCounterClockwise = area > 0;
  if (isCounterClockwise === counterClockwise) return ring;
  const reversed = [...ring].reverse();
  return closeRing(reversed);
}

function signedArea(ring: Ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index];
    const next = ring[index + 1];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function round(value: number) {
  return Number(value.toFixed(5));
}
