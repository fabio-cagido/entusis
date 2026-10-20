import type { AttachmentKind, ItemNode } from "./types";

export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Hoje ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Amanhã ${time}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} ${time}`;
}

export function detectAttachmentKind(url: string): AttachmentKind {
  if (/drive\.google\.com|docs\.google\.com/.test(url)) return "drive";
  if (/^file:|^[a-zA-Z]:\\|^\//.test(url)) return "file";
  return "web";
}

export function typeIcon(it: Pick<ItemNode, "icon" | "type" | "default_view">): string {
  if (it.icon) return it.icon;
  if (it.default_view === "CANVAS") return "🧠";
  switch (it.type) {
    case "TASK":
      return "☑️";
    case "EVENT":
      return "📅";
    case "MINDMAP_NODE":
      return "🔹";
    default:
      return "📄";
  }
}
