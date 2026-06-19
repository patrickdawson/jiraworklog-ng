import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { ALLGEMEINES_CATEGORIES } from "@/db/schema";
import { formatHm } from "@/lib/format";
import type { CategoryReport } from "@/lib/category-report";

/** Renders minutes as "h:mm", or a dash for zero to keep the grid readable. */
function cellTime(minutes: number): string {
  return minutes > 0 ? formatHm(minutes) : "–";
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
    color: "#1f2937",
  },
  headerBlock: { marginBottom: 18 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 11, marginTop: 4, color: "#374151" },
  intro: { fontSize: 9, marginTop: 8, color: "#6b7280" },
  category: { marginBottom: 16 },
  categoryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    paddingBottom: 4,
    marginBottom: 4,
  },
  categoryName: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  categoryTotal: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  blockRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    paddingLeft: 10,
  },
  blockLabel: { color: "#374151" },
  blockValue: { fontFamily: "Helvetica-Bold", textAlign: "right" },
  empty: {
    marginTop: 40,
    textAlign: "center",
    color: "#6b7280",
    fontSize: 11,
  },
  totalsBlock: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  totalsLabel: { fontSize: 11, color: "#374151" },
  totalsValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  // ── Per-day verification table ──
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginTop: 26,
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    backgroundColor: "#f3f4f6",
    paddingVertical: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    fontSize: 9,
  },
  tableRowZebra: { backgroundColor: "#fafafa" },
  tableFooter: {
    flexDirection: "row",
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
  },
  colDay: { width: 56, paddingHorizontal: 2 },
  colCat: { flexGrow: 1, flexBasis: 0, paddingHorizontal: 2, textAlign: "right" },
  colSum: { width: 52, paddingHorizontal: 2, textAlign: "right" },
  muted: { color: "#9ca3af" },
  pageNumber: {
    position: "absolute",
    bottom: 22,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 9,
    color: "#9ca3af",
  },
});

export function CategoryReportPdf({ report }: { report: CategoryReport }) {
  // Authoritative per-category month totals for the table footer (0 if unused).
  const categoryTotals = Object.fromEntries(
    ALLGEMEINES_CATEGORIES.map((name) => [
      name,
      report.categories.find((c) => c.name === name)?.totalMinutes ?? 0,
    ]),
  ) as Record<(typeof ALLGEMEINES_CATEGORIES)[number], number>;

  return (
    <Document
      title={`Monatsbericht · ${report.rangeLabel}`}
      author={report.displayName}
      subject={`Buchungsbericht ${report.rangeLabel}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Monatsbericht · {report.rangeLabel}</Text>
          <Text style={styles.subtitle}>{report.displayName}</Text>
          <Text style={styles.intro}>
            Zeiten je Kategorie, aufgeteilt in Buchungsblöcke von maximal 24:00
            Stunden zur manuellen Übertragung.
          </Text>
        </View>

        {report.categories.length === 0 ? (
          <Text style={styles.empty}>Keine Einträge in diesem Zeitraum.</Text>
        ) : (
          report.categories.map((cat) => (
            <View key={cat.name} style={styles.category} wrap={false}>
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryName}>{cat.name}</Text>
                <Text style={styles.categoryTotal}>
                  {formatHm(cat.totalMinutes)}
                </Text>
              </View>
              {cat.blocks.map((minutes, i) => (
                <View key={i} style={styles.blockRow}>
                  <Text style={styles.blockLabel}>Block {i + 1}</Text>
                  <Text style={styles.blockValue}>{formatHm(minutes)}</Text>
                </View>
              ))}
            </View>
          ))
        )}

        {report.categories.length > 0 && (
          <View style={styles.totalsBlock}>
            <Text style={styles.totalsLabel}>Gesamtzeit:</Text>
            <Text style={styles.totalsValue}>
              {formatHm(report.totalMinutes)}
            </Text>
          </View>
        )}

        {report.days.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Tagesübersicht</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colDay}>Datum</Text>
              {ALLGEMEINES_CATEGORIES.map((name) => (
                <Text key={name} style={styles.colCat}>
                  {name}
                </Text>
              ))}
              <Text style={styles.colSum}>Summe</Text>
            </View>
            {report.days.map((day, i) => (
              <View
                key={day.dayKey}
                style={
                  i % 2 === 1
                    ? [styles.tableRow, styles.tableRowZebra]
                    : styles.tableRow
                }
                wrap={false}
              >
                <Text style={styles.colDay}>{day.label}</Text>
                {ALLGEMEINES_CATEGORIES.map((name) => {
                  const m = day.minutesByCategory[name];
                  return (
                    <Text
                      key={name}
                      style={
                        m > 0 ? styles.colCat : [styles.colCat, styles.muted]
                      }
                    >
                      {cellTime(m)}
                    </Text>
                  );
                })}
                <Text style={styles.colSum}>{formatHm(day.totalMinutes)}</Text>
              </View>
            ))}
            <View style={styles.tableFooter}>
              <Text style={styles.colDay}>Summe</Text>
              {ALLGEMEINES_CATEGORIES.map((name) => (
                <Text key={name} style={styles.colCat}>
                  {cellTime(categoryTotals[name])}
                </Text>
              ))}
              <Text style={styles.colSum}>{formatHm(report.totalMinutes)}</Text>
            </View>
          </View>
        )}

        <Text
          style={styles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) =>
            `Seite ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
