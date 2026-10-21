import type { ItemNode } from "../types";
import { descendantsOf } from "../store";

export const ENTUSIS_EXPORT_FORMAT = "entusis.mindmap";
export const ENTUSIS_EXPORT_VERSION = 1;

/**
 * Lossless mind-map backup. Readable back by `parseMindMapJson`
 * (see importers/mindmap.ts → "Êntusis Export Parser").
 */
export interface MindMapExport {
  format: typeof ENTUSIS_EXPORT_FORMAT;
  version: number;
  exported_at: string;
  title: string;
  root_id: string;
  items: ItemNode[];
}

/** Builds the export document for a map: the root + its whole subtree. */
export function buildMindMapExport(items: Record<string, ItemNode>, rootId: string): MindMapExport {
  const root = items[rootId];
  if (!root) throw new Error("Mapa mental não encontrado.");

  const subtree = [root, ...descendantsOf(items, rootId)];
  const inMap = new Set(subtree.map((n) => n.id));

  // Root first, then parents before children (stable for any reader).
  const exported = subtree.map((n) => ({
    ...n,
    // The map's root may live under another page — detach it in the file.
    parent_id: n.id === rootId ? null : n.parent_id,
    // Keep only links that point inside the exported map.
    links: n.links.filter((l) => inMap.has(l)),
  }));

  return {
    format: ENTUSIS_EXPORT_FORMAT,
    version: ENTUSIS_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    title: root.title || "Mapa mental",
    root_id: rootId,
    items: exported,
  };
}

/** File-system-safe slug for the download name. */
function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60) || "mapa-mental"
  );
}

/** Triggers a browser download of the map as a .json file. Returns the node count. */
export function downloadMindMapJson(items: Record<string, ItemNode>, rootId: string): number {
  const doc = buildMindMapExport(items, rootId);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = doc.exported_at.slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(doc.title)}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return doc.items.length;
}
