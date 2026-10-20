import type { ItemNode } from "./types";

export const COL_W = 250;
export const ROW_H = 62;

/**
 * Bilateral mind-map layout: root at origin, first half of its children
 * branch to the right and the second half to the left; deeper levels follow
 * their branch side. Returns positions relative to the root's current position.
 */
export function layoutTree(
  items: Record<string, ItemNode> | ItemNode[],
  rootId: string,
  collapsed: Set<string> = new Set(),
): Record<string, { x: number; y: number }> {
  const list = Array.isArray(items) ? items : Object.values(items);
  const kids = new Map<string, ItemNode[]>();
  for (const it of list) {
    if (!it.parent_id) continue;
    const arr = kids.get(it.parent_id) ?? [];
    arr.push(it);
    kids.set(it.parent_id, arr);
  }
  for (const arr of kids.values()) arr.sort((a, b) => a.sort_order - b.sort_order);

  const root = list.find((i) => i.id === rootId);
  const origin = root?.canvas ?? { x: 0, y: 0 };
  const pos: Record<string, { x: number; y: number }> = {};

  const placeSide = (children: ItemNode[], dir: 1 | -1) => {
    let cursor = 0;
    const local: Record<string, { x: number; y: number }> = {};
    const place = (id: string, depth: number): number => {
      const cs = collapsed.has(id) ? [] : kids.get(id) ?? [];
      if (!cs.length) {
        const y = cursor;
        cursor += ROW_H;
        local[id] = { x: depth * COL_W * dir, y };
        return y;
      }
      const ys = cs.map((c) => place(c.id, depth + 1));
      const y = (ys[0] + ys[ys.length - 1]) / 2;
      local[id] = { x: depth * COL_W * dir, y };
      return y;
    };
    children.forEach((c) => place(c.id, 1));
    // Center this side vertically around the root.
    const offset = cursor > 0 ? (cursor - ROW_H) / 2 : 0;
    for (const [id, p] of Object.entries(local)) pos[id] = { x: origin.x + p.x, y: origin.y + p.y - offset };
  };

  const first = collapsed.has(rootId) ? [] : kids.get(rootId) ?? [];
  const half = Math.ceil(first.length / 2);
  placeSide(first.slice(0, half), 1);
  placeSide(first.slice(half), -1);
  pos[rootId] = { x: origin.x, y: origin.y };
  return pos;
}
