import type { ItemNode } from "./types";

export const MIN_GAP_Y = 24;
export const LEVEL_GAP_X = 120; // Espaçamento horizontal constante e uniforme entre níveis
export const DEFAULT_NODE_WIDTH = 200;
export const DEFAULT_NODE_HEIGHT = 46;

// Retrocompatibilidade para arquivos que importam COL_W e ROW_H
export const COL_W = DEFAULT_NODE_WIDTH + LEVEL_GAP_X;
export const ROW_H = DEFAULT_NODE_HEIGHT + MIN_GAP_Y;

export interface NodeDimensions {
  width: number;
  height: number;
}

/**
 * Estima as dimensões (largura e altura) de um nó com base em seu texto,
 * quebras de linha e badges associados. Utilizado como fallback instantâneo
 * antes da medição real do DOM via ResizeObserver.
 */
export function estimateNodeSize(item: ItemNode, isRoot: boolean): NodeDimensions {
  if (isRoot) {
    const text = item.title || "Sem título";
    const paragraphs = text.split("\n");
    let totalLines = 0;
    for (const p of paragraphs) {
      totalLines += Math.max(1, Math.ceil(p.length / 20));
    }
    const estLines = Math.max(1, totalLines);
    const maxLineLen = paragraphs.reduce((m, p) => Math.max(m, p.length), 0);
    const width = Math.min(340, Math.max(200, Math.min(maxLineLen * 10 + 60, 340)));
    const height = 48 + (estLines - 1) * 24;
    return { width, height };
  }

  const text = item.title || "Novo ramo";
  const paragraphs = text.split("\n");
  let totalLines = 0;
  for (const p of paragraphs) {
    totalLines += Math.max(1, Math.ceil(p.length / 22));
  }
  const textLines = Math.max(1, totalLines);

  let height = 38 + (textLines - 1) * 20;

  const hasBadges =
    item.type === "PAGE" ||
    !!item.status ||
    !!item.schedule?.start_time ||
    (item.attachments?.length ?? 0) > 0 ||
    (item.links?.length ?? 0) > 0;
  if (hasBadges) {
    height += 24;
  }

  const maxLineLen = paragraphs.reduce((m, p) => Math.max(m, p.length), 0);
  const width = Math.min(260, Math.max(160, Math.min(maxLineLen * 8 + 88, 260)));

  return { width, height };
}

interface SubtreeLayout {
  id: string;
  width: number;
  height: number;
  subtreeHeight: number;
  nodeCenterY: number;
  relTop?: number;
  relCenter?: number;
  children: SubtreeLayout[];
}

/**
 * Algoritmo Hierárquico Determinístico com Altura Dinâmica e Bounding Box Real
 *
 * 1. Altura Real Dinâmica: Utiliza as dimensões reais medidas no DOM (ou estimadas) para cada nó.
 * 2. Espaçamento Vertical Fixo (minGapY): y_proximo = y_atual + height_atual + minGapY
 * 3. Espaçamento Horizontal Uniforme (levelGapX):
 *    x_filho = x_pai + width_pai + levelGapX (ou x_filho = x_pai - levelGapX - width_filho à esquerda)
 * 4. Centralização do Pai: O nó pai é alinhado no ponto médio vertical de seus filhos.
 */
export function layoutTree(
  items: Record<string, ItemNode> | ItemNode[],
  rootId: string,
  collapsed: Set<string> = new Set(),
  dimensionMap?: Map<string, NodeDimensions> | Record<string, NodeDimensions>,
): Record<string, { x: number; y: number }> {
  const rawList = Array.isArray(items) ? items : Object.values(items);
  // Formas de processo possuem posicionamento livre e são excluídas do layout de árvore
  const list = rawList.filter((it) => it.id === rootId || !it.canvas?.shape);
  const itemsMap = new Map(list.map((it) => [it.id, it]));
  const kids = new Map<string, ItemNode[]>();

  for (const it of list) {
    if (!it.parent_id) continue;
    const arr = kids.get(it.parent_id) ?? [];
    arr.push(it);
    kids.set(it.parent_id, arr);
  }
  for (const arr of kids.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order);
  }

  const root = itemsMap.get(rootId);
  const origin = root?.canvas ?? { x: 0, y: 0 };
  const pos: Record<string, { x: number; y: number }> = {};

  function getNodeSize(id: string): NodeDimensions {
    if (dimensionMap) {
      const d = dimensionMap instanceof Map ? dimensionMap.get(id) : dimensionMap[id];
      if (d && d.width > 0 && d.height > 0) return d;
    }
    const it = itemsMap.get(id);
    return estimateNodeSize(it || ({ title: "" } as ItemNode), id === rootId);
  }

  const rootDim = getNodeSize(rootId);

  function computeSubtree(id: string): SubtreeLayout {
    const isCollapsed = collapsed.has(id);
    const childItems = isCollapsed ? [] : kids.get(id) ?? [];
    const dim = getNodeSize(id);

    if (childItems.length === 0) {
      return {
        id,
        width: dim.width,
        height: dim.height,
        subtreeHeight: dim.height,
        nodeCenterY: dim.height / 2,
        children: [],
      };
    }

    const childLayouts = childItems.map((c) => computeSubtree(c.id));
    let runningY = 0;

    for (let i = 0; i < childLayouts.length; i++) {
      const cl = childLayouts[i];
      cl.relTop = runningY;
      cl.relCenter = runningY + cl.nodeCenterY;
      runningY += cl.subtreeHeight;
      if (i < childLayouts.length - 1) {
        runningY += MIN_GAP_Y;
      }
    }

    const childrenTotalHeight = runningY;
    const firstCenter = childLayouts[0].relCenter!;
    const lastCenter = childLayouts[childLayouts.length - 1].relCenter!;
    const parentCenterY = (firstCenter + lastCenter) / 2;
    const subtreeHeight = Math.max(dim.height, childrenTotalHeight);

    return {
      id,
      width: dim.width,
      height: dim.height,
      subtreeHeight,
      nodeCenterY: parentCenterY,
      children: childLayouts,
    };
  }

  function assignPositions(
    subtree: SubtreeLayout,
    parentX: number,
    parentWidth: number,
    boxTop: number,
    dir: 1 | -1,
  ) {
    const childX =
      dir === 1 ? parentX + parentWidth + LEVEL_GAP_X : parentX - LEVEL_GAP_X - subtree.width;
    const childY = boxTop + subtree.nodeCenterY - subtree.height / 2;
    pos[subtree.id] = { x: childX, y: childY };

    for (const child of subtree.children) {
      assignPositions(child, childX, subtree.width, boxTop + child.relTop!, dir);
    }
  }

  function placeSide(children: ItemNode[], dir: 1 | -1) {
    if (!children.length) return;
    const subtreeLayouts = children.map((c) => computeSubtree(c.id));
    let curY = 0;

    for (let i = 0; i < subtreeLayouts.length; i++) {
      const sl = subtreeLayouts[i];
      sl.relTop = curY;
      sl.relCenter = curY + sl.nodeCenterY;
      curY += sl.subtreeHeight;
      if (i < subtreeLayouts.length - 1) {
        curY += MIN_GAP_Y;
      }
    }

    const firstCenter = subtreeLayouts[0].relCenter!;
    const lastCenter = subtreeLayouts[subtreeLayouts.length - 1].relCenter!;
    const sideMidpoint = (firstCenter + lastCenter) / 2;
    const rootCenterY = origin.y + rootDim.height / 2;
    const yOffset = rootCenterY - sideMidpoint;

    for (const sl of subtreeLayouts) {
      assignPositions(sl, origin.x, rootDim.width, yOffset + sl.relTop!, dir);
    }
  }

  const rootKids = collapsed.has(rootId) ? [] : kids.get(rootId) ?? [];
  let rightKids: ItemNode[] = [];
  let leftKids: ItemNode[] = [];

  const hasCanvas = rootKids.some((k) => k.canvas && k.canvas.x !== origin.x);
  if (hasCanvas) {
    rightKids = rootKids.filter((k) => (k.canvas?.x ?? origin.x + 1) >= origin.x);
    leftKids = rootKids.filter((k) => (k.canvas?.x ?? origin.x + 1) < origin.x);
  } else {
    const half = Math.ceil(rootKids.length / 2);
    rightKids = rootKids.slice(0, half);
    leftKids = rootKids.slice(half);
  }

  placeSide(rightKids, 1);
  placeSide(leftKids, -1);
  pos[rootId] = { x: origin.x, y: origin.y };

  return pos;
}
