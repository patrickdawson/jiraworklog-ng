import { renderToBuffer } from "@react-pdf/renderer";
import { CategoryReportPdf } from "@/components/category-report-pdf";
import { getEntriesBetween, getSettings } from "@/db/queries";
import { buildCategoryReport } from "@/lib/category-report";
import { resolveRange } from "@/lib/report-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const anchor = url.searchParams.get("anchor");
  const settings = getSettings();
  // The category report is always a calendar-month report.
  const range = resolveRange("month", anchor, new Date(), {
    anchorDate: settings.sprintAnchorDate,
    lengthDays: settings.sprintLengthDays,
  });

  const entries = getEntriesBetween(
    range.from.toISOString(),
    range.to.toISOString(),
  );
  const report = buildCategoryReport(entries, settings, range);
  const buffer = await renderToBuffer(<CategoryReportPdf report={report} />);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="monatsbericht-${range.slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
