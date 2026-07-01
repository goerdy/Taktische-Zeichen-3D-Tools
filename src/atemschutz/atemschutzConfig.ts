export type AtemschutzConfig = {
  width: number;
  height: number;
  thickness: number;
  holeDiameter: number;
  holeOffsetFromTop: number;
  cornerRadius: number;
  textThickness: number;
  baseColor: string;
  mainTextLine1: string;
  mainTextLine2: string;
  bottomTextLine1: string;
  bottomTextLine2: string;
  mainTextLine1Color: string;
  mainTextLine2Color: string;
  mainTextSeparator: boolean;
  bottomTextLine1Color: string;
  bottomTextLine2Color: string;
};

export const defaultAtemschutzConfig: AtemschutzConfig = {
  width: 25,
  height: 107,
  thickness: 3,
  holeDiameter: 7,
  holeOffsetFromTop: 10,
  cornerRadius: 3,
  textThickness: 0.4,
  baseColor: "#1D4ED8",
  mainTextLine1: "M. Mustermann",
  mainTextLine2: "OV MUSTERSTADT",
  bottomTextLine1: "AGT",
  bottomTextLine2: "CBRN",
  mainTextLine1Color: "#FFFFFF",
  mainTextLine2Color: "#FFFFFF",
  mainTextSeparator: true,
  bottomTextLine1Color: "#FFFFFF",
  bottomTextLine2Color: "#FFFFFF",
};
