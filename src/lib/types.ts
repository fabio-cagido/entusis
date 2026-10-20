/**
 * Core data model — every element of the system is an ItemNode.
 * Pages, mind-map nodes, tasks and events share the same shape so a single
 * record can be shown as a page, a canvas node, a Kanban card or a calendar entry.
 */

export type ItemType = "PAGE" | "MINDMAP_NODE" | "TASK" | "EVENT";
export type Status = "BACKLOG" | "TODO" | "DOING" | "DONE";
export type ViewKind = "PAGE" | "CANVAS" | "BOARD";

export const ITEM_TYPES: ItemType[] = ["PAGE", "MINDMAP_NODE", "TASK", "EVENT"];
export const STATUSES: Status[] = ["BACKLOG", "TODO", "DOING", "DONE"];

export const TYPE_LABEL: Record<ItemType, string> = {
  PAGE: "Página",
  MINDMAP_NODE: "Nó de mapa",
  TASK: "Tarefa",
  EVENT: "Evento",
};

export const STATUS_LABEL: Record<Status, string> = {
  BACKLOG: "Backlog",
  TODO: "A fazer",
  DOING: "Fazendo",
  DONE: "Concluído",
};

export interface Schedule {
  start_time: string | null; // ISO datetime
  end_time: string | null; // ISO datetime
  google_event_id: string | null; // bidirectional mapping (Phase 3)
}

export type AttachmentKind = "drive" | "file" | "web";

export interface Attachment {
  id: string;
  url: string;
  label: string;
  kind: AttachmentKind;
}

export interface CanvasMeta {
  x: number;
  y: number;
  color?: string | null;
}

export interface ItemNode {
  id: string;
  title: string;
  /** Rich text body (HTML produced by the editor). */
  content: string;
  icon: string | null;
  type: ItemType;
  parent_id: string | null;
  project_id: string | null;
  /** null = not tracked on Kanban. Any non-null status makes the item a Kanban card. */
  status: Status | null;
  /** Pinned to the "To Do Today" dashboard. */
  is_today: boolean;
  schedule: Schedule;
  attachments: Attachment[];
  /** UUIDs of other linked ItemNodes. */
  links: string[];
  canvas: CanvasMeta | null;
  /** Which view opens when the item is clicked in the sidebar. */
  default_view: ViewKind;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: string;
  page_id?: string | null;
}

export const emptySchedule = (): Schedule => ({
  start_time: null,
  end_time: null,
  google_event_id: null,
});
