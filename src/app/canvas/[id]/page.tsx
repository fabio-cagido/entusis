"use client";

import { useParams } from "next/navigation";
import MindMap from "@/components/MindMap";

export default function CanvasDetailPage() {
  const params = useParams<{ id: string }>();
  if (!params?.id) return null;
  return <MindMap rootId={params.id} />;
}
