"use client";

import { useParams } from "next/navigation";
import PageEditor from "@/components/PageEditor";

export default function ItemPage() {
  const params = useParams<{ id: string }>();
  if (!params?.id) return null;
  return <PageEditor id={params.id} />;
}
