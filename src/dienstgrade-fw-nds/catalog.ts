export type FwNdsDienstgradEntry = {
  id: string;
  name: string;
  group: string;
  path: string;
};

export const fwNdsBerufsfeuerwehr: FwNdsDienstgradEntry[] = [
  {
    id: "bm",
    name: "Brandmeister",
    group: "Mittlerer Dienst",
    path: "/FW-NDS/BF/MittlererDienst/BM.svg",
  },
  {
    id: "obm",
    name: "Oberbrandmeister",
    group: "Mittlerer Dienst",
    path: "/FW-NDS/BF/MittlererDienst/OBM.svg",
  },
  {
    id: "hbm",
    name: "Hauptbrandmeister",
    group: "Mittlerer Dienst",
    path: "/FW-NDS/BF/MittlererDienst/HBM.svg",
  },
  {
    id: "hbmz",
    name: "Hauptbrandmeister mit Zulage",
    group: "Mittlerer Dienst",
    path: "/FW-NDS/BF/MittlererDienst/HBMz.svg",
  },
  {
    id: "bi",
    name: "Brandinspektor",
    group: "Gehobener Dienst",
    path: "/FW-NDS/BF/GehobenerDienst/BI.svg",
  },
  {
    id: "boi",
    name: "Brandoberinspektor",
    group: "Gehobener Dienst",
    path: "/FW-NDS/BF/GehobenerDienst/BOI.svg",
  },
  {
    id: "boia",
    name: "Brandoberinspektor A",
    group: "Gehobener Dienst",
    path: "/FW-NDS/BF/GehobenerDienst/BOIA.svg",
  },
  {
    id: "bam",
    name: "Brandamtmann",
    group: "Gehobener Dienst",
    path: "/FW-NDS/BF/GehobenerDienst/BAM.svg",
  },
  {
    id: "bar",
    name: "Brandamtsrat",
    group: "Gehobener Dienst",
    path: "/FW-NDS/BF/GehobenerDienst/BAR.svg",
  },
];

export const fwNdsBerufsfeuerwehrGroups = Array.from(
  fwNdsBerufsfeuerwehr.reduce((groups, entry) => {
    const items = groups.get(entry.group) ?? [];
    items.push(entry);
    groups.set(entry.group, items);
    return groups;
  }, new Map<string, FwNdsDienstgradEntry[]>()),
).map(([label, entries]) => ({ label, entries }));
