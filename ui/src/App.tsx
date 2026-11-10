import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { commands } from "@/bindings";
import { AwayDialog } from "@/components/away-dialog";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { DesktopBridge } from "@/components/desktop-bridge";
import { JiraUrlProvider } from "@/components/issue-key-link";
import { Sidebar } from "@/components/sidebar";
import { orThrow, queryClient } from "@/lib/query";
import { BuchenPage } from "@/pages/buchen";
import { NotPortedYet } from "@/pages/status";

/** The app frame: what the Next app's root layout rendered around each page. */
function Layout() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => orThrow(commands.getSettings()),
  });
  const themeMode = settings.data?.themeMode ?? "system";
  const jiraUrl = settings.data?.jiraUrl ?? "";

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  return (
    <ConfirmProvider>
      <DesktopBridge />
      <AwayDialog />
      <JiraUrlProvider jiraUrl={jiraUrl}>
        <div className="grid min-h-screen grid-cols-[232px_1fr]">
          <Sidebar />
          {/* clip, not hidden: hidden makes this a scroll container and breaks
              position: sticky in the pages (the settings save bar). */}
          <div className="overflow-x-clip">
            <Routes>
              <Route path="/" element={<BuchenPage />} />
              <Route path="/kalender" element={<NotPortedYet title="Kalender" />} />
              <Route path="/auswertung" element={<NotPortedYet title="Auswertung" />} />
              <Route path="/einstellungen" element={<NotPortedYet title="Einstellungen" />} />
              <Route path="/hilfe/*" element={<NotPortedYet title="Hilfe" />} />
            </Routes>
          </div>
        </div>
      </JiraUrlProvider>
    </ConfirmProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Hash routing: the bundled app is served from files, so a reload on
          a deep path must not depend on a server-side fallback. */}
      <HashRouter>
        <Layout />
      </HashRouter>
    </QueryClientProvider>
  );
}
