export function resolveSymbolAssetPath(path: string) {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = path.replace(/^\/+/, "").replace(/^public\//, "");
  if (normalizedBase === "/") return `/${normalizedPath}`;
  return `${normalizedBase}${normalizedPath}`;
}
