import * as THREE from "three";
import { strToU8, zipSync } from "fflate";
import type { TagConfig } from "../geometry/tagConfig";
import { createTagGeometries } from "../geometry/tagGeometry";
import type { SymbolLayer } from "../symbols/symbolLayer";
import type { AtemschutzConfig } from "../atemschutz/atemschutzConfig";
import { createAtemschutzGeometries } from "../atemschutz/atemschutzGeometry";

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
  color: string;
};

type ItemTransform = {
  x: number;
  y: number;
  z?: number;
  matrix?: [number, number, number, number, number, number, number, number, number];
};

export type ExportBatchItem =
  | {
      kind: "taktische-zeichen";
      config: TagConfig;
      symbolLayers?: SymbolLayer[];
      transform?: ItemTransform;
    }
  | {
      kind: "dienststellungskennzeichen-thw";
      config: TagConfig;
      symbolLayers?: SymbolLayer[];
      transform?: ItemTransform;
    }
  | {
      kind: "dienstgrade-fw-nds";
      config: TagConfig;
      symbolLayers?: SymbolLayer[];
      transform?: ItemTransform;
    }
  | {
      kind: "atemschutz";
      config: AtemschutzConfig;
      transform?: ItemTransform;
    };

export type ExportBatchPlate = {
  name: string;
  items: ExportBatchItem[];
};

const colorGroupResourceId = 1;

export async function downloadBatch3mfSet(plates: ExportBatchPlate[]) {
  if (plates.length === 1) {
    downloadBlob(await build3mfArchive(plates[0].items), "3d-tools-set.3mf");
    return;
  }

  const archives = await Promise.all(
    plates.map(async (plate, index) => [`platte-${index + 1}.3mf`, await build3mfArchive(plate.items)] as const),
  );
  downloadBlob(zipSync(Object.fromEntries(archives)), "3d-tools-set.zip");
}

async function build3mfArchive(items: ExportBatchItem[]) {
  const preparedItems = await Promise.all(items.map((item) => buildItemMeshData(item)));
  const materials = buildMaterials(preparedItems);
  const modelXml = buildModelXml(preparedItems, materials);
  const archive = zipSync({
    "[Content_Types].xml": strToU8(contentTypesXml()),
    "_rels/.rels": strToU8(relsXml()),
    "3D/3dmodel.model": strToU8(modelXml),
  });

  for (const item of preparedItems) {
    item.dispose();
  }

  return archive;
}

async function buildItemMeshData(item: ExportBatchItem) {
  if (
    item.kind === "taktische-zeichen" ||
    item.kind === "dienststellungskennzeichen-thw" ||
    item.kind === "dienstgrade-fw-nds"
  ) {
    const { baseBottom, baseTop, inlays } = createTagGeometries(item.config, item.symbolLayers);
    const base = mergeMeshData([geometryToMeshData(baseBottom), geometryToMeshData(baseTop)]);
    const objects = [
      {
        name: "Grundform",
        color: item.config.baseColor,
        mesh: base,
      },
      ...inlays.map((inlay, index) => ({
        name: `Inlay ${index + 1}`,
        color: inlay.color,
        mesh: geometryToMeshData(inlay.geometry),
      })),
    ];

    return {
      kind: item.kind,
      config: item.config,
      transform: item.transform,
      objects,
      dispose: () => {
        baseBottom.dispose();
        baseTop.dispose();
        for (const inlay of inlays) {
          inlay.geometry.dispose();
        }
      },
    };
  }

  const { baseBottom, baseTop, inlays } = await createAtemschutzGeometries(item.config);
  const base = mergeMeshData([geometryToMeshData(baseBottom), geometryToMeshData(baseTop)]);
  const objects = [
    {
      name: "Grundform",
      color: item.config.baseColor,
      mesh: base,
    },
    ...inlays.map((inlay) => ({
      name: inlay.name,
      color: inlay.color,
      mesh: geometryToMeshData(inlay.geometry),
    })),
  ];

  return {
    kind: item.kind,
    transform: item.transform,
    objects,
    dispose: () => {
      baseBottom.dispose();
      baseTop.dispose();
      for (const inlay of inlays) {
        inlay.geometry.dispose();
      }
    },
  };
}

function buildMaterials(
  items: Array<{
    objects: Array<{ color: string }>;
  }>,
) {
  const materials: MaterialInfo[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    for (const object of item.objects) {
      const normalized = normalizeMaterialColor(object.color);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      materials.push({ color: normalized });
    }
  }

  return materials;
}

function buildModelXml(
  items: Array<Awaited<ReturnType<typeof buildItemMeshData>>>,
  materials: MaterialInfo[],
) {
  let nextObjectId = 2;
  const objects: string[] = [];
  const buildItems: string[] = [];
  const materialIndexByColor = new Map(materials.map((material, index) => [normalizeMaterialColor(material.color), index]));

  items.forEach((item, itemIndex) => {
    const itemLabel = items.length > 1 ? ` ${itemIndex + 1}` : "";
    if (item.kind !== "atemschutz" && shouldExportAsSingleObject(item.config)) {
      const combinedMesh: ColoredMeshData = { vertices: [], triangles: [] };
      item.objects.forEach((object) => {
        const materialIndex = materialIndexByColor.get(normalizeMaterialColor(object.color)) ?? 0;
        appendColoredMesh(combinedMesh, object.mesh, materialIndex, item.transform);
      });
      if (!hasMesh(combinedMesh)) return;

      const objectId = nextObjectId++;
      objects.push(objectXml(objectId, `${item.kind}${itemLabel} kombiniert`, combinedMesh));
      buildItems.push(`<item objectid="${objectId}" />`);
      return;
    }

    item.objects.forEach((object, objectIndex) => {
      const materialIndex = materialIndexByColor.get(normalizeMaterialColor(object.color)) ?? 0;
      const mesh = buildColoredMesh(object.mesh, materialIndex, item.transform);
      if (!hasMesh(mesh)) return;

      const objectId = nextObjectId++;
      const objectLabel = item.objects.length > 1 ? ` ${objectIndex + 1}` : "";
      objects.push(
        objectXml(
          objectId,
          `${item.kind}${itemLabel} ${object.name}${objectLabel} ${normalizeMaterialColor(object.color)}`,
          mesh,
        ),
      );
      buildItems.push(`<item objectid="${objectId}" />`);
    });
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" recommendedextensions="m">
  <metadata name="Title">goerdys 3D-Tools Set</metadata>
  <resources>
    <m:colorgroup id="${colorGroupResourceId}">
      ${materials.map((material) => `<m:color color="${colorTo3mf(material.color)}" />`).join("")}
    </m:colorgroup>
    ${objects.join("")}
  </resources>
  <build>
    ${buildItems.join("")}
  </build>
</model>`;
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

function buildColoredMesh(source: MeshData, materialIndex: number, transform?: ItemTransform): ColoredMeshData {
  const mesh: ColoredMeshData = { vertices: [], triangles: [] };
  appendColoredMesh(mesh, source, materialIndex, transform);
  return mesh;
}

function shouldExportAsSingleObject(config: TagConfig) {
  return config.baseFormId === "schluesselanhaenger-klein" && config.doubleSided;
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

function hasMesh(mesh: ColoredMeshData) {
  return mesh.vertices.length > 0 && mesh.triangles.length > 0;
}

function objectXml(id: number, name: string, mesh: ColoredMeshData) {
  const vertices = mesh.vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}" />`).join("");
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
  const blob = new Blob([bytes], { type: filename.endsWith(".zip") ? "application/zip" : "model/3mf" });
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
