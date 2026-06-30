import type * as THREE from "three";

export type SymbolLayer = {
  color: string;
  shapes: THREE.Shape[];
  flatGeometries: THREE.BufferGeometry[];
};

export function cloneSymbolLayers(layers: SymbolLayer[]): SymbolLayer[] {
  return layers.map((layer) => ({
    color: layer.color,
    shapes: layer.shapes.map((shape) => shape.clone()),
    flatGeometries: layer.flatGeometries.map((geometry) => geometry.clone()),
  }));
}
