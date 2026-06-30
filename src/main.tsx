import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { TagPreview } from "./preview/TagPreview";
import type { TagConfig } from "./geometry/tagConfig";
import { defaultTagConfig } from "./geometry/tagConfig";
import { baseFormOptions, getBaseFormOption } from "./geometry/baseForms";
import { download3mf, download3mfSet } from "./export/export3mf";
import { symbolCatalog } from "./symbols/catalog";
import { loadLabelLayers } from "./symbols/loadLabelShapes";
import { loadSymbolLayers } from "./symbols/loadSymbolShapes";
import type { SymbolLayer } from "./symbols/symbolLayer";

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

type SavedTagSet = {
  savedAt: string;
  quantity: number;
  config: TagConfig;
};

type PackedItem = {
  config: TagConfig;
  symbolLayers?: SymbolLayer[];
  width: number;
  height: number;
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

function readSavedSets(): SavedTagSet[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(savedSetStorageKey);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];

      const candidate = entry as Partial<SavedTagSet> & { config?: Partial<TagConfig> };
      if (typeof candidate.savedAt !== "string" || !candidate.config) return [];

      return [
        {
          savedAt: candidate.savedAt,
          quantity: typeof candidate.quantity === "number" && candidate.quantity > 0 ? candidate.quantity : 1,
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

function sanitizeSavedConfig(config: TagConfig): TagConfig {
  return {
    ...config,
    inlayColor: defaultTagConfig.inlayColor,
  };
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

function App() {
  const [page, setPage] = useState<PageId>(() => getPageFromHash());
  const [config, setConfig] = useState<TagConfig>(defaultTagConfig);
  const [savedSets, setSavedSets] = useState<SavedTagSet[]>(() => readSavedSets());
  const [bedWidth, setBedWidth] = useState(256);
  const [bedHeight, setBedHeight] = useState(256);
  const [topSideOnBed, setTopSideOnBed] = useState(false);
  const [isBuildingSet, setIsBuildingSet] = useState(false);
  const [symbolLayers, setSymbolLayers] = useState<SymbolLayer[] | null>(null);
  const [labelLayers, setLabelLayers] = useState<SymbolLayer[] | null>(null);
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
  const saveCurrentSet = () => {
    setSavedSets((current) => {
      const nextSet: SavedTagSet = {
        savedAt: new Date().toISOString(),
        quantity: 1,
        config: sanitizeSavedConfig(config),
      };
      const nextSavedSets = [nextSet, ...current];
      window.localStorage.setItem(savedSetStorageKey, JSON.stringify(nextSavedSets));
      return nextSavedSets;
    });
  };
  const updateSavedSet = (index: number, patch: Partial<SavedTagSet>) => {
    setSavedSets((current) => {
      const nextSets = current.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              ...patch,
              config: patch.config
                ? sanitizeSavedConfig({
                    ...entry.config,
                    ...patch.config,
                  })
                : entry.config,
            }
          : entry,
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
  const downloadSavedSet = async (entry: SavedTagSet) => {
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

      const expandedItems = (
        await Promise.all(
          savedSets.flatMap((savedSet) =>
            Array.from({ length: savedSet.quantity }, async () => {
              const layers = await loadLayersForConfig(savedSet);
              return {
                config: savedSet.config,
                symbolLayers: layers.symbolLayers,
                width: savedSet.config.width,
                height: savedSet.config.height,
                x: 0,
                y: 0,
              } satisfies PackedItem;
            }),
          ),
        )
      ).flat();

      const plates = packItemsForPlates(expandedItems, bedWidth, bedHeight).map((plate, index) => ({
        name: `platte-${index + 1}`,
        items: plate.map((item) => ({
          config: item.config,
          symbolLayers: item.symbolLayers,
          transform: topSideOnBed
            ? {
                x: item.x + item.width / 2,
                y: item.y + item.height,
                z: item.config.baseThickness,
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
              },
        })),
      }));

      download3mfSet(plates);
    } finally {
      setIsBuildingSet(false);
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
                Auf Stapel legen
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
                        <th>Grundform</th>
                        <th>Zeichen</th>
                        <th>Beschriftung</th>
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
                                updateSavedSet(index, {
                                  quantity: Math.max(1, Number(event.target.value) || 1),
                                })
                              }
                            />
                          </td>
                          <td>{formatSavedAt(entry.savedAt)}</td>
                          <td>{getBaseFormName(entry.config.baseFormId)}</td>
                          <td>{getSymbolName(entry.config.symbolId)}</td>
                          <td>{entry.config.labelText || "-"}</td>
                          <td>
                            {entry.config.width} x {entry.config.height} mm
                          </td>
                          <td>{entry.config.baseColor}</td>
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
                    Vibecoding-Projekt mit <strong>gpt-5.4-mini</strong>.
                  </p>
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
                    Verwendete Bibliotheken:
                  </p>
                  <ul className="plain-list">
                    {runtimeLibraries.map((library) => (
                      <li key={library}>{library}</li>
                    ))}
                  </ul>
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
