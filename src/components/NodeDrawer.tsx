"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Maximize2, Network, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import PageEditor from "./PageEditor";

/** Side drawer showing the full page of any node, from any view. */
export default function NodeDrawer() {
  const drawerId = useStore((s) => s.drawerId);
  const exists = useStore((s) => (s.drawerId ? !!s.items[s.drawerId] : false));
  const openDrawer = useStore((s) => s.openDrawer);
  const deleteItem = useStore((s) => s.deleteItem);
  const pathname = usePathname();
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (firstPath.current !== pathname) openDrawer(null);
    firstPath.current = pathname;
  }, [pathname, openDrawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDrawer]);

  const open = Boolean(drawerId && exists);

  return (
    <>
      <div className={`drawer-scrim ${open ? "is-open" : ""}`} onClick={() => openDrawer(null)} />
      <aside className={`drawer glass ${open ? "is-open" : ""}`} aria-hidden={!open} id="node-drawer">
        {open && drawerId && (
          <>
            <div className="drawer-bar">
              <Link className="btn btn-ghost btn-xs" href={`/page/${drawerId}`} id="drawer-open-page">
                <Maximize2 size={13} /> Abrir página
              </Link>
              <Link className="btn btn-ghost btn-xs" href={`/canvas/${drawerId}`} id="drawer-open-canvas">
                <Network size={13} /> Como canvas
              </Link>
              <span className="spacer" />
              <button
                className="icon-btn icon-btn-danger"
                title="Excluir"
                onClick={() => confirm("Excluir este item e todos os sub-itens?") && deleteItem(drawerId)}
              >
                <Trash2 size={15} />
              </button>
              <button className="icon-btn" id="drawer-close" title="Fechar (Esc)" onClick={() => openDrawer(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="drawer-body">
              <PageEditor id={drawerId} compact />
            </div>
          </>
        )}
      </aside>
    </>
  );
}
