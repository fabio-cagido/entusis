import { Suspense } from "react";
import BoardView from "@/components/BoardView";

export default function BoardPage() {
  return (
    <Suspense fallback={<div className="view"><p className="muted">Carregando quadro...</p></div>}>
      <BoardView />
    </Suspense>
  );
}
