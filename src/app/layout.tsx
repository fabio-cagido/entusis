import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import Sidebar from "@/components/Sidebar";
import NodeDrawer from "@/components/NodeDrawer";

export const metadata: Metadata = {
  title: {
    default: "Ayolia — Plataforma Integrada de Produtividade",
    template: "%s | Ayolia",
  },
  description: "Ayolia — Notion + Miro + Google Calendar em uma única base unificada de dados.",
  openGraph: {
    title: "Ayolia — Plataforma Integrada de Produtividade",
    description: "Páginas, mapas mentais, quadros Kanban e agenda em uma única base unificada.",
    siteName: "Ayolia",
  },
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/logo.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/logo.png",
  },
};

// Opts out of development-only instant-navigation validator
// because children are conditionally gated by authentication in Providers.
export const instant = false;

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
