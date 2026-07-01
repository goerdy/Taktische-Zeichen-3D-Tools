import * as THREE from "three";
import { strToU8, zipSync } from "fflate";
import type { AtemschutzConfig } from "./atemschutzConfig";
import { createAtemschutzGeometries } from "./atemschutzGeometry";

type MeshData = {
  vertices: Array<[number, number, number]>;
  triangles: Array<[number, number, number]>;
};

type MaterialInfo = {
  color: string;
};

const colorGroupResourceId = 1;

export async function downloadAtemschutz3mf(config: AtemschutzConfig) {
  const { baseBottom, baseTop, inlays } = await createAtemschutzGeometries(config);
  const objects = [
    {
      name: `Grundform ${normalizeMaterialColor(config.baseColor)}`,
      color: config.baseColor,
      mesh: mergeMeshData([geometryToMeshData(baseBottom), geometryToMeshData(baseTop)]),
    },
    ...inlays.map((inlay) => ({
      name: `${inlay.name} ${normalizeMaterialColor(inlay.color)}`,
      color: inlay.color,
      mesh: geometryToMeshData(inlay.geometry),
    })),
  ];
  const materials = buildMaterials(objects.map((object) => object.color));
  const materialIndexByColor = new Map(materials.map((material, index) => [material.color, index]));
  const modelXml = buildModelXml(
    objects.map((object) => ({
      ...object,
      materialIndex: materialIndexByColor.get(normalizeMaterialColor(object.color)) ?? 0,
    })),
    materials,
  );

  baseBottom.dispose();
  baseTop.dispose();
  for (const inlay of inlays) {
    inlay.geometry.dispose();
  }

  const archive = zipSync({
    "[Content_Types].xml": strToU8(contentTypesXml()),
    "_rels/.rels": strToU8(relsXml()),
    "3D/3dmodel.model": strToU8(modelXml),
  });

  downloadBlob(archive, "atemschutz-anhaenger.3mf");
}

function mergeMeshData(meshes: MeshData[]) {
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

function buildMaterials(colors: string[]) {
  const materials: MaterialInfo[] = [];
  const seen = new Set<string>();

  for (const color of colors) {
    const normalized = normalizeMaterialColor(color);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    materials.push({ color: normalized });
  }

  return materials;
}

function buildModelXml(
  objects: Array<{ name: string; mesh: MeshData; materialIndex: number }>,
  materials: MaterialInfo[],
) {
  let nextObjectId = 2;
  const objectXmls: string[] = [];
  const buildItems: string[] = [];

  for (const object of objects) {
    if (object.mesh.vertices.length === 0 || object.mesh.triangles.length === 0) continue;
    const objectId = nextObjectId++;
    objectXmls.push(objectXml(objectId, object.name, object.mesh, object.materialIndex));
    buildItems.push(`<item objectid="${objectId}" />`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" recommendedextensions="m">
  <metadata name="Title">Atemschutz Anhänger</metadata>
  <resources>
    <m:colorgroup id="${colorGroupResourceId}">
      ${materials.map((material) => `<m:color color="${colorTo3mf(material.color)}" />`).join("")}
    </m:colorgroup>
    ${objectXmls.join("")}
  </resources>
  <build>
    ${buildItems.join("")}
  </build>
</model>`;
}

function objectXml(id: number, name: string, mesh: MeshData, materialIndex: number) {
  const vertices = mesh.vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`).join("");
  const triangles = mesh.triangles
    .map(
      ([v1, v2, v3]) =>
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

    if (triangle[0] !== triangle[1] && triangle[1] !== triangle[2] && triangle[0] !== triangle[2]) {
      triangles.push(triangle);
    }
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
