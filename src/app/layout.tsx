import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { ElectronBridge } from "@/components/electron-bridge";
import { AwayDialog } from "@/components/away-dialog";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { JiraUrlProvider } from "@/components/issue-key-link";
import { getSettings } from "@/db/queries";

export const metadata: Metadata = {
  title: "JiraWorklog Tracker",
  description: "Lokale Zeiterfassung mit Jira-Anbindung",
};

export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { themeMode, jiraUrl } = getSettings();
  return (
    <html lang="de" className="h-full antialiased" data-theme={themeMode}>
      <body className="min-h-full" suppressHydrationWarning>
        <ElectronBridge />
        <AwayDialog />
        <ConfirmProvider>
          <JiraUrlProvider jiraUrl={jiraUrl}>
            <div className="grid min-h-screen grid-cols-[232px_1fr]">
              <Sidebar />
              {/* clip, not hidden: hidden makes this a scroll container and breaks
                  position: sticky in the pages (the settings save bar). */}
              <div className="overflow-x-clip">{children}</div>
            </div>
          </JiraUrlProvider>
        </ConfirmProvider>
      </body>
    </html>
  );
}
