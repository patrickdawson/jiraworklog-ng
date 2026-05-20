import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "JiraWorklog Tracker",
  description: "Lokale Zeiterfassung mit Jira-Anbindung",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full">
        <div className="grid min-h-screen grid-cols-[232px_1fr]">
          <Sidebar />
          <div className="overflow-x-hidden">{children}</div>
        </div>
      </body>
    </html>
  );
}
