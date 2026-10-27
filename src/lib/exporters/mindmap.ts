import type { ItemNode } from "../types";
import { descendantsOf } from "../store";

export const ENTUSIS_EXPORT_FORMAT = "entusis.mindmap";
export const ENTUSIS_EXPORT_VERSION = 2;

export type ProcessAnchor = "right" | "bottom" | "left" | "top";

export interface ProcessConnectionExport {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  sourceAnchor: ProcessAnchor;
  targetAnchor: ProcessAnchor;
  sourceHandle: string;
  targetHandle: string;
  type: "smoothstep" | "default";
  color?: string | null;
}

/**
 * Lossless mind-map and process flow backup. Readable back by `parseMindMapJson`
 * (see importers/mindmap.ts → "Êntusis Export Parser").
 */
export interface MindMapExport {
  format: typeof ENTUSIS_EXPORT_FORMAT;
  version: number;
  exported_at: string;
  title: string;
  root_id: string;
  items: ItemNode[];
  edges: ProcessConnectionExport[];
  connections: ProcessConnectionExport[];
}

/** Builds the export document for a map: the root + its whole subtree + all process shapes and their connectors. */
export function buildMindMapExport(items: Record<string, ItemNode>, rootId: string): MindMapExport {
  const root = items[rootId];
  if (!root) throw new Error("Mapa mental não encontrado.");

  // 1. Árvore do mapa mental e descendentes
  const subtree = [root, ...descendantsOf(items, rootId)];
  const inMapIds = new Set(subtree.map((n) => n.id));

  // 2. Formas de processo pertencentes ao escopo deste canvas
  // Inclui nós com canvas.shape cujo parent_id é rootId, ou pertencem ao project_id, ou estão conectados a nós do mapa
  const processNodes = Object.values(items).filter((it) => {
    if (!it.canvas?.shape) return false;
    if (inMapIds.has(it.id)) return false;
    return (
      it.parent_id === rootId ||
      (Boolean(root.project_id) && it.project_id === root.project_id) ||
      it.links?.some((l) => inMapIds.has(l)) ||
      subtree.some((s) => s.links?.includes(it.id))
    );
  });

  const allNodes = [...subtree, ...processNodes];
  const allIds = new Set(allNodes.map((n) => n.id));

  // 3. Serialização limpa e completa de todos os nós (árvore + entidades de processo)
  const exported = allNodes.map((n) => {
    const isRoot = n.id === rootId;
    return {
      ...n,
      // Se for a raiz, parent_id é null; caso contrário mantém o parent_id se estiver no escopo ou aponta para rootId
      parent_id: isRoot ? null : n.parent_id && allIds.has(n.parent_id) ? n.parent_id : rootId,
      // Mantém links internos que apontam para nós exportados
      links: (n.links ?? []).filter((l) => allIds.has(l)),
      canvas: n.canvas
        ? {
            x: Math.round(n.canvas.x),
            y: Math.round(n.canvas.y),
            color: n.canvas.color ?? null,
            shape: n.canvas.shape ?? null,
            width: n.canvas.width ? Math.round(n.canvas.width) : null,
            height: n.canvas.height ? Math.round(n.canvas.height) : null,
          }
        : null,
    };
  });

  // 4. Conexões e arestas entre nós e formas (com fromNodeId, toNodeId e âncoras de ligação calculadas)
  const edges: ProcessConnectionExport[] = [];
  const edgeSet = new Set<string>();

  for (const it of exported) {
    for (const targetId of it.links) {
      if (!allIds.has(targetId)) continue;
      const edgeKey = `${it.id}->${targetId}`;
      if (edgeSet.has(edgeKey)) continue;
      edgeSet.add(edgeKey);

      const targetItem = items[targetId];
      const isProcess = Boolean(it.canvas?.shape || targetItem?.canvas?.shape);

      // Calcula dimensões e centroides para determinar âncoras de ligação
      const sC = it.canvas;
      const tC = targetItem?.canvas;

      const sX = sC?.x ?? 0;
      const sY = sC?.y ?? 0;
      const tX = tC?.x ?? 0;
      const tY = tC?.y ?? 0;

      const sW = sC?.width || (sC?.shape === "diamond" ? 140 : sC?.shape === "circle" ? 130 : 160);
      const sH = sC?.height || (sC?.shape === "diamond" ? 100 : sC?.shape === "circle" ? 70 : 80);
      const tW = tC?.width || (tC?.shape === "diamond" ? 140 : tC?.shape === "circle" ? 130 : 160);
      const tH = tC?.height || (tC?.shape === "diamond" ? 100 : tC?.shape === "circle" ? 70 : 80);

      const sCenterX = sX + sW / 2;
      const sCenterY = sY + sH / 2;
      const tCenterX = tX + tW / 2;
      const tCenterY = tY + tH / 2;

      const dx = tCenterX - sCenterX;
      const dy = tCenterY - sCenterY;

      let sourceAnchor: ProcessAnchor;
      let targetAnchor: ProcessAnchor;

      if (Math.abs(dx) >= Math.abs(dy)) {
        sourceAnchor = dx >= 0 ? "right" : "left";
        targetAnchor = dx >= 0 ? "left" : "right";
      } else {
        sourceAnchor = dy >= 0 ? "bottom" : "top";
        targetAnchor = dy >= 0 ? "top" : "bottom";
      }

      edges.push({
        id: `edge-${it.id}-${targetId}`,
        fromNodeId: it.id,
        toNodeId: targetId,
        sourceAnchor,
        targetAnchor,
        sourceHandle: `${sourceAnchor}-s`,
        targetHandle: `${targetAnchor}-t`,
        type: isProcess ? "smoothstep" : "default",
        color: targetItem?.canvas?.color || it.canvas?.color || "#94a3b8",
      });
    }
  }

  return {
    format: ENTUSIS_EXPORT_FORMAT,
    version: ENTUSIS_EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    title: root.title || "Mapa mental",
    root_id: rootId,
    items: exported,
    edges,
    connections: edges,
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
