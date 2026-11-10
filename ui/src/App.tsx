import { useEffect, useState } from "react";
import { commands, type AppInfo } from "./bindings";

/** Skeleton screen: proves the UI ↔ Rust round trip through typed bindings. */
export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void commands.appInfo().then(setInfo);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-800">
      <div className="text-center">
        <h1 className="text-2xl font-semibold">JiraWorklog</h1>
        <p className="mt-2 text-sm text-slate-500">
          {info ? `Version ${info.version}` : "Lade …"}
        </p>
      </div>
    </main>
  );
}
