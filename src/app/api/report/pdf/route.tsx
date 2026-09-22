import { renderToBuffer } from "@react-pdf/renderer";
import { WorklogPdf } from "@/components/worklog-pdf";
import { getEntriesBetween, getSettings } from "@/db/queries";
import { buildReport } from "@/lib/pdf-report";
import { parseRangeKind, resolveRange } from "@/lib/report-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = parseRangeKind(url.searchParams.get("range"));
  const anchor = url.searchParams.get("anchor");
  const settings = getSettings();
  const range = resolveRange(kind, anchor, new Date(), {
    anchorDate: settings.sprintAnchorDate,
    lengthDays: settings.sprintLengthDays,
  });

  // `range.to` is the last millisecond of the local day, so the bound is
  // inclusive. `buildReport` keeps its own O(1) range guard, which makes it
  // total for any caller.
  const entries = getEntriesBetween(
    range.from.toISOString(),
    range.to.toISOString(),
  );
  const report = buildReport(entries, settings, range);
  const buffer = await renderToBuffer(<WorklogPdf report={report} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="stundenzettel-${range.slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
