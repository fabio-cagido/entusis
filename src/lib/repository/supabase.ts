import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemNode, Project } from "../types";
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

const toRow = (n: ItemNode, userId: string): ItemRow => ({
  id: n.id,
  user_id: userId,
  title: n.title,
  content: n.content,
  icon: n.icon,
  type: n.type,
  parent_id: n.parent_id,
  project_id: n.project_id,
  status: n.status,
  is_today: n.is_today,
  start_time: n.schedule.start_time,
  end_time: n.schedule.end_time,
  google_event_id: n.schedule.google_event_id,
  attachments: n.attachments,
  links: n.links,
  canvas: n.canvas,
  default_view: n.default_view,
  sort_order: n.sort_order,
  created_at: n.created_at,
  updated_at: n.updated_at,
});

const fromRow = (r: ItemRow): ItemNode => ({
  id: r.id,
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
  constructor(private client: SupabaseClient, private userId: string) {}

  async loadAll(): Promise<Snapshot> {
    const [items, projects] = await Promise.all([
      this.client.from("item_nodes").select("*"),
      this.client.from("projects").select("*"),
    ]);
    if (items.error) throw items.error;
    if (projects.error) throw projects.error;
    return {
      items: (items.data as ItemRow[]).map(fromRow),
      projects: (projects.data as Project[]) ?? [],
    };
  }

  async upsertItems(items: ItemNode[]) {
    if (!items.length) return;
    const { error } = await this.client
      .from("item_nodes")
      .upsert(items.map((i) => toRow(i, this.userId)));
    if (error) throw error;
  }

  async deleteItems(ids: string[]) {
    if (!ids.length) return;
    const { error } = await this.client.from("item_nodes").delete().in("id", ids);
    if (error) throw error;
  }

  async upsertProjects(projects: Project[]) {
    if (!projects.length) return;
    const rows = projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      icon: p.icon,
      sort_order: p.sort_order,
      created_at: p.created_at,
      user_id: this.userId,
    }));
    const { error } = await this.client.from("projects").upsert(rows);
    if (error) throw error;
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
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }
}
