import { useQuery } from "@tanstack/react-query";
import { commands } from "@/bindings";
import { EinstellungenForm } from "@/components/einstellungen-form";
import { orThrow } from "@/lib/query";
import { LoadError } from "@/pages/status";

/**
 * Port of src/app/einstellungen/page.tsx. Rust already parses the breaks and
 * project keys, so the stored settings go into the form as they are.
 */
export function EinstellungenPage() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => orThrow(commands.getSettings()),
  });
  const forceBooking = useQuery({
    queryKey: ["forceBooking"],
    queryFn: () => commands.getForceBooking(),
  });

  const error = settings.error ?? forceBooking.error;
  if (error) return <LoadError error={error} />;
  if (!settings.data || forceBooking.data === undefined) return null;

  // The form keeps its own state from the first render on, like the old page:
  // later reloads of the queries do not reset what the user is editing.
  return <EinstellungenForm initial={{ ...settings.data, forceBooking: forceBooking.data }} />;
}
