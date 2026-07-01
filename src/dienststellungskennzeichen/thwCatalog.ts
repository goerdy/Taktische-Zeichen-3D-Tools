export type DienststellungskennzeichenFormId = "molle-hook-v1" | "schluesselanhaenger";

export type ThwDienststellungskennzeichenEntry = {
  id: string;
  name: string;
  group: "Zug" | "Stab";
  path: string;
};

export const thwDienststellungskennzeichen: ThwDienststellungskennzeichenEntry[] = [
  {
    id: "helfer",
    name: "Helfer",
    group: "Zug",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_helfer.svg",
  },
  {
    id: "truppfuehrer",
    name: "Truppführer",
    group: "Zug",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_truppfuehrer.svg",
  },
  {
    id: "gruppenfuehrer",
    name: "Gruppenführer",
    group: "Zug",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_gruppenfuehrer.svg",
  },
  {
    id: "zugtruppfuehrer",
    name: "Zugtruppführer",
    group: "Zug",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_zugtruppfuehrer.svg",
  },
  {
    id: "zugfuehrer",
    name: "Zugführer",
    group: "Zug",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_zugfuehrer.svg",
  },
  {
    id: "verwaltungshelfer",
    name: "Verwaltungshelfer",
    group: "Stab",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_verwaltungshelfer.svg",
  },
  {
    id: "schirrmeister",
    name: "Schirrmeister",
    group: "Stab",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_schirmeister.svg",
  },
  {
    id: "fachberater",
    name: "Fachberater",
    group: "Stab",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_fachberater.svg",
  },
  {
    id: "stellv-ortsbeauftragter",
    name: "stellv. Ortsbeauftragter",
    group: "Stab",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_stelv_ortsbearuftragter.svg",
  },
  {
    id: "ortsbeauftragter",
    name: "Ortsbeauftragter",
    group: "Stab",
    path: "/dienststellungskennzeichen/thw/Thw_dienststellungskennzeichen_ortsbeauftragter.svg",
  },
];
