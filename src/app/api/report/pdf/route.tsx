import { renderToBuffer } from "@react-pdf/renderer";
import { WorklogPdf } from "@/components/worklog-pdf";
import { getAllEntries, getSettings } from "@/db/queries";
import { buildReport } from "@/lib/pdf-report";
import { parseRangeKind, resolveRange } from "@/lib/report-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = parseRangeKind(url.searchParams.get("range"));
  const anchor = url.searchParams.get("anchor");
  const range = resolveRange(kind, anchor);

  const report = buildReport(getAllEntries(), getSettings(), range);
  const buffer = await renderToBuffer(<WorklogPdf report={report} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="stundenzettel-${range.slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
