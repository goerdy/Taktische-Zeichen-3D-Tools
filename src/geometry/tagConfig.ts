export type TagConfig = {
  baseFormId: "molle-hook-v1" | "c-profil-40" | "c-profil-50" | "schluesselanhaenger-klein";
  width: number;
  height: number;
  baseThickness: number;
  cornerRadius: number;
  hookDepth: number;
  hookStep: number;
  inlayThickness: number;
  minLineThickness: number;
  symbolScale: number;
  symbolYOffset: number;
  doubleSided: boolean;
  symbolId: string;
  labelText: string;
  baseColor: string;
  inlayColor: string;
};

export const defaultTagConfig: TagConfig = {
  baseFormId: "molle-hook-v1",
  width: 55,
  height: 37,
  baseThickness: 4,
  cornerRadius: 1.5,
  hookDepth: 10,
  hookStep: 5,
  inlayThickness: 0.4,
  minLineThickness: 0.65,
  symbolScale: 62,
  symbolYOffset: 0,
  doubleSided: false,
  symbolId: "thw-einheiten-1-bergungsgruppe",
  labelText: "",
  baseColor: "#D9DDE3",
  inlayColor: "#f5f5f5",
};
