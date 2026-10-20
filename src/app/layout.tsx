import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Sidebar from "@/components/Sidebar";
import NodeDrawer from "@/components/NodeDrawer";

export const metadata: Metadata = {
  title: "êntusis — Plataforma Integrada de Produtividade",
  description: "Notion + Miro + Google Calendar em uma única base unificada de dados.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>
          <div className="app-layout">
            <Sidebar />
            <main className="app-main">{children}</main>
            <NodeDrawer />
          </div>
        </Providers>
      </body>
    </html>
  );
}
