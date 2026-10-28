import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemNode, ItemShare, Project } from "../types";
import type { RemoteChange, Repository, Snapshot } from "./types";

/* Row shapes in Postgres (schedule and links are flattened / normalised). */
interface ItemRow {
  id: string;
  user_id?: string;
  title: string;
  content: string;
  icon: string | null;
  type: ItemNode["type"];
  parent_id: string | null;
  project_id: string | null;
  status: ItemNode["status"];
  is_today: boolean;
  start_time: string | null;
  end_time: string | null;
  google_event_id: string | null;
  attachments: ItemNode["attachments"];
  links: string[];
  canvas: ItemNode["canvas"];
  default_view: ItemNode["default_view"];
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_TYPES = new Set<ItemNode["type"]>(["PAGE", "MINDMAP_NODE", "TASK", "EVENT"]);
const VALID_STATUSES = new Set<NonNullable<ItemNode["status"]>>(["BACKLOG", "TODO", "DOING", "DONE"]);
const VALID_VIEWS = new Set<ItemNode["default_view"]>(["PAGE", "CANVAS", "BOARD"]);

const toRow = (n: ItemNode, userId: string): ItemRow => {
  const nowIso = new Date().toISOString();
  return {
    id: n.id,
    user_id: n.user_id && UUID_RE.test(n.user_id) ? n.user_id : userId,
    title: typeof n.title === "string" ? n.title : "",
    content: typeof n.content === "string" ? n.content : "",
    icon: n.icon ?? null,
    type: VALID_TYPES.has(n.type) ? n.type : "PAGE",
    parent_id: n.parent_id && UUID_RE.test(n.parent_id) ? n.parent_id : null,
    project_id: n.project_id && UUID_RE.test(n.project_id) ? n.project_id : null,
    status: n.status && VALID_STATUSES.has(n.status) ? n.status : null,
    is_today: Boolean(n.is_today),
    start_time: n.schedule?.start_time || null,
    end_time: n.schedule?.end_time || null,
    google_event_id: n.schedule?.google_event_id || null,
    attachments: Array.isArray(n.attachments) ? n.attachments : [],
    links: Array.isArray(n.links) ? n.links.filter((l) => typeof l === "string" && UUID_RE.test(l)) : [],
    canvas: n.canvas ?? null,
    default_view: VALID_VIEWS.has(n.default_view) ? n.default_view : "PAGE",
    sort_order: typeof n.sort_order === "number" && Number.isFinite(n.sort_order) ? n.sort_order : 0,
    created_at: n.created_at || nowIso,
    updated_at: n.updated_at || nowIso,
  };
};

const fromRow = (r: ItemRow): ItemNode => ({
  id: r.id,
  user_id: r.user_id,
  title: r.title ?? "",
  content: r.content ?? "",
  icon: r.icon,
  type: r.type,
  parent_id: r.parent_id,
  project_id: r.project_id,
  status: r.status,
  is_today: !!r.is_today,
  schedule: {
    start_time: r.start_time,
    end_time: r.end_time,
    google_event_id: r.google_event_id,
  },
  attachments: r.attachments ?? [],
  links: r.links ?? [],
  canvas: r.canvas,
  default_view: r.default_view ?? "PAGE",
  sort_order: r.sort_order ?? 0,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  private static readonly PAGE_SIZE = 1000;
  private static readonly CHUNK_SIZE = 200;

  constructor(private client: SupabaseClient, private userId: string) {}

  private async fetchAllRows<T>(table: string): Promise<T[]> {
    const allRows: T[] = [];
    let from = 0;

    while (true) {
      const to = from + SupabaseRepository.PAGE_SIZE - 1;
      const { data, error } = await this.client
        .from(table)
        .select("*")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);

      if (error) throw error;
      const batch = (data as T[]) ?? [];
      allRows.push(...batch);

      if (batch.length < SupabaseRepository.PAGE_SIZE) {
        break;
      }
      from += SupabaseRepository.PAGE_SIZE;
    }

    return allRows;
  }

  async loadAll(): Promise<Snapshot> {
    const [itemRows, projectRows, shareRows] = await Promise.all([
      this.fetchAllRows<ItemRow>("item_nodes"),
      this.fetchAllRows<Project>("projects"),
      this.fetchAllRows<ItemShare>("item_node_shares").catch(() => [] as ItemShare[]),
    ]);
    return {
      items: itemRows.map(fromRow),
      projects: projectRows,
      shares: shareRows,
      currentUserId: this.userId,
    };
  }

  async upsertItems(items: ItemNode[]) {
    if (!items.length) return;
    const rows = items.map((i) => toRow(i, this.userId));
    for (let i = 0; i < rows.length; i += SupabaseRepository.CHUNK_SIZE) {
      const chunk = rows.slice(i, i + SupabaseRepository.CHUNK_SIZE);
      const { error } = await this.client.from("item_nodes").upsert(chunk);
      if (error) throw error;
    }
  }

  async deleteItems(ids: string[]) {
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += SupabaseRepository.CHUNK_SIZE) {
      const chunk = ids.slice(i, i + SupabaseRepository.CHUNK_SIZE);
      const { error } = await this.client.from("item_nodes").delete().in("id", chunk);
      if (error) throw error;
    }
  }

  async upsertProjects(projects: Project[]) {
    if (!projects.length) return;
    const rows = projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon,
      is_archived: Boolean(p.is_archived),
      sort_order: p.sort_order,
      created_at: p.created_at,
      user_id: this.userId,
    }));
    const { error } = await this.client.from("projects").upsert(rows);
    if (error) {
      const fallbackRows = projects.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        icon: p.icon,
        sort_order: p.sort_order,
        created_at: p.created_at,
        user_id: this.userId,
      }));
      const { error: fallbackError } = await this.client.from("projects").upsert(fallbackRows);
      if (fallbackError) throw fallbackError;
    }
  }

  async deleteProjects(ids: string[]) {
    if (!ids.length) return;
    const { error } = await this.client.from("projects").delete().in("id", ids);
    if (error) throw error;
  }

  subscribe(onChange: (c: RemoteChange) => void) {
    const channelTopic = `entusis-changes-${crypto.randomUUID()}`;
    const channel = this.client
      .channel(channelTopic)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_nodes" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            onChange({ table: "items", kind: "delete", id: (payload.old as ItemRow).id });
          } else {
            onChange({ table: "items", kind: "upsert", record: fromRow(payload.new as ItemRow) });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            onChange({ table: "projects", kind: "delete", id: (payload.old as Project).id });
          } else {
            onChange({ table: "projects", kind: "upsert", record: payload.new as Project });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "item_node_shares" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            onChange({ table: "shares", kind: "delete", id: (payload.old as ItemShare).id });
          } else {
            onChange({ table: "shares", kind: "upsert", record: payload.new as ItemShare });
          }
        },
      )
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
