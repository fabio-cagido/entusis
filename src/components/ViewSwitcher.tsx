"use client";

import Link from "next/link";
import { FileText, KanbanSquare, Network } from "lucide-react";
import { usePathname } from "next/navigation";

/** One-click switch between Page, Map and Kanban views of the same node. */
export default function ViewSwitcher({ id }: { id: string }) {
  const pathname = usePathname();
  const views = [
    { key: "page", href: `/page/${id}`, label: "Página", icon: <FileText size={14} />, match: pathname.startsWith("/page/") },
    { key: "map", href: `/canvas/${id}`, label: "Mapa", icon: <Network size={14} />, match: pathname.startsWith("/canvas/") },
    { key: "kanban", href: `/board?root=${id}`, label: "Kanban", icon: <KanbanSquare size={14} />, match: pathname === "/board" },
  ];
  return (
    <div className="segmented" role="tablist" aria-label="Visão">
      {views.map((v) => (
        <Link
          key={v.key}
          id={`view-${v.key}`}
          href={v.href}
          className={v.match ? "is-active" : ""}
          role="tab"
          aria-selected={v.match}
        >
          {v.icon}
          <span>{v.label}</span>
        </Link>
      ))}
    </div>
  );
}
