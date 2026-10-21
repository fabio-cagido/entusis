"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Network, Plus, Upload } from "lucide-react";
import { descendantsOf, useStore } from "@/lib/store";
import ImportMindMapModal from "./ImportMindMapModal";

export default function CanvasIndex() {
  const items = useStore((s) => s.items);
  const projects = useStore((s) => s.projects);
  const createItem = useStore((s) => s.createItem);
  const router = useRouter();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const maps = useMemo(
    () =>
      Object.values(items)
        .filter((i) => i.default_view === "CANVAS")
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        .map((m) => ({ m, count: descendantsOf(items, m.id).length })),
    [items],
  );

  const create = () => {
    const n = createItem({ title: "Novo mapa mental", icon: "🧠", default_view: "CANVAS", canvas: { x: 0, y: 0, color: "#8b7bff" } });
    router.push(`/canvas/${n.id}`);
  };

  return (
    <div className="view">
      <header className="view-head">
        <div>
          <p className="eyebrow">Canvas infinito</p>
          <h1 className="view-title">Mapas mentais</h1>
          <p className="muted">Qualquer página também pode ser aberta como canvas pelo seletor de visão.</p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            id="import-mindmap"
            className="btn btn-secondary"
            onClick={() => setIsImportModalOpen(true)}
            title="Importar mapa mental em formato JSON (Lucidchart, etc.)"
          >
            <Upload size={15} /> Importar mapa (JSON)
          </button>
          <button id="new-mindmap" className="btn btn-primary" onClick={create}>
            <Plus size={15} /> Novo mapa
          </button>
        </div>
      </header>
      <div className="map-grid">
        {maps.map(({ m, count }) => {
          const p = m.project_id ? projects[m.project_id] : null;
          return (
            <Link key={m.id} href={`/canvas/${m.id}`} className="map-card glass" style={{ ["--accent" as string]: m.canvas?.color ?? p?.color ?? "var(--primary)" }}>
              <div className="map-card-art">
                <Network size={34} />
              </div>
              <div className="map-card-body">
                <h3>{m.icon ?? "🧠"} {m.title || "Sem título"}</h3>
                <p className="muted small">
                  {count} nós{p ? ` · ${p.name}` : ""} · editado {new Date(m.updated_at).toLocaleDateString("pt-BR")}
                </p>
              </div>
            </Link>
          );
        })}
        <button className="map-card map-card-new" onClick={create}>
          <Plus size={22} />
          <span>Criar mapa mental</span>
        </button>
        <button
          className="map-card map-card-new"
          onClick={() => setIsImportModalOpen(true)}
          style={{ borderStyle: "dashed" }}
          title="Importar mapa mental exportado do Lucidchart ou JSON"
        >
          <Upload size={22} />
          <span>Importar JSON</span>
        </button>
      </div>

      <ImportMindMapModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
    </div>
  );
}
