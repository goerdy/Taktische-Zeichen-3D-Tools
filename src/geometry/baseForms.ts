import type { TagConfig } from "./tagConfig";

export type BaseFormId = "molle-hook-v1" | "c-profil-40" | "c-profil-50" | "schluesselanhaenger-klein";

export type BaseFormOption = {
  id: BaseFormId;
  name: string;
  defaults: Partial<TagConfig>;
};

export const baseFormOptions: BaseFormOption[] = [
  {
    id: "molle-hook-v1",
    name: "MOLLE Haken V1",
    defaults: {
      width: 55,
      height: 37,
      baseThickness: 4,
      cornerRadius: 1.5,
      hookDepth: 10,
      hookStep: 5,
    },
  },
  {
    id: "c-profil-40",
    name: "C-Profil 40mm",
    defaults: {
      width: 34,
      height: 36,
      baseThickness: 0.6,
      cornerRadius: 1,
      hookDepth: 0,
      hookStep: 0,
      symbolScale: 95,
      baseColor: "#FFFFFF",
    },
  },
  {
    id: "c-profil-50",
    name: "C-Profil 50mm",
    defaults: {
      width: 44,
      height: 46,
      baseThickness: 0.6,
      cornerRadius: 1,
      hookDepth: 0,
      hookStep: 0,
      symbolScale: 90,
      baseColor: "#FFFFFF",
    },
  },
  {
    id: "schluesselanhaenger-klein",
    name: "Schlüsselanhänger klein",
    defaults: {
      width: 30,
      height: 40,
      baseThickness: 3,
      cornerRadius: 1.5,
      hookDepth: 0,
      hookStep: 0,
      symbolScale: 90,
      symbolYOffset: 5,
      doubleSided: false,
      baseColor: "#FFFFFF",
    },
  },
];

export function getBaseFormOption(id: BaseFormId) {
  return baseFormOptions.find((option) => option.id === id) ?? baseFormOptions[0];
}
