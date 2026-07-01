import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { createRoot } from "react-dom/client";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import "./styles.css";
import { TagPreview } from "./preview/TagPreview";
import type { TagConfig } from "./geometry/tagConfig";
import { defaultTagConfig } from "./geometry/tagConfig";
import { baseFormOptions, getBaseFormOption } from "./geometry/baseForms";
import { download3mf, download3mfSet } from "./export/export3mf";
import { downloadBatch3mfSet } from "./export/exportBatch3mf";
import { symbolCatalog } from "./symbols/catalog";
import { loadLabelLayers } from "./symbols/loadLabelShapes";
import { loadSymbolLayers } from "./symbols/loadSymbolShapes";
import { resolveSymbolAssetPath } from "./symbols/assetPath";
import { cloneSymbolLayers, type SymbolLayer } from "./symbols/symbolLayer";
import { AtemschutzPreview } from "./atemschutz/AtemschutzPreview";
import type { AtemschutzConfig } from "./atemschutz/atemschutzConfig";
import { defaultAtemschutzConfig } from "./atemschutz/atemschutzConfig";
import { downloadAtemschutz3mf } from "./atemschutz/exportAtemschutz3mf";
import {
  thwDienststellungskennzeichen,
  type DienststellungskennzeichenFormId,
} from "./dienststellungskennzeichen/thwCatalog";
import { fwNdsBerufsfeuerwehr, fwNdsBerufsfeuerwehrGroups } from "./dienstgrade-fw-nds/catalog";

type PageId =
  | "taktische-zeichen"
  | "dienststellungskennzeichen-thw"
  | "dienstgrade-fw-nds"
  | "atemschutz"
  | "stapelverarbeitung"
  | "ueber-impressum";

const pages: Array<{ id: PageId; label: string; isPrimary?: boolean }> = [
  { id: "taktische-zeichen", label: "Taktische Zeichen", isPrimary: true },
  { id: "dienststellungskennzeichen-thw", label: "Dienststellungskennezeichen THW" },
  { id: "dienstgrade-fw-nds", label: "Dienstgrade FW NDS" },
  { id: "atemschutz", label: "Atemschutz" },
  { id: "stapelverarbeitung", label: "Stapelverarbeitung" },
  { id: "ueber-impressum", label: "Über/Impressum" },
];

const projectLinkUrl = "https://github.com/jonas-koeritz/Taktische-Zeichen";
const sourceCodeUrl = "https://github.com/goerdy/Taktische-Zeichen-3D-Tools";

const runtimeLibraries = [
  "React",
  "React DOM",
  "Three.js",
  "TypeScript",
  "Vite",
  "@vitejs/plugin-react",
  "opentype.js",
  "polygon-clipping",
  "fflate",
  "@xmldom/xmldom",
];

const savedSetStorageKey = "goerdys-3d-tools-saved-sets";
const fwNdsAspectRatioCache = new Map<string, number>();
const fwNdsMittlererDienstScale = 74.3;
const fwNdsGehobenerDienstScale = 100;
const atemschutzPresets: Array<{ id: string; label: string; config: AtemschutzConfig }> = [
  {
    id: "thw",
    label: "THW",
    config: {
      ...defaultAtemschutzConfig,
      mainTextSeparator: true,
    },
  },
  {
    id: "fw-wvh",
    label: "FW WVH",
    config: {
      ...defaultAtemschutzConfig,
      baseColor: "#C1121F",
      mainTextLine1: "M. Mustermann",
      mainTextLine2: "BF WHV - WA 3",
      bottomTextLine1: "J: M/R",
      bottomTextLine2: "H: M/R",
      mainTextLine1Color: "#000000",
      mainTextLine2Color: "#000000",
      mainTextSeparator: true,
      bottomTextLine1Color: "#000000",
      bottomTextLine2Color: "#000000",
    },
  },
  {
    id: "feuerwehr",
    label: "FEUERWEHR",
    config: {
      ...defaultAtemschutzConfig,
      baseColor: "#C1121F",
      mainTextLine1: "M. Mustermann",
      mainTextLine2: "OF PUSTEMUCKEL",
      bottomTextLine1: "AGT",
      bottomTextLine2: "CSA",
      mainTextLine1Color: "#000000",
      mainTextLine2Color: "#000000",
      mainTextSeparator: true,
      bottomTextLine1Color: "#000000",
      bottomTextLine2Color: "#000000",
    },
  },
];

type SavedBatchBase = {
  savedAt: string;
  quantity: number;
};

type SaveFeedbackKind =
  | "taktische-zeichen"
  | "atemschutz"
  | "dienststellungskennzeichen-thw"
  | "dienstgrade-fw-nds"
  | null;

type SavedTagSet = SavedBatchBase & {
  kind: "taktische-zeichen";
  config: TagConfig;
};

type SavedAtemschutzSet = SavedBatchBase & {
  kind: "atemschutz";
  config: AtemschutzConfig;
};

type SavedDienststellungskennzeichenSet = SavedBatchBase & {
  kind: "dienststellungskennzeichen-thw";
  badgeId: string;
  formId: DienststellungskennzeichenFormId;
  config: TagConfig;
};

type SavedFwNdsDienstgradSet = SavedBatchBase & {
  kind: "dienstgrade-fw-nds";
  badgeId: string;
  config: TagConfig;
};

type SavedSet =
  | SavedTagSet
  | SavedAtemschutzSet
  | SavedDienststellungskennzeichenSet
  | SavedFwNdsDienstgradSet;

type PackedItem = {
  kind: SavedSet["kind"];
  config: TagConfig | AtemschutzConfig;
  badgeId?: string;
  symbolLayers?: SymbolLayer[];
  width: number;
  height: number;
  thickness: number;
  x: number;
  y: number;
};

function getPageFromHash(): PageId {
  const value = window.location.hash.replace("#", "") as PageId;
  return pages.some((page) => page.id === value) ? value : "taktische-zeichen";
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel info-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function readSavedSets(): SavedSet[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(savedSetStorageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap<SavedSet>((entry) => {
      if (!entry || typeof entry !== "object") return [];

      const candidate = entry as Partial<SavedSet> & {
        kind?: SavedSet["kind"];
        config?: Partial<TagConfig> | Partial<AtemschutzConfig>;
      };
      if (typeof candidate.savedAt !== "string" || !candidate.config) return [];

      const quantity = typeof candidate.quantity === "number" && candidate.quantity > 0 ? candidate.quantity : 1;
      if (candidate.kind === "atemschutz") {
        return [
          {
            kind: "atemschutz",
            savedAt: candidate.savedAt,
            quantity,
            config: {
              ...defaultAtemschutzConfig,
              ...candidate.config,
            } as AtemschutzConfig,
          },
        ];
      }

      if (candidate.kind === "dienststellungskennzeichen-thw") {
        const badgeId = typeof (candidate as SavedDienststellungskennzeichenSet).badgeId === "string"
          ? (candidate as SavedDienststellungskennzeichenSet).badgeId
          : thwDienststellungskennzeichen[0].id;
        const formId =
          (candidate as SavedDienststellungskennzeichenSet).formId === "schluesselanhaenger"
            ? "schluesselanhaenger"
            : "molle-hook-v1";

        return [
          {
            kind: "dienststellungskennzeichen-thw",
            savedAt: candidate.savedAt,
            quantity,
            badgeId,
            formId,
            config: {
              ...buildDienststellungskennzeichenConfig(formId),
              ...candidate.config,
            } as TagConfig,
          },
        ];
      }

      if (candidate.kind === "dienstgrade-fw-nds") {
        const badgeId =
          typeof (candidate as SavedFwNdsDienstgradSet).badgeId === "string"
            ? (candidate as SavedFwNdsDienstgradSet).badgeId
            : fwNdsBerufsfeuerwehr[0].id;

        return [
          {
            kind: "dienstgrade-fw-nds",
            savedAt: candidate.savedAt,
            quantity,
            badgeId,
            config: {
              ...buildFwNdsDienstgradConfig(),
              ...candidate.config,
            } as TagConfig,
          },
        ];
      }

      return [
        {
          kind: "taktische-zeichen",
          savedAt: candidate.savedAt,
          quantity,
          config: {
            ...defaultTagConfig,
            ...candidate.config,
          } as TagConfig,
        },
      ];
    });
  } catch {
    return [];
  }
}

function formatSavedAt(value: string) {
  return new Date(value).toLocaleString("de-DE");
}

function getSymbolName(symbolId: string) {
  return symbolCatalog.find((symbol) => symbol.id === symbolId)?.name ?? symbolId;
}

function getBaseFormName(baseFormId: TagConfig["baseFormId"]) {
  return baseFormOptions.find((option) => option.id === baseFormId)?.name ?? baseFormId;
}

function sanitizeSavedTagConfig(config: TagConfig): TagConfig {
  return {
    ...config,
    inlayColor: defaultTagConfig.inlayColor,
  };
}

function sanitizeSavedAtemschutzConfig(config: AtemschutzConfig): AtemschutzConfig {
  return {
    ...defaultAtemschutzConfig,
    ...config,
  };
}

function buildDienststellungskennzeichenConfig(formId: DienststellungskennzeichenFormId): TagConfig {
  if (formId === "schluesselanhaenger") {
    return {
      ...defaultTagConfig,
      baseFormId: "schluesselanhaenger-klein",
      width: 30,
      height: 97,
      baseThickness: 3,
      cornerRadius: 1.5,
      hookDepth: 0,
      hookStep: 0,
      inlayThickness: 0.4,
      minLineThickness: 0.65,
      symbolScale: 100,
      symbolYOffset: 0,
      doubleSided: false,
      labelText: "",
      baseColor: "#003399",
      inlayColor: "#FFFFFF",
    };
  }

  return {
    ...defaultTagConfig,
    baseFormId: "molle-hook-v1",
    width: 80,
    height: 37,
    baseThickness: 4,
    cornerRadius: 1.5,
    hookDepth: 10,
    hookStep: 5,
    inlayThickness: 0.4,
    minLineThickness: 0.65,
    symbolScale: 90,
    symbolYOffset: 0,
    doubleSided: false,
    labelText: "",
    baseColor: "#003399",
    inlayColor: "#FFFFFF",
  };
}

function buildFwNdsDienstgradConfig(): TagConfig {
  const width = 30;

  return {
    ...defaultTagConfig,
    baseFormId: "schluesselanhaenger-klein",
    width,
    height: computeFwNdsKeychainHeight(width, 122.6 / 127.8, fwNdsGehobenerDienstScale),
    baseThickness: 3,
    cornerRadius: 1.5,
    hookDepth: 0,
    hookStep: 0,
    inlayThickness: 0.4,
    minLineThickness: 0.65,
    symbolScale: 100,
    symbolYOffset: 0,
    doubleSided: false,
    labelText: "",
    baseColor: "#0B1020",
    inlayColor: "#FFFFFF",
  };
}

function computeFwNdsKeychainHeight(width: number, aspectRatio: number, symbolScale: number) {
  const scaleFactor = Math.max(0.1, symbolScale / 100);
  const rectangularBodyHeight = (width - 3) * aspectRatio * scaleFactor + 3;
  return Math.round((rectangularBodyHeight + width / 2) * 2) / 2;
}

async function getFwNdsBadgeAspectRatio(path: string) {
  const cached = fwNdsAspectRatioCache.get(path);
  if (cached) return cached;

  const response = await fetch(resolveSymbolAssetPath(path));
  if (!response.ok) {
    return 122.6 / 127.8;
  }

  const svgText = await response.text();
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const points = data.paths.flatMap((svgPath) => SVGLoader.createShapes(svgPath)).flatMap((shape) => shape.getPoints(48));
  if (points.length === 0) {
    return 122.6 / 127.8;
  }

  const box = new THREE.Box2().setFromPoints(points);
  const size = box.getSize(new THREE.Vector2());
  const aspectRatio = Math.max(size.x, 1) / Math.max(size.y, 1);
  fwNdsAspectRatioCache.set(path, aspectRatio);
  return aspectRatio;
}

function getFwNdsBaseScale(path: string) {
  return path.includes("/MittlererDienst/") ? fwNdsMittlererDienstScale : fwNdsGehobenerDienstScale;
}

async function loadFwNdsDienstgradLayers(path: string, config: TagConfig) {
  const tempConfig: TagConfig = {
    ...config,
    baseFormId: "molle-hook-v1",
    width: Math.max(config.width * 4, 80),
    height: Math.max(12, config.width - 3),
    hookDepth: 0,
    hookStep: 0,
    symbolScale: config.symbolScale,
    symbolYOffset: 0,
  };
  const layers = stripDienststellungskennzeichenBackground(await loadSymbolLayers(path, tempConfig));
  const bodyHeight = Math.max(20, config.height - config.width / 2);
  const targetCenter = new THREE.Vector2(0, bodyHeight / 2);
  const sourceCenter = new THREE.Vector2(0, tempConfig.height / 2);
  const rotatedLayers = transformSymbolLayers(layers, (point) => {
    const localX = point.x - sourceCenter.x;
    const localY = point.y - sourceCenter.y;
    return new THREE.Vector2(targetCenter.x - localY, targetCenter.y + localX);
  });
  const rotatedBounds = getLayerBounds(rotatedLayers);
  const alignedLayers = !rotatedBounds
    ? rotatedLayers
    : transformSymbolLayers(rotatedLayers, (point) => new THREE.Vector2(point.x, point.y + (3 - rotatedBounds.min.y)));

  const baseScale = getFwNdsBaseScale(path) / 100;
  if (Math.abs(baseScale - 1) < 0.0001) return alignedLayers;

  return transformSymbolLayers(alignedLayers, (point) =>
    new THREE.Vector2(point.x * baseScale, 3 + (point.y - 3) * baseScale),
  );
}

function getDienststellungskennzeichenName(badgeId: string) {
  return thwDienststellungskennzeichen.find((entry) => entry.id === badgeId)?.name ?? badgeId;
}

function getFwNdsDienstgradName(badgeId: string) {
  return fwNdsBerufsfeuerwehr.find((entry) => entry.id === badgeId)?.name ?? badgeId;
}

function getSavedSetTypeLabel(entry: SavedSet) {
  if (entry.kind === "taktische-zeichen") return "Taktisches Zeichen";
  if (entry.kind === "atemschutz") return "Atemschutz";
  if (entry.kind === "dienstgrade-fw-nds") return "Dienstgrade FW NDS";
  return "Dienststellungskennzeichen THW";
}

function getSavedSetDescription(entry: SavedSet) {
  if (entry.kind === "taktische-zeichen") {
    const parts = [getBaseFormName(entry.config.baseFormId), getSymbolName(entry.config.symbolId)];
    if (entry.config.labelText) parts.push(entry.config.labelText);
    return parts.join(" · ");
  }

  if (entry.kind === "dienststellungskennzeichen-thw") {
    return `${getDienststellungskennzeichenName(entry.badgeId)} · ${
      entry.formId === "schluesselanhaenger" ? "Schlüsselanhänger" : "MOLLE"
    }`;
  }

  if (entry.kind === "dienstgrade-fw-nds") {
    return `${getFwNdsDienstgradName(entry.badgeId)} · Schlüsselanhänger`;
  }

  const parts = [entry.config.mainTextLine1, entry.config.mainTextLine2, entry.config.bottomTextLine1, entry.config.bottomTextLine2]
    .map((value) => value.trim())
    .filter(Boolean);
  return parts.join(" · ") || "Atemschutz-Anhaenger";
}

function getSavedSetDimensions(entry: SavedSet) {
  return `${entry.config.width} x ${entry.config.height} mm`;
}

function getSavedSetBaseColor(entry: SavedSet) {
  return entry.config.baseColor;
}

function packItemsForPlates(items: PackedItem[], bedWidth: number, bedHeight: number) {
  const margin = 5;
  const gap = 5;
  const usableWidth = Math.max(0, bedWidth - margin * 2);
  const usableHeight = Math.max(0, bedHeight - margin * 2);
  const plates: PackedItem[][] = [];
  let currentPlate: PackedItem[] = [];
  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0;

  const commitPlate = () => {
    if (currentPlate.length > 0) {
      plates.push(currentPlate);
      currentPlate = [];
    }
  };

  for (const item of items) {
    const itemWidth = item.width;
    const itemHeight = item.height;
    const tooLargeForPlate = itemWidth > usableWidth || itemHeight > usableHeight;

    if (tooLargeForPlate && currentPlate.length > 0) {
      commitPlate();
      cursorX = margin;
      cursorY = margin;
      rowHeight = 0;
    }

    if (!tooLargeForPlate && cursorX + itemWidth > bedWidth - margin) {
      cursorX = margin;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }

    if (!tooLargeForPlate && cursorY + itemHeight > bedHeight - margin) {
      commitPlate();
      cursorX = margin;
      cursorY = margin;
      rowHeight = 0;
    }

    currentPlate.push({
      ...item,
      x: cursorX,
      y: cursorY,
    });

    cursorX += itemWidth + gap;
    rowHeight = Math.max(rowHeight, itemHeight);

    if (tooLargeForPlate) {
      commitPlate();
      cursorX = margin;
      cursorY = margin;
      rowHeight = 0;
    }
  }

  commitPlate();
  return plates;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function waitForUiPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function loadDienststellungskennzeichenLayers(
  path: string,
  config: TagConfig,
  formId: DienststellungskennzeichenFormId,
) {
  if (formId === "molle-hook-v1") {
    const tempConfig: TagConfig = {
      ...config,
      width: Math.max(20, config.width - config.hookDepth * 2),
      symbolScale: 96,
      symbolYOffset: 0,
    };
    const layers = stripDienststellungskennzeichenBackground(await loadSymbolLayers(path, tempConfig));
    if (!config.labelText.trim()) {
      return layers;
    }

    const shiftedLayers = transformSymbolLayers(layers, (point) => new THREE.Vector2(point.x, point.y + 4.2));
    const textLayers = styleDienststellungskennzeichenLabelLayers(
      await loadLabelLayers(config.labelText, config),
      getDienststellungskennzeichenPrimaryColor(layers),
    );
    return [...textLayers, ...shiftedLayers];
  }

  const bodyHeight = Math.max(20, config.height - config.width / 2);
  const tempConfig: TagConfig = {
    ...config,
    baseFormId: "molle-hook-v1",
    width: Math.max(20, bodyHeight - 3),
    height: Math.max(12, config.width - 3),
    hookDepth: 0,
    hookStep: 0,
    symbolScale: config.symbolScale,
    symbolYOffset: 0,
  };
  const layers = stripDienststellungskennzeichenBackground(await loadSymbolLayers(path, tempConfig));
  const targetCenter = new THREE.Vector2(0, bodyHeight / 2);
  const sourceCenter = new THREE.Vector2(0, tempConfig.height / 2);
  const rotatedLayers = transformSymbolLayers(layers, (point) => {
    const localX = point.x - sourceCenter.x;
    const localY = point.y - sourceCenter.y;
    return new THREE.Vector2(targetCenter.x - localY, targetCenter.y + localX);
  });
  const bounds = getLayerBounds(rotatedLayers);
  if (!bounds) return rotatedLayers;

  const yShift = 3 - bounds.min.y;
  return transformSymbolLayers(rotatedLayers, (point) => new THREE.Vector2(point.x, point.y + yShift));
}

function transformSymbolLayers(
  layers: SymbolLayer[],
  transform: (point: THREE.Vector2) => THREE.Vector2,
) {
  return cloneSymbolLayers(layers).map((layer) => ({
    color: layer.color,
    shapes: layer.shapes.map((shape) => transformShape(shape, transform)),
    flatGeometries: layer.flatGeometries.map((geometry) => transformFlatGeometry(geometry, transform)),
  }));
}

function transformShape(shape: THREE.Shape, transform: (point: THREE.Vector2) => THREE.Vector2) {
  const next = new THREE.Shape(shape.getPoints(48).map(transform));
  next.holes = shape.holes.map((hole) => new THREE.Path(hole.getPoints(48).map(transform)));
  return next;
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
  next.computeBoundingBox();
  next.computeBoundingSphere();
  return next;
}

function stripDienststellungskennzeichenBackground(layers: SymbolLayer[]) {
  return cloneSymbolLayers(layers).filter((layer) => normalizeHexColor(layer.color) !== "#003399");
}

function getDienststellungskennzeichenPrimaryColor(layers: SymbolLayer[]) {
  return layers[0]?.color ?? "#FFFFFF";
}

function styleDienststellungskennzeichenLabelLayers(layers: SymbolLayer[], color: string) {
  const cloned = cloneSymbolLayers(layers).map((layer) => ({
    ...layer,
    color,
  }));
  const bounds = getLayerBounds(cloned);
  if (!bounds) return cloned;

  const center = bounds.getCenter(new THREE.Vector2());
  const scale = 1.18;
  return transformSymbolLayers(cloned, (point) => {
    const x = (point.x - center.x) * scale + center.x;
    const y = (point.y - center.y) * scale + center.y + 2.1;
    return new THREE.Vector2(x, y);
  });
}

function getLayerBounds(layers: SymbolLayer[]) {
  const points = [
    ...layers.flatMap((layer) => layer.shapes.flatMap((shape) => shape.getPoints(32))),
    ...layers.flatMap((layer) =>
      layer.flatGeometries.flatMap((geometry) => {
        const source = geometry.index ? geometry.toNonIndexed() : geometry;
        const position = source.getAttribute("position");
        const nextPoints: THREE.Vector2[] = [];
        for (let index = 0; index < position.count; index += 1) {
          nextPoints.push(new THREE.Vector2(position.getX(index), position.getY(index)));
        }
        if (source !== geometry) source.dispose();
        return nextPoints;
      }),
    ),
  ];
  if (points.length === 0) return null;
  return new THREE.Box2().setFromPoints(points);
}

function normalizeHexColor(color: string) {
  const normalized = color.startsWith("#") ? color : `#${color}`;
  if (normalized.length === 4) {
    const [, r, g, b] = normalized;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return normalized.slice(0, 7).toUpperCase();
}

function App() {
  const [page, setPage] = useState<PageId>(() => getPageFromHash());
  const [config, setConfig] = useState<TagConfig>(defaultTagConfig);
  const [atemschutzConfig, setAtemschutzConfig] = useState<AtemschutzConfig>(defaultAtemschutzConfig);
  const [dienststellungskennzeichenFormId, setDienststellungskennzeichenFormId] =
    useState<DienststellungskennzeichenFormId>("molle-hook-v1");
  const [dienststellungskennzeichenBadgeId, setDienststellungskennzeichenBadgeId] = useState(
    thwDienststellungskennzeichen[0]?.id ?? "",
  );
  const [dienststellungskennzeichenConfig, setDienststellungskennzeichenConfig] = useState<TagConfig>(
    buildDienststellungskennzeichenConfig("molle-hook-v1"),
  );
  const [fwNdsDienstgradBadgeId, setFwNdsDienstgradBadgeId] = useState(
    fwNdsBerufsfeuerwehr[0]?.id ?? "",
  );
  const [fwNdsDienstgradConfig, setFwNdsDienstgradConfig] = useState<TagConfig>(buildFwNdsDienstgradConfig());
  const [savedSets, setSavedSets] = useState<SavedSet[]>(() => readSavedSets());
  const [saveFeedbackKind, setSaveFeedbackKind] = useState<SaveFeedbackKind>(null);
  const [bedWidth, setBedWidth] = useState(256);
  const [bedHeight, setBedHeight] = useState(256);
  const [topSideOnBed, setTopSideOnBed] = useState(false);
  const [isBuildingSet, setIsBuildingSet] = useState(false);
  const [isBuildingAtemschutz, setIsBuildingAtemschutz] = useState(false);
  const [isBuildingDienststellungskennzeichen, setIsBuildingDienststellungskennzeichen] = useState(false);
  const [isBuildingFwNdsDienstgrad, setIsBuildingFwNdsDienstgrad] = useState(false);
  const [symbolLayers, setSymbolLayers] = useState<SymbolLayer[] | null>(null);
  const [labelLayers, setLabelLayers] = useState<SymbolLayer[] | null>(null);
  const [dienststellungskennzeichenLayers, setDienststellungskennzeichenLayers] = useState<SymbolLayer[] | null>(null);
  const [fwNdsDienstgradLayers, setFwNdsDienstgradLayers] = useState<SymbolLayer[] | null>(null);
  const [dienststellungskennzeichenStatus, setDienststellungskennzeichenStatus] = useState("Kennzeichen wird geladen");
  const [fwNdsDienstgradStatus, setFwNdsDienstgradStatus] = useState("Dienstgrad wird geladen");
  const [symbolStatus, setSymbolStatus] = useState("Symbol wird geladen");
  const [selectedCategory, setSelectedCategory] = useState(
    symbolCatalog.find((symbol) => symbol.id === defaultTagConfig.symbolId)?.category ??
      symbolCatalog[0]?.category ??
      "",
  );
  const activePage = pages.find((entry) => entry.id === page) ?? pages[0];

  useEffect(() => {
    const handleHashChange = () => setPage(getPageFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    document.title = `goerdys 3D-Tools - ${activePage.label}`;
  }, [activePage.label]);

  useEffect(() => {
    if (!saveFeedbackKind) return;
    const timer = window.setTimeout(() => setSaveFeedbackKind(null), 1400);
    return () => window.clearTimeout(timer);
  }, [saveFeedbackKind]);

  useEffect(() => {
    const handleStorage = () => setSavedSets(readSavedSets());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const navigate = (nextPage: PageId) => {
    if (page === nextPage) return;
    window.location.hash = nextPage;
  };

  const update = (patch: Partial<TagConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  };
  const updateAtemschutz = (patch: Partial<AtemschutzConfig>) => {
    setAtemschutzConfig((current) => ({ ...current, ...patch }));
  };
  const applyAtemschutzPreset = (preset: AtemschutzConfig) => {
    setAtemschutzConfig(preset);
  };
  const applyDienststellungskennzeichenForm = (formId: DienststellungskennzeichenFormId) => {
    setDienststellungskennzeichenFormId(formId);
    setDienststellungskennzeichenConfig((current) => ({
      ...buildDienststellungskennzeichenConfig(formId),
      labelText: current.labelText,
    }));
  };
  const saveCurrentSet = () => {
    setSavedSets((current) => {
      const nextSet: SavedTagSet = {
        kind: "taktische-zeichen",
        savedAt: new Date().toISOString(),
        quantity: 1,
        config: sanitizeSavedTagConfig(config),
      };
      const nextSavedSets = [nextSet, ...current];
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSavedSets));
      return nextSavedSets;
    });
    setSaveFeedbackKind("taktische-zeichen");
  };
  const saveCurrentAtemschutzSet = () => {
    setSavedSets((current) => {
      const nextSet: SavedAtemschutzSet = {
        kind: "atemschutz",
        savedAt: new Date().toISOString(),
        quantity: 1,
        config: sanitizeSavedAtemschutzConfig(atemschutzConfig),
      };
      const nextSavedSets = [nextSet, ...current];
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSavedSets));
      return nextSavedSets;
    });
    setSaveFeedbackKind("atemschutz");
  };
  const saveCurrentDienststellungskennzeichenSet = () => {
    setSavedSets((current) => {
      const nextSet: SavedDienststellungskennzeichenSet = {
        kind: "dienststellungskennzeichen-thw",
        savedAt: new Date().toISOString(),
        quantity: 1,
        badgeId: dienststellungskennzeichenBadgeId,
        formId: dienststellungskennzeichenFormId,
        config: {
          ...buildDienststellungskennzeichenConfig(dienststellungskennzeichenFormId),
          ...dienststellungskennzeichenConfig,
        },
      };
      const nextSavedSets = [nextSet, ...current];
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSavedSets));
      return nextSavedSets;
    });
    setSaveFeedbackKind("dienststellungskennzeichen-thw");
  };
  const saveCurrentFwNdsDienstgradSet = () => {
    setSavedSets((current) => {
      const nextSet: SavedFwNdsDienstgradSet = {
        kind: "dienstgrade-fw-nds",
        savedAt: new Date().toISOString(),
        quantity: 1,
        badgeId: fwNdsDienstgradBadgeId,
        config: {
          ...buildFwNdsDienstgradConfig(),
          ...fwNdsDienstgradConfig,
        },
      };
      const nextSavedSets = [nextSet, ...current];
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSavedSets));
      return nextSavedSets;
    });
    setSaveFeedbackKind("dienstgrade-fw-nds");
  };
  const updateSavedSetQuantity = (index: number, quantity: number) => {
    setSavedSets((current) => {
      const nextSets = current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, quantity } : entry,
      );
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSets));
      return nextSets;
    });
  };
  const deleteSavedSet = (index: number) => {
    setSavedSets((current) => {
      const nextSets = current.filter((_, entryIndex) => entryIndex !== index);
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSets));
      return nextSets;
    });
  };
  const downloadSavedSet = async (entry: SavedSet) => {
    if (entry.kind === "atemschutz") {
      await downloadAtemschutz3mf(entry.config);
      return;
    }

    if (entry.kind === "dienststellungskennzeichen-thw") {
      const badge = thwDienststellungskennzeichen.find((candidate) => candidate.id === entry.badgeId);
      if (!badge) return;
      const layers = await loadDienststellungskennzeichenLayers(badge.path, entry.config, entry.formId);
      download3mf(entry.config, layers);
      return;
    }

    if (entry.kind === "dienstgrade-fw-nds") {
      const badge = fwNdsBerufsfeuerwehr.find((candidate) => candidate.id === entry.badgeId);
      if (!badge) return;
      const layers = await loadFwNdsDienstgradLayers(badge.path, entry.config);
      download3mf(entry.config, layers);
      return;
    }

    const selected = symbolCatalog.find((symbol) => symbol.id === entry.config.symbolId) ?? symbolCatalog[0];
    if (!selected) return;

    const [layers, textLayers] = await Promise.all([
      loadSymbolLayers(selected.path, entry.config),
      loadLabelLayers(entry.config.labelText, entry.config),
    ]);
    const decorative = [...textLayers, ...layers];
    download3mf(entry.config, decorative.length > 0 ? decorative : undefined);
  };
  const downloadSavedSetCollection = async () => {
    if (!savedSets.length || isBuildingSet) return;
    setIsBuildingSet(true);
    await waitForUiPaint();

    try {
      const layerCache = new Map<
        string,
        Promise<{
          symbolLayers: SymbolLayer[] | undefined;
        }>
      >();

      const loadLayersForConfig = (savedSet: SavedTagSet) => {
        const cacheKey = JSON.stringify(savedSet.config);
        const existing = layerCache.get(cacheKey);
        if (existing) return existing;

        const selected = symbolCatalog.find((symbol) => symbol.id === savedSet.config.symbolId) ?? symbolCatalog[0];
        const promise = selected
          ? Promise.all([
              loadSymbolLayers(selected.path, savedSet.config),
              loadLabelLayers(savedSet.config.labelText, savedSet.config),
            ]).then(([layers, textLayers]) => ({
              symbolLayers: [...textLayers, ...layers],
            }))
          : Promise.resolve({ symbolLayers: undefined });

        layerCache.set(cacheKey, promise);
        return promise;
      };

      const loadLayersForDienststellungskennzeichen = (savedSet: SavedDienststellungskennzeichenSet) => {
        const cacheKey = `${savedSet.kind}:${savedSet.badgeId}:${JSON.stringify(savedSet.config)}`;
        const existing = layerCache.get(cacheKey);
        if (existing) return existing;

        const badge = thwDienststellungskennzeichen.find((candidate) => candidate.id === savedSet.badgeId);
        const promise = badge
          ? loadDienststellungskennzeichenLayers(badge.path, savedSet.config, savedSet.formId).then((layers) => ({
              symbolLayers: layers,
            }))
          : Promise.resolve({ symbolLayers: undefined });

        layerCache.set(cacheKey, promise);
        return promise;
      };

      const loadLayersForFwNdsDienstgrad = (savedSet: SavedFwNdsDienstgradSet) => {
        const cacheKey = `${savedSet.kind}:${savedSet.badgeId}:${JSON.stringify(savedSet.config)}`;
        const existing = layerCache.get(cacheKey);
        if (existing) return existing;

        const badge = fwNdsBerufsfeuerwehr.find((candidate) => candidate.id === savedSet.badgeId);
        const promise = badge
          ? loadFwNdsDienstgradLayers(badge.path, savedSet.config).then((layers) => ({
              symbolLayers: layers,
            }))
          : Promise.resolve({ symbolLayers: undefined });

        layerCache.set(cacheKey, promise);
        return promise;
      };

      const expandedItems = (
        await Promise.all(
          savedSets.flatMap((savedSet) =>
            Array.from({ length: savedSet.quantity }, async () => {
              if (savedSet.kind === "atemschutz") {
                return {
                  kind: "atemschutz",
                  config: savedSet.config,
                  width: savedSet.config.width,
                  height: savedSet.config.height,
                  thickness: savedSet.config.thickness,
                  x: 0,
                  y: 0,
                } satisfies PackedItem;
              }

              if (savedSet.kind === "dienststellungskennzeichen-thw") {
                const layers = await loadLayersForDienststellungskennzeichen(savedSet);
                return {
                  kind: "dienststellungskennzeichen-thw",
                  badgeId: savedSet.badgeId,
                  config: savedSet.config,
                  symbolLayers: layers.symbolLayers,
                  width: savedSet.config.width,
                  height: savedSet.config.height,
                  thickness: savedSet.config.baseThickness,
                  x: 0,
                  y: 0,
                } satisfies PackedItem;
              }

              if (savedSet.kind === "dienstgrade-fw-nds") {
                const layers = await loadLayersForFwNdsDienstgrad(savedSet);
                return {
                  kind: "dienstgrade-fw-nds",
                  badgeId: savedSet.badgeId,
                  config: savedSet.config,
                  symbolLayers: layers.symbolLayers,
                  width: savedSet.config.width,
                  height: savedSet.config.height,
                  thickness: savedSet.config.baseThickness,
                  x: 0,
                  y: 0,
                } satisfies PackedItem;
              }

              const layers = await loadLayersForConfig(savedSet);
              return {
                kind: "taktische-zeichen",
                config: savedSet.config,
                symbolLayers: layers.symbolLayers,
                width: savedSet.config.width,
                height: savedSet.config.height,
                thickness: savedSet.config.baseThickness,
                x: 0,
                y: 0,
              } satisfies PackedItem;
            }),
          ),
        )
      ).flat();

      const plates = packItemsForPlates(expandedItems, bedWidth, bedHeight).map((plate, index) => ({
        name: `platte-${index + 1}`,
        items: plate.map((item) => {
          const transform = topSideOnBed
            ? {
                x: item.x + item.width / 2,
                y: item.y + item.height,
                z: item.thickness,
                matrix: [1, 0, 0, 0, -1, 0, 0, 0, -1] as [
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                  number,
                ],
              }
            : {
                x: item.x + item.width / 2,
                y: item.y,
              };

          if (item.kind === "atemschutz") {
            return {
              kind: "atemschutz" as const,
              config: item.config as AtemschutzConfig,
              transform,
            };
          }

          if (item.kind === "dienststellungskennzeichen-thw") {
            return {
              kind: "dienststellungskennzeichen-thw" as const,
              config: item.config as TagConfig,
              symbolLayers: item.symbolLayers,
              transform,
            };
          }

          if (item.kind === "dienstgrade-fw-nds") {
            return {
              kind: "dienstgrade-fw-nds" as const,
              config: item.config as TagConfig,
              symbolLayers: item.symbolLayers,
              transform,
            };
          }

          return {
            kind: "taktische-zeichen" as const,
            config: item.config as TagConfig,
            symbolLayers: item.symbolLayers,
            transform,
          };
        }),
      }));

      await downloadBatch3mfSet(plates);
    } finally {
      setIsBuildingSet(false);
    }
  };
  const downloadAtemschutz = async () => {
    if (isBuildingAtemschutz) return;
    setIsBuildingAtemschutz(true);
    await waitForUiPaint();

    try {
      await downloadAtemschutz3mf(atemschutzConfig);
    } finally {
      setIsBuildingAtemschutz(false);
    }
  };
  const downloadDienststellungskennzeichen = async () => {
    if (isBuildingDienststellungskennzeichen) return;
    setIsBuildingDienststellungskennzeichen(true);
    await waitForUiPaint();

    try {
      if (!dienststellungskennzeichenLayers?.length) return;
      download3mf(dienststellungskennzeichenConfig, dienststellungskennzeichenLayers);
    } finally {
      setIsBuildingDienststellungskennzeichen(false);
    }
  };
  const downloadFwNdsDienstgrad = async () => {
    if (isBuildingFwNdsDienstgrad) return;
    setIsBuildingFwNdsDienstgrad(true);
    await waitForUiPaint();

    try {
      if (!fwNdsDienstgradLayers?.length) return;
      download3mf(fwNdsDienstgradConfig, fwNdsDienstgradLayers);
    } finally {
      setIsBuildingFwNdsDienstgrad(false);
    }
  };
  const applyBaseForm = (baseFormId: TagConfig["baseFormId"]) => {
    const preset = getBaseFormOption(baseFormId);
    setConfig((current) => ({
      ...current,
      baseFormId,
      ...preset.defaults,
      symbolScale: preset.defaults.symbolScale ?? 62,
    }));
  };

  const selectedSymbol = symbolCatalog.find((symbol) => symbol.id === config.symbolId) ?? symbolCatalog[0];
  const categories = useMemo(
    () => Array.from(new Set(symbolCatalog.map((symbol) => symbol.category))).sort((a, b) => a.localeCompare(b, "de")),
    [],
  );
  const categorySymbols = useMemo(
    () => symbolCatalog.filter((symbol) => symbol.category === selectedCategory),
    [selectedCategory],
  );

  useEffect(() => {
    if (!categorySymbols.length) return;
    if (!categorySymbols.some((symbol) => symbol.id === config.symbolId)) {
      update({ symbolId: categorySymbols[0].id });
    }
  }, [categorySymbols, config.symbolId]);

  useEffect(() => {
    let cancelled = false;
    setSymbolStatus("Symbol wird geladen");
    Promise.all([loadSymbolLayers(selectedSymbol.path, config), loadLabelLayers(config.labelText, config)])
      .then(([layers, textLayers]) => {
        if (cancelled) return;
        setSymbolLayers(layers);
        setLabelLayers(textLayers);
        const shapeCount = layers.reduce((sum, layer) => sum + layer.shapes.length, 0);
        const strokeCount = layers.reduce((sum, layer) => sum + layer.flatGeometries.length, 0);
        const textCount = textLayers.reduce((sum, layer) => sum + layer.shapes.length, 0);
        setSymbolStatus(
          `${layers.length} Farben, ${shapeCount} Fuellflaechen, ${strokeCount} Linienflaechen, ${textCount} Textformen geladen`,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSymbolLayers(null);
        setLabelLayers(null);
        setSymbolStatus(error instanceof Error ? error.message : "Symbol konnte nicht geladen werden");
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedSymbol.path,
    config.labelText,
    config.width,
    config.height,
    config.symbolScale,
    config.minLineThickness,
    config.symbolYOffset,
  ]);

  const selectedDienststellungskennzeichen =
    thwDienststellungskennzeichen.find((entry) => entry.id === dienststellungskennzeichenBadgeId) ??
    thwDienststellungskennzeichen[0];

  const selectedFwNdsDienstgrad =
    fwNdsBerufsfeuerwehr.find((entry) => entry.id === fwNdsDienstgradBadgeId) ?? fwNdsBerufsfeuerwehr[0];

  useEffect(() => {
    if (!selectedDienststellungskennzeichen) return;

    let cancelled = false;
    setDienststellungskennzeichenStatus("Kennzeichen wird geladen");
    loadDienststellungskennzeichenLayers(
      selectedDienststellungskennzeichen.path,
      dienststellungskennzeichenConfig,
      dienststellungskennzeichenFormId,
    )
      .then((layers) => {
        if (cancelled) return;
        setDienststellungskennzeichenLayers(layers);
        const shapeCount = layers.reduce((sum, layer) => sum + layer.shapes.length, 0);
        const strokeCount = layers.reduce((sum, layer) => sum + layer.flatGeometries.length, 0);
        setDienststellungskennzeichenStatus(
          `${layers.length} Farben, ${shapeCount} Fuellflaechen, ${strokeCount} Linienflaechen geladen`,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDienststellungskennzeichenLayers(null);
        setDienststellungskennzeichenStatus(
          error instanceof Error ? error.message : "Kennzeichen konnte nicht geladen werden",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedDienststellungskennzeichen?.path,
    dienststellungskennzeichenFormId,
    dienststellungskennzeichenConfig.labelText,
    dienststellungskennzeichenConfig.width,
    dienststellungskennzeichenConfig.height,
    dienststellungskennzeichenConfig.symbolScale,
    dienststellungskennzeichenConfig.minLineThickness,
    dienststellungskennzeichenConfig.symbolYOffset,
  ]);

  useEffect(() => {
    if (!selectedFwNdsDienstgrad) return;

    setFwNdsDienstgradConfig((current) => ({
      ...current,
      symbolScale: 100,
    }));
  }, [selectedFwNdsDienstgrad?.path]);

  useEffect(() => {
    if (!selectedFwNdsDienstgrad) return;

    let cancelled = false;
    getFwNdsBadgeAspectRatio(selectedFwNdsDienstgrad.path).then((aspectRatio) => {
      if (cancelled) return;
      const effectiveScale = (fwNdsDienstgradConfig.symbolScale * getFwNdsBaseScale(selectedFwNdsDienstgrad.path)) / 100;
      setFwNdsDienstgradConfig((current) => ({
        ...current,
        height: computeFwNdsKeychainHeight(
          current.width,
          aspectRatio,
          effectiveScale,
        ),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [selectedFwNdsDienstgrad?.path, fwNdsDienstgradConfig.width, fwNdsDienstgradConfig.symbolScale]);

  useEffect(() => {
    if (!fwNdsDienstgradLayers?.length) return;

    const bounds = getLayerBounds(fwNdsDienstgradLayers);
    if (!bounds) return;

    const nextHeight = Math.round((bounds.max.y + 3 + fwNdsDienstgradConfig.width / 2) * 2) / 2;
    if (Math.abs(nextHeight - fwNdsDienstgradConfig.height) < 0.1) return;

    setFwNdsDienstgradConfig((current) => {
      if (Math.abs(nextHeight - current.height) < 0.1) return current;
      return {
        ...current,
        height: nextHeight,
      };
    });
  }, [fwNdsDienstgradLayers, fwNdsDienstgradConfig.width, fwNdsDienstgradConfig.height]);

  useEffect(() => {
    if (!selectedFwNdsDienstgrad) return;

    let cancelled = false;
    setFwNdsDienstgradStatus("Dienstgrad wird geladen");
    loadFwNdsDienstgradLayers(selectedFwNdsDienstgrad.path, fwNdsDienstgradConfig)
      .then((layers) => {
        if (cancelled) return;
        setFwNdsDienstgradLayers(layers);
        const shapeCount = layers.reduce((sum, layer) => sum + layer.shapes.length, 0);
        const strokeCount = layers.reduce((sum, layer) => sum + layer.flatGeometries.length, 0);
        setFwNdsDienstgradStatus(
          `${layers.length} Farben, ${shapeCount} Fuellflaechen, ${strokeCount} Linienflaechen geladen`,
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFwNdsDienstgradLayers(null);
        setFwNdsDienstgradStatus(
          error instanceof Error ? error.message : "Dienstgrad konnte nicht geladen werden",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedFwNdsDienstgrad?.path,
    fwNdsDienstgradConfig.width,
    fwNdsDienstgradConfig.symbolScale,
  ]);

  const decorativeLayers = useMemo(
    () => [...(labelLayers ?? []), ...(symbolLayers ?? [])],
    [labelLayers, symbolLayers],
  );

  const inlayTop = useMemo(
    () => config.baseThickness,
    [config.baseThickness],
  );
  const hasSavedSets = savedSets.length > 0;

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-title-block">
          <p className="site-eyebrow">goerdys 3D-Tools</p>
          <h1>{activePage.label}</h1>
        </div>

        <nav className="site-nav" aria-label="Seitennavigation">
          {pages.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === page ? "nav-link active" : "nav-link"}
              onClick={() => navigate(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </header>

      {page === "taktische-zeichen" ? (
        <main className="app-shell">
          <aside className="sidebar">
            <div>
              <h2 className="section-kicker">Taktische Zeichen</h2>
              <p className="muted">
                Browser-only Entwurf fuer zweifarbige 3D-Druck-Tags.
              </p>
            </div>

            <section className="panel">
              <h2>Grundform</h2>
              <label className="field">
                <span>Form</span>
                <select
                  value={config.baseFormId}
                  onChange={(event) => applyBaseForm(event.target.value as TagConfig["baseFormId"])}
                >
                  {baseFormOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              {config.baseFormId === "schluesselanhaenger-klein" ? (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={config.doubleSided}
                    onChange={(event) => update({ doubleSided: event.target.checked })}
                  />
                  <span>Beidseitig</span>
                </label>
              ) : null}
            </section>

            <section className="panel">
              <h2>Taktisches Zeichen</h2>
              <label className="field">
                <span>Kategorie</span>
                <select
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Zeichen</span>
                <select
                  value={config.symbolId}
                  onChange={(event) => update({ symbolId: event.target.value })}
                >
                  {categorySymbols.map((symbol) => (
                    <option key={symbol.id} value={symbol.id}>
                      {symbol.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                {categorySymbols.length} Zeichen in dieser Kategorie, {symbolCatalog.length} insgesamt.
              </p>
              <p className="hint">
                {symbolStatus}. SVG-Text wird im Browser zu Pfaden gerendert.
              </p>
            </section>

            <section className="panel">
              <h2>Text</h2>
              <label className="field">
                <span>Beschriftung</span>
                <input
                  type="text"
                  value={config.labelText}
                  placeholder="Optionaler Text"
                  onChange={(event) => update({ labelText: event.target.value })}
                />
              </label>
            </section>

            <details className="panel details-panel">
              <summary>Details</summary>
              <div className="details-content">
                <section className="subpanel">
                  <NumberField
                    label="Breite mm"
                    value={config.width}
                    min={35}
                    max={90}
                    step={0.5}
                    onChange={(width) => update({ width })}
                  />
                  <NumberField
                    label="Hoehe mm"
                    value={config.height}
                    min={25}
                    max={70}
                    step={0.5}
                    onChange={(height) => update({ height })}
                  />
                  <NumberField
                    label="Grunddicke mm"
                    value={config.baseThickness}
                    min={1.6}
                    max={8}
                    step={0.1}
                    onChange={(baseThickness) => update({ baseThickness })}
                  />
                  <NumberField
                    label="Eckenradius mm"
                    value={config.cornerRadius}
                    min={0}
                    max={5}
                    step={0.1}
                    onChange={(cornerRadius) => update({ cornerRadius })}
                  />
                  {config.baseFormId === "magnet-neodyn-rueckseite" ? (
                    <>
                      <NumberField
                        label="Sackloch Ø mm"
                        value={config.magnetPocketDiameter}
                        min={2}
                        max={30}
                        step={0.1}
                        onChange={(magnetPocketDiameter) => update({ magnetPocketDiameter })}
                      />
                      <NumberField
                        label="Sackloch Tiefe mm"
                        value={config.magnetPocketDepth}
                        min={0.5}
                        max={6}
                        step={0.1}
                        onChange={(magnetPocketDepth) => update({ magnetPocketDepth })}
                      />
                    </>
                  ) : null}
                </section>

                <section className="subpanel">
                  <h2>Inlay</h2>
                  <NumberField
                    label="Inlay-Dicke mm"
                    value={config.inlayThickness}
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    onChange={(inlayThickness) => update({ inlayThickness })}
                  />
                  <NumberField
                    label="Linien min. mm"
                    value={config.minLineThickness}
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    onChange={(minLineThickness) => update({ minLineThickness })}
                  />
                  <NumberField
                    label="Symbolgroesse %"
                    value={config.symbolScale}
                    min={35}
                    max={95}
                    step={1}
                    onChange={(symbolScale) => update({ symbolScale })}
                  />
                  <NumberField
                    label="Symbol-Y mm"
                    value={config.symbolYOffset}
                    min={-10}
                    max={10}
                    step={0.1}
                    onChange={(symbolYOffset) => update({ symbolYOffset })}
                  />
                  <label className="field color-field">
                    <span>Grundfarbe</span>
                    <input
                      type="color"
                      value={config.baseColor}
                      onChange={(event) => update({ baseColor: event.target.value })}
                    />
                  </label>
                  <label className="field color-field">
                    <span>Inlay-Farbe</span>
                    <output>aus SVG</output>
                  </label>
                  <p className="hint">
                    Inlay-Oberkante: {inlayTop.toFixed(2)} mm, Tasche:{" "}
                    {config.inlayThickness.toFixed(2)} mm tief. 3MF-Objektnamen enthalten die jeweilige Farbe.
                  </p>
                </section>
              </div>
            </details>

            <div className="button-row">
              <button
                className="primary-button"
                onClick={() => download3mf(config, decorativeLayers.length > 0 ? decorativeLayers : undefined)}
              >
                3MF herunterladen
              </button>
              <button className="secondary-button" onClick={saveCurrentSet}>
                {saveFeedbackKind === "taktische-zeichen" ? "Zum Stapel hinzugefügt" : "Auf Stapel legen"}
              </button>
            </div>
          </aside>

          <section className="preview-area">
            <TagPreview
              config={config}
              symbolLayers={decorativeLayers.length > 0 ? decorativeLayers : undefined}
            />
          </section>
        </main>
      ) : page === "dienststellungskennzeichen-thw" ? (
        <main className="app-shell">
          <aside className="sidebar">
            <div>
              <h2 className="section-kicker">Dienststellungskennzeichen THW</h2>
              <p className="muted">
                Feste THW-Kennzeichen auf blauer Grundform, wahlweise als MOLLE-Tag oder Schlüsselanhänger.
              </p>
            </div>

            <section className="panel">
              <h2>Grundform</h2>
              <label className="field">
                <span>Form</span>
                <select
                  value={dienststellungskennzeichenFormId}
                  onChange={(event) =>
                    applyDienststellungskennzeichenForm(
                      event.target.value as DienststellungskennzeichenFormId,
                    )
                  }
                >
                  <option value="molle-hook-v1">MOLLE Haken V1</option>
                  <option value="schluesselanhaenger">Schlüsselanhänger</option>
                </select>
              </label>
            </section>

            <section className="panel">
              <h2>Kennzeichen</h2>
              <label className="field">
                <span>Auswahl</span>
                <select
                  value={dienststellungskennzeichenBadgeId}
                  onChange={(event) => setDienststellungskennzeichenBadgeId(event.target.value)}
                >
                  <optgroup label="Zug">
                    {thwDienststellungskennzeichen
                      .filter((entry) => entry.group === "Zug")
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Stab">
                    {thwDienststellungskennzeichen
                      .filter((entry) => entry.group === "Stab")
                      .map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </label>
              {dienststellungskennzeichenFormId === "molle-hook-v1" ? (
                <label className="field">
                  <span>Text</span>
                  <input
                    type="text"
                    value={dienststellungskennzeichenConfig.labelText}
                    placeholder="Optionaler Text"
                    onChange={(event) =>
                      setDienststellungskennzeichenConfig((current) => ({
                        ...current,
                        labelText: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
              <p className="hint">{dienststellungskennzeichenStatus}.</p>
            </section>

            <div className="button-row">
              <button
                type="button"
                className={
                  isBuildingDienststellungskennzeichen ? "primary-button busy-button" : "primary-button"
                }
                disabled={isBuildingDienststellungskennzeichen || !dienststellungskennzeichenLayers?.length}
                onClick={() => void downloadDienststellungskennzeichen()}
              >
                {isBuildingDienststellungskennzeichen ? "3MF wird erzeugt..." : "3MF herunterladen"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={saveCurrentDienststellungskennzeichenSet}
              >
                {saveFeedbackKind === "dienststellungskennzeichen-thw"
                  ? "Zum Stapel hinzugefügt"
                  : "Auf Stapel legen"}
              </button>
            </div>
          </aside>

          <section className="preview-area">
            <TagPreview
              config={dienststellungskennzeichenConfig}
              symbolLayers={dienststellungskennzeichenLayers ?? undefined}
            />
          </section>
        </main>
      ) : page === "dienstgrade-fw-nds" ? (
        <main className="app-shell">
          <aside className="sidebar">
            <div>
              <h2 className="section-kicker">Dienstgrade FW NDS</h2>
              <p className="muted">
                Berufsfeuerwehr Niedersachsen, aktuell als Schlüsselanhänger.
              </p>
            </div>

            <section className="panel">
              <h2>Dienstgrad</h2>
              <label className="field">
                <span>Auswahl</span>
                <select
                  value={fwNdsDienstgradBadgeId}
                  onChange={(event) => setFwNdsDienstgradBadgeId(event.target.value)}
                >
                  {fwNdsBerufsfeuerwehrGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.entries.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={fwNdsDienstgradConfig.doubleSided}
                  onChange={(event) =>
                    setFwNdsDienstgradConfig((current) => ({
                      ...current,
                      doubleSided: event.target.checked,
                    }))
                  }
                />
                <span>Beidseitig</span>
              </label>
              <p className="hint">{fwNdsDienstgradStatus}.</p>
            </section>

            <details className="panel details-panel">
              <summary>Details</summary>
              <div className="details-content">
                <section className="subpanel">
                  <NumberField
                    label="Breite mm"
                    value={fwNdsDienstgradConfig.width}
                    min={20}
                    max={60}
                    step={0.5}
                    onChange={(width) =>
                      setFwNdsDienstgradConfig((current) => ({
                        ...current,
                        width,
                      }))
                    }
                  />
                  <label className="field">
                    <span>Laenge mm (auto)</span>
                    <input type="number" value={fwNdsDienstgradConfig.height} readOnly />
                  </label>
                  <NumberField
                    label="Dicke mm"
                    value={fwNdsDienstgradConfig.baseThickness}
                    min={1.5}
                    max={8}
                    step={0.1}
                    onChange={(baseThickness) =>
                      setFwNdsDienstgradConfig((current) => ({
                        ...current,
                        baseThickness,
                      }))
                    }
                  />
                  <NumberField
                    label="Inlay-Dicke mm"
                    value={fwNdsDienstgradConfig.inlayThickness}
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    onChange={(inlayThickness) =>
                      setFwNdsDienstgradConfig((current) => ({
                        ...current,
                        inlayThickness,
                      }))
                    }
                  />
                  <NumberField
                    label="Grafikgroesse %"
                    value={fwNdsDienstgradConfig.symbolScale}
                    min={40}
                    max={120}
                    step={1}
                    onChange={(symbolScale) =>
                      setFwNdsDienstgradConfig((current) => ({
                        ...current,
                        symbolScale,
                      }))
                    }
                  />
                </section>
              </div>
            </details>

            <div className="button-row">
              <button
                type="button"
                className={isBuildingFwNdsDienstgrad ? "primary-button busy-button" : "primary-button"}
                disabled={isBuildingFwNdsDienstgrad || !fwNdsDienstgradLayers?.length}
                onClick={() => void downloadFwNdsDienstgrad()}
              >
                {isBuildingFwNdsDienstgrad ? "3MF wird erzeugt..." : "3MF herunterladen"}
              </button>
              <button type="button" className="secondary-button" onClick={saveCurrentFwNdsDienstgradSet}>
                {saveFeedbackKind === "dienstgrade-fw-nds" ? "Zum Stapel hinzugefügt" : "Auf Stapel legen"}
              </button>
            </div>
          </aside>

          <section className="preview-area">
            <TagPreview config={fwNdsDienstgradConfig} symbolLayers={fwNdsDienstgradLayers ?? undefined} />
          </section>
        </main>
      ) : page === "atemschutz" ? (
        <main className="app-shell">
          <aside className="sidebar">
            <div>
              <h2 className="section-kicker">Atemschutz</h2>
              <p className="muted">
                Browser-only Entwurf fuer lange Atemschutz-Anhaenger mit frei einstellbaren Textfarben.
              </p>
            </div>

            <section className="panel">
              <h2>Presets</h2>
              <div className="button-row">
                {atemschutzPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="secondary-button"
                    onClick={() => applyAtemschutzPreset(preset.config)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2>Haupttext</h2>
              <label className="field">
                <span>Zeile 1</span>
                <input
                  type="text"
                  value={atemschutzConfig.mainTextLine1}
                  onChange={(event) => updateAtemschutz({ mainTextLine1: event.target.value })}
                />
              </label>
              <label className="field color-field">
                <span>Farbe Zeile 1</span>
                <input
                  type="color"
                  value={atemschutzConfig.mainTextLine1Color}
                  onChange={(event) => updateAtemschutz({ mainTextLine1Color: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Zeile 2</span>
                <input
                  type="text"
                  value={atemschutzConfig.mainTextLine2}
                  onChange={(event) => updateAtemschutz({ mainTextLine2: event.target.value })}
                />
              </label>
              <label className="field color-field">
                <span>Farbe Zeile 2</span>
                <input
                  type="color"
                  value={atemschutzConfig.mainTextLine2Color}
                  onChange={(event) => updateAtemschutz({ mainTextLine2Color: event.target.value })}
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={atemschutzConfig.mainTextSeparator}
                  onChange={(event) => updateAtemschutz({ mainTextSeparator: event.target.checked })}
                />
                <span>Horizontale Linie zwischen Zeile 1 und 2</span>
              </label>
              <p className="hint">
                Ist nur eine Zeile gefuellt, nutzt sie die volle Breite. Zwei Zeilen werden laengs nebeneinander gesetzt.
              </p>
            </section>

            <section className="panel">
              <h2>Unterer Text</h2>
              <label className="field">
                <span>Kurztext 1</span>
                <input
                  type="text"
                  value={atemschutzConfig.bottomTextLine1}
                  onChange={(event) => updateAtemschutz({ bottomTextLine1: event.target.value })}
                />
              </label>
              <label className="field color-field">
                <span>Farbe Kurztext 1</span>
                <input
                  type="color"
                  value={atemschutzConfig.bottomTextLine1Color}
                  onChange={(event) => updateAtemschutz({ bottomTextLine1Color: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Kurztext 2</span>
                <input
                  type="text"
                  value={atemschutzConfig.bottomTextLine2}
                  onChange={(event) => updateAtemschutz({ bottomTextLine2: event.target.value })}
                />
              </label>
              <label className="field color-field">
                <span>Farbe Kurztext 2</span>
                <input
                  type="color"
                  value={atemschutzConfig.bottomTextLine2Color}
                  onChange={(event) => updateAtemschutz({ bottomTextLine2Color: event.target.value })}
                />
              </label>
            </section>

            <details className="panel details-panel">
              <summary>Details</summary>
              <div className="details-content">
                <section className="subpanel">
                  <NumberField
                    label="Breite mm"
                    value={atemschutzConfig.width}
                    min={15}
                    max={60}
                    step={0.5}
                    onChange={(width) => updateAtemschutz({ width })}
                  />
                  <NumberField
                    label="Laenge mm"
                    value={atemschutzConfig.height}
                    min={60}
                    max={180}
                    step={1}
                    onChange={(height) => updateAtemschutz({ height })}
                  />
                  <NumberField
                    label="Dicke mm"
                    value={atemschutzConfig.thickness}
                    min={1.5}
                    max={8}
                    step={0.1}
                    onChange={(thickness) => updateAtemschutz({ thickness })}
                  />
                  <NumberField
                    label="Loch mm"
                    value={atemschutzConfig.holeDiameter}
                    min={2}
                    max={15}
                    step={0.1}
                    onChange={(holeDiameter) => updateAtemschutz({ holeDiameter })}
                  />
                  <NumberField
                    label="Lochabstand oben mm"
                    value={atemschutzConfig.holeOffsetFromTop}
                    min={5}
                    max={30}
                    step={0.5}
                    onChange={(holeOffsetFromTop) => updateAtemschutz({ holeOffsetFromTop })}
                  />
                  <NumberField
                    label="Eckenradius mm"
                    value={atemschutzConfig.cornerRadius}
                    min={0}
                    max={12}
                    step={0.1}
                    onChange={(cornerRadius) => updateAtemschutz({ cornerRadius })}
                  />
                  <NumberField
                    label="Textdicke mm"
                    value={atemschutzConfig.textThickness}
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    onChange={(textThickness) => updateAtemschutz({ textThickness })}
                  />
                  <label className="field color-field">
                    <span>Grundfarbe</span>
                    <input
                      type="color"
                      value={atemschutzConfig.baseColor}
                      onChange={(event) => updateAtemschutz({ baseColor: event.target.value })}
                    />
                  </label>
                </section>
              </div>
            </details>

            <div className="button-row">
              <button
                type="button"
                className={isBuildingAtemschutz ? "primary-button busy-button" : "primary-button"}
                disabled={isBuildingAtemschutz}
                onClick={() => void downloadAtemschutz()}
              >
                {isBuildingAtemschutz ? "3MF wird erzeugt..." : "3MF herunterladen"}
              </button>
              <button type="button" className="secondary-button" onClick={saveCurrentAtemschutzSet}>
                {saveFeedbackKind === "atemschutz" ? "Zum Stapel hinzugefügt" : "Auf Stapel legen"}
              </button>
              {isBuildingAtemschutz ? (
                <p className="hint busy-hint">3MF-Datei wird erzeugt. Bitte warten.</p>
              ) : null}
            </div>
          </aside>

          <section className="preview-area">
            <AtemschutzPreview config={atemschutzConfig} />
          </section>
        </main>
      ) : (
        <main className="placeholder-page">
          {page === "stapelverarbeitung" ? (
            <section className="panel stack-card">
              <h2>Gespeicherte Parametersets</h2>
              {hasSavedSets ? (
                <div className="table-wrap">
                  <table className="stack-table">
                    <thead>
                      <tr>
                        <th>Menge</th>
                        <th>Zeitpunkt</th>
                        <th>Typ</th>
                        <th>Details</th>
                        <th>Maße</th>
                        <th>Grundfarbe</th>
                        <th>Aktionen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedSets.map((entry, index) => (
                        <tr key={`${entry.savedAt}-${index}`}>
                          <td>
                            <input
                              className="stack-qty-input"
                              type="number"
                              min={1}
                              step={1}
                              value={entry.quantity}
                              onChange={(event) =>
                                updateSavedSetQuantity(index, Math.max(1, Number(event.target.value) || 1))
                              }
                            />
                          </td>
                          <td>{formatSavedAt(entry.savedAt)}</td>
                          <td>{getSavedSetTypeLabel(entry)}</td>
                          <td>{getSavedSetDescription(entry)}</td>
                          <td>{getSavedSetDimensions(entry)}</td>
                          <td>{getSavedSetBaseColor(entry)}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="row-button"
                                onClick={() => void downloadSavedSet(entry)}
                              >
                                3MF
                              </button>
                              <button
                                type="button"
                                className="row-button danger"
                                onClick={() => deleteSavedSet(index)}
                              >
                                Löschen
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">Noch keine Parametersets im Stapel abgelegt.</p>
              )}

              <section className="stack-controls">
                <h2>Druckbett</h2>
                <div className="stack-bed-grid">
                  <NumberField
                    label="Breite mm"
                    value={bedWidth}
                    min={50}
                    max={500}
                    step={1}
                    onChange={(value) => setBedWidth(value)}
                  />
                  <NumberField
                    label="Höhe mm"
                    value={bedHeight}
                    min={50}
                    max={500}
                    step={1}
                    onChange={(value) => setBedHeight(value)}
                  />
                </div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={topSideOnBed}
                    onChange={(event) => setTopSideOnBed(event.target.checked)}
                  />
                  <span>Oberseite auf Druckbett</span>
                </label>
                <button
                  type="button"
                  className={isBuildingSet ? "primary-button busy-button" : "primary-button"}
                  disabled={!hasSavedSets || isBuildingSet}
                  onClick={() => void downloadSavedSetCollection()}
                >
                  {isBuildingSet ? "Set wird erzeugt..." : "Set downloaden"}
                </button>
                {isBuildingSet ? (
                  <p className="hint busy-hint">3MF-Dateien werden erzeugt. Bitte warten.</p>
                ) : null}
              </section>
            </section>
          ) : page === "ueber-impressum" ? (
            <section className="placeholder-card">
              <SectionCard title="Über">
                <div className="text-stack">
                  <p className="muted">
                    Projekt von Philipp &quot;goerdy&quot; Gürth auf pq5.de.
                  </p>
                  <p className="muted">
                    Der Quellcode liegt auf GitHub:{" "}
                    <a href={sourceCodeUrl} target="_blank" rel="noreferrer">
                      {sourceCodeUrl}
                    </a>
                  </p>
                  <p className="muted">
                    Vibecoding-Projekt mit <strong>gpt-5.4-mini</strong>.
                  </p>
                  <p className="muted">Lizenz des Quellcodes: CC-BY.</p>
                  <p className="muted">Vielen Dank für die Nutzung und das Feedback.</p>
                </div>
              </SectionCard>

              <SectionCard title="Credits">
                <div className="text-stack">
                  <p className="muted">
                    Quellen der verwendeten taktischen Zeichen:{" "}
                    <a href={projectLinkUrl} target="_blank" rel="noreferrer">
                      {projectLinkUrl}
                    </a>
                  </p>
                  <p className="muted">
                    Die verwendeten taktischen Zeichen stehen unter CC0 1.0.
                  </p>
                  <p className="muted">
                    Die THW-Dienststellungskennzeichen stammen von Wikimedia Commons, wurden von
                    Thiemo Schuff erstellt und stehen unter CC0 1.0 / Public Domain Dedication.
                  </p>
                  <p className="muted">Der Quellcode dieses Projekts steht unter CC-BY.</p>
                  <p className="muted">
                    Verwendete Bibliotheken:
                  </p>
                  <ul className="plain-list">
                    {runtimeLibraries.map((library) => (
                      <li key={library}>{library}</li>
                    ))}
                  </ul>
                </div>
              </SectionCard>

              <SectionCard title="Support">
                <div className="text-stack">
                  <p className="muted">
                    Wenn dir das Projekt hilft und du die Weiterentwicklung unterstützen möchtest:
                  </p>
                  <div className="support-actions">
                    <a
                      className="support-button"
                      href="https://paypal.me/PhilippGuerth"
                      target="_blank"
                      rel="noreferrer"
                    >
                      PayPal
                    </a>
                    <a
                      href="https://buymeacoffee.com/goerdy"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        className="support-image"
                        src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
                        alt="Buy Me a Coffee"
                      />
                    </a>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Datenschutz">
                <div className="text-stack">
                  <p className="muted">
                    Alle eingegebenen Daten werden ausschließlich lokal im Browser verarbeitet.
                  </p>
                  <p className="muted">
                    Eine Übermittlung an Server oder Dritte findet nicht statt.
                  </p>
                  <p className="muted">
                    Es werden keine Formulardaten auf einem Server gespeichert oder ausgewertet.
                  </p>
                </div>
              </SectionCard>

              <SectionCard title="Urheberrecht">
                <div className="text-stack">
                  <p className="muted">
                    Ich habe die verwendeten Quellen, insbesondere Symbole und taktische Zeichen,
                    nach bestem Wissen sorgfältig geprüft.
                  </p>
                  <p className="muted">
                    Sollten dennoch Rechte Dritter verletzt worden sein, bitte ich um einen
                    Hinweis an{" "}
                    <a href="mailto:3D-Tools@philipp-guerth.de">3D-Tools@philipp-guerth.de</a>.
                    Ich werde die betreffenden Inhalte dann umgehend prüfen und gegebenenfalls
                    anpassen oder entfernen.
                  </p>
                </div>
              </SectionCard>

              <SectionCard title="Impressum">
                <div className="text-stack">
                  <p className="muted">
                    Philipp Gürth
                    <br />
                    Pulvermacherei 1
                    <br />
                    26434 Wangerland
                    <br />
                    <a href="mailto:3D-Tools@philipp-guerth.de">3D-Tools@philipp-guerth.de</a>
                  </p>
                  <p className="muted">
                    Verantwortlich für den Inhalt nach § 5 TMG.
                  </p>
                  <p className="muted">
                    Dieses Angebot ist ein privates Projekt ohne Gewähr auf Vollständigkeit,
                    Richtigkeit oder dauerhafte Verfügbarkeit.
                  </p>
                  <p className="muted">
                    Disclaimer: Keine Haftung für Schäden, die direkt oder indirekt aus der
                    Nutzung dieser Inhalte entstehen.
                  </p>
                </div>
              </SectionCard>
            </section>
          ) : (
            <section className="panel placeholder-card">
              <h2>Kommt noch</h2>
              <p className="muted">
                Diese Seite ist noch nicht umgesetzt. Hier entsteht bald Inhalt fuer{" "}
                {activePage.label}.
              </p>
            </section>
          )}
        </main>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
