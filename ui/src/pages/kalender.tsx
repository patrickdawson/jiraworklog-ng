import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { commands } from "@/bindings";
import { KalenderView } from "@/components/kalender-view";
import { orThrow } from "@/lib/query";
import { LoadError } from "@/pages/status";

export function KalenderPage() {
  const [params] = useSearchParams();
  const anchor = params.get("anchor");
  const query = useQuery({
    queryKey: ["kalender", anchor],
    queryFn: () => orThrow(commands.kalenderData(anchor)),
    placeholderData: (previous) => previous,
  });

  if (query.error) return <LoadError error={query.error} />;
  if (!query.data) return null;
  return <KalenderView data={query.data} />;
}
