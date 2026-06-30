import { parse as parseFont, type Font } from "opentype.js";

const fontCache = new Map<string, Font>();

export async function inlineSvgTextAsPaths(svgText: string): Promise<string> {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = document.documentElement;
  const font = parseEmbeddedFont(svgText);

  if (!font) return svgText;

  for (const textElement of Array.from(svg.querySelectorAll("text"))) {
    const pathData = textElementToPathData(textElement, font);
    if (!pathData) continue;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", textElement.getAttribute("fill") ?? "#000000");
    path.setAttribute("stroke", textElement.getAttribute("stroke") ?? "none");
    if (textElement.getAttribute("transform")) {
      path.setAttribute("transform", textElement.getAttribute("transform")!);
    }
    textElement.replaceWith(path);
  }

  return new XMLSerializer().serializeToString(svg);
}

function parseEmbeddedFont(svgText: string): opentype.Font | null {
  const match = svgText.match(/data:application\/font-woff[^,]*,([^")]+)/);
  if (!match) return null;

  const base64 = match[1];
  const cached = fontCache.get(base64);
  if (cached) return cached;

  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const font = parseFont(buffer);
  fontCache.set(base64, font);
  return font;
}

function textElementToPathData(textElement: SVGTextElement, font: opentype.Font) {
  const text = textElement.textContent ?? "";
  if (!text.trim()) return "";

  const style = parseStyle(textElement.getAttribute("style") ?? "");
  const fontSize = Number.parseFloat(
    textElement.getAttribute("font-size") ?? style["font-size"] ?? "32",
  );
  const x = Number.parseFloat(textElement.getAttribute("x") ?? "0");
  const y = Number.parseFloat(textElement.getAttribute("y") ?? "0");
  const anchor = textElement.getAttribute("text-anchor") ?? style["text-anchor"] ?? "start";
  const advance = font.getAdvanceWidth(text, fontSize);
  const startX = anchor === "middle" ? x - advance / 2 : anchor === "end" ? x - advance : x;

  return font.getPath(text, startX, y, fontSize).toPathData(3);
}

function parseStyle(style: string) {
  return Object.fromEntries(
    style
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, value] = entry.split(":");
        return [key.trim(), value.trim()];
      }),
  );
}
