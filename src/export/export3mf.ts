import * as THREE from "three";
import { strToU8, zipSync } from "fflate";
import type { TagConfig } from "../geometry/tagConfig";
import { createTagGeometries } from "../geometry/tagGeometry";
import type { SymbolLayer } from "../symbols/symbolLayer";

type MeshData = {
  vertices: Array<[number, number, number]>;
  triangles: Array<[number, number, number]>;
};

type ColoredMeshData = {
  vertices: Array<[number, number, number]>;
  triangles: Array<{
    vertices: [number, number, number];
    materialIndex: number;
  }>;
};

type MaterialInfo = {
  name: string;
  color: string;
};

type ItemTransform = {
  x: number;
  y: number;
  z?: number;
  matrix?: [number, number, number, number, number, number, number, number, number];
};

const colorGroupResourceId = 1;

export type ExportTagItem = {
  config: TagConfig;
  symbolLayers?: SymbolLayer[];
  transform?: ItemTransform;
};

export type ExportPlate = {
  name: string;
  items: ExportTagItem[];
};

export function download3mf(config: TagConfig, symbolLayers?: SymbolLayer[]) {
  downloadBlob(build3mfArchive([{ config, symbolLayers }]), "molle-tag.3mf");
}

export function download3mfSet(plates: ExportPlate[]) {
  if (plates.length === 1) {
    downloadBlob(build3mfArchive(plates[0].items), "molle-tag-set.3mf");
    return;
  }

  const archive = zipSync(
    Object.fromEntries(
      plates.map((plate, index) => [`platte-${index + 1}.3mf`, build3mfArchive(plate.items)]),
    ),
  );
  downloadBlob(archive, "molle-tag-set.zip");
}

function geometryToMeshData(geometry: THREE.BufferGeometry): MeshData {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute("position");
  if (!position) {
    source.dispose();
    return { vertices: [], triangles: [] };
  }
  const vertices: MeshData["vertices"] = [];
  const triangles: MeshData["triangles"] = [];
  const vertexIndex = new Map<string, number>();

  for (let index = 0; index < position.count; index += 3) {
    const triangle = [index, index + 1, index + 2].map((vertex) =>
      getWeldedVertexIndex(vertices, vertexIndex, [
        round(position.getX(vertex)),
        round(position.getY(vertex)),
        round(position.getZ(vertex)),
      ]),
    ) as [number, number, number];

    if (isDegenerate(vertices, triangle)) continue;
    triangles.push(triangle);
  }

  source.dispose();
  return { vertices, triangles };
}

function getWeldedVertexIndex(
  vertices: MeshData["vertices"],
  vertexIndex: Map<string, number>,
  vertex: [number, number, number],
) {
  const key = vertex.join(",");
  const existing = vertexIndex.get(key);
  if (existing !== undefined) return existing;

  const index = vertices.length;
  vertices.push(vertex);
  vertexIndex.set(key, index);
  return index;
}

function isDegenerate(vertices: MeshData["vertices"], triangle: [number, number, number]) {
  if (triangle[0] === triangle[1] || triangle[1] === triangle[2] || triangle[0] === triangle[2]) {
    return true;
  }

  const a = vertices[triangle[0]];
  const b = vertices[triangle[1]];
  const c = vertices[triangle[2]];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const areaSquared = cross[0] ** 2 + cross[1] ** 2 + cross[2] ** 2;
  return areaSquared < 1e-12;
}

function mergeMeshData(meshes: MeshData[]): MeshData {
  const vertices: MeshData["vertices"] = [];
  const triangles: MeshData["triangles"] = [];

  for (const mesh of meshes) {
    if (mesh.vertices.length === 0 || mesh.triangles.length === 0) continue;
    const offset = vertices.length;
    vertices.push(...mesh.vertices);
    triangles.push(
      ...mesh.triangles.map(([v1, v2, v3]) => [v1 + offset, v2 + offset, v3 + offset] as [number, number, number]),
    );
  }

  return { vertices, triangles };
}

function buildMaterials(
  items: Array<{ config: TagConfig; symbols: Array<{ color: string; mesh: MeshData }> }>,
): MaterialInfo[] {
  const materials: MaterialInfo[] = [];
  const materialIndexByColor = new Map<string, number>();

  const ensureMaterial = (name: string, color: string) => {
    const normalized = normalizeMaterialColor(color);
    const existingIndex = materialIndexByColor.get(normalized);
    if (existingIndex !== undefined) return existingIndex;

    const index = materials.length;
    materials.push({ name: `Farbe ${normalized}`, color: normalized });
    materialIndexByColor.set(normalized, index);
    return index;
  };

  for (const item of items) {
    ensureMaterial("Grundform", item.config.baseColor);
    for (const symbol of item.symbols) {
      ensureMaterial("Symbol", symbol.color);
    }
  }

  return materials;
}

function build3mfArchive(items: ExportTagItem[]) {
  const preparedItems = items.map((item) => buildItemMeshData(item));
  const materials = buildMaterials(preparedItems);
  const modelXml = buildModelXml(preparedItems, materials);
  const archive = zipSync({
    "[Content_Types].xml": strToU8(contentTypesXml()),
    "_rels/.rels": strToU8(relsXml()),
    "3D/3dmodel.model": strToU8(modelXml),
  });

  for (const item of preparedItems) {
    item.baseBottom.dispose();
    item.baseTop.dispose();
    for (const inlay of item.inlays) {
      inlay.geometry.dispose();
    }
  }

  return archive;
}

function buildItemMeshData(item: ExportTagItem) {
  const { baseBottom, baseTop, inlays } = createTagGeometries(item.config, item.symbolLayers);
  const base = mergeMeshData([geometryToMeshData(baseBottom), geometryToMeshData(baseTop)]);
  const symbols = inlays.map((inlay) => ({
    color: inlay.color,
    mesh: geometryToMeshData(inlay.geometry),
  }));

  return { config: item.config, transform: item.transform, baseBottom, baseTop, inlays, base, symbols };
}

function buildModelXml(
  items: Array<ReturnType<typeof buildItemMeshData>>,
  materials: MaterialInfo[],
) {
  let nextObjectId = 2;
  const objects: string[] = [];
  const buildItems: string[] = [];
  const materialIndexByColor = new Map(materials.map((material, index) => [normalizeMaterialColor(material.color), index]));

  items.forEach((item, itemIndex) => {
    const itemLabel = items.length > 1 ? ` ${itemIndex + 1}` : "";
    const baseMaterialIndex = materialIndexByColor.get(normalizeMaterialColor(item.config.baseColor)) ?? 0;
    const baseMesh = buildColoredMesh(item.base, baseMaterialIndex, item.transform);

    if (hasMesh(baseMesh)) {
      const objectId = nextObjectId++;
      objects.push(objectXml(objectId, `Grundform${itemLabel} ${normalizeMaterialColor(item.config.baseColor)}`, baseMesh));
      buildItems.push(`<item objectid="${objectId}" />`);
    }

    item.symbols.forEach((symbol, symbolIndex) => {
      const symbolMaterialIndex = materialIndexByColor.get(normalizeMaterialColor(symbol.color)) ?? baseMaterialIndex;
      const symbolMesh = buildColoredMesh(symbol.mesh, symbolMaterialIndex, item.transform);
      if (!hasMesh(symbolMesh)) return;

      const objectId = nextObjectId++;
      const symbolLabel = item.symbols.length > 1 ? ` ${symbolIndex + 1}` : "";
      objects.push(objectXml(objectId, `Inlay${itemLabel}${symbolLabel} ${normalizeMaterialColor(symbol.color)}`, symbolMesh));
      buildItems.push(`<item objectid="${objectId}" />`);
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" recommendedextensions="m">
  <metadata name="Title">Taktische Zeichen 3D</metadata>
  <resources>
    <m:colorgroup id="${colorGroupResourceId}">
      ${materials
        .map((material) => `<m:color color="${colorTo3mf(material.color)}" />`)
        .join("")}
    </m:colorgroup>
    ${objects.join("")}
  </resources>
  <build>
    ${buildItems.join("")}
  </build>
</model>`;
}

function buildColoredMesh(source: MeshData, materialIndex: number, transform?: ItemTransform): ColoredMeshData {
  const mesh: ColoredMeshData = { vertices: [], triangles: [] };
  appendColoredMesh(mesh, source, materialIndex, transform);
  return mesh;
}

function hasMesh(mesh: ColoredMeshData) {
  return mesh.vertices.length > 0 && mesh.triangles.length > 0;
}

function appendColoredMesh(
  target: ColoredMeshData,
  source: MeshData,
  materialIndex: number,
  transform?: ItemTransform,
) {
  if (source.vertices.length === 0 || source.triangles.length === 0) return;

  const offset = target.vertices.length;
  target.vertices.push(...source.vertices.map((vertex) => transformVertex(vertex, transform)));
  target.triangles.push(
    ...source.triangles.map((vertices) => ({
      vertices: [vertices[0] + offset, vertices[1] + offset, vertices[2] + offset] as [number, number, number],
      materialIndex,
    })),
  );
}

function transformVertex(vertex: [number, number, number], transform?: ItemTransform): [number, number, number] {
  if (!transform) return vertex;

  const matrix = transform.matrix ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const tx = transform.x;
  const ty = transform.y;
  const tz = transform.z ?? 0;
  return [
    round(matrix[0] * vertex[0] + matrix[1] * vertex[1] + matrix[2] * vertex[2] + tx),
    round(matrix[3] * vertex[0] + matrix[4] * vertex[1] + matrix[5] * vertex[2] + ty),
    round(matrix[6] * vertex[0] + matrix[7] * vertex[1] + matrix[8] * vertex[2] + tz),
  ];
}

function objectXml(id: number, name: string, mesh: ColoredMeshData) {
  const vertices = mesh.vertices
    .map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`)
    .join("");
  const triangles = mesh.triangles
    .map(
      ({ vertices: [v1, v2, v3], materialIndex }) =>
        `<triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="${colorGroupResourceId}" p1="${materialIndex}" p2="${materialIndex}" p3="${materialIndex}" />`,
    )
    .join("");

  return `<object id="${id}" type="model" name="${escapeXml(name)}">
      <mesh>
        <vertices>${vertices}</vertices>
        <triangles>${triangles}</triangles>
      </mesh>
    </object>`;
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;
}

function relsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;
}

function downloadBlob(data: Uint8Array, filename: string) {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const blob = new Blob([bytes], { type: "model/3mf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function colorTo3mf(color: string) {
  return `${normalizeMaterialColor(color)}FF`;
}

function normalizeMaterialColor(color: string) {
  const normalized = normalizeHexColor(color);
  const rgb = hexToRgb(normalized);
  if (!rgb) return normalized;

  if (Math.max(rgb.r, rgb.g, rgb.b) <= 24) return "#000000";
  if (Math.min(rgb.r, rgb.g, rgb.b) >= 245) return "#FFFFFF";
  return normalized;
}

function normalizeHexColor(color: string) {
  const normalized = color.startsWith("#") ? color : `#${color}`;
  if (normalized.length === 4) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return normalized.slice(0, 7).toUpperCase();
}

function hexToRgb(color: string) {
  const match = /^#([0-9A-F]{6})$/i.exec(color);
  if (!match) return null;

  const value = Number.parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function round(value: number) {
  return Number(value.toFixed(5));
}
