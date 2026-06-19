import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { clockTime, formatHm } from "@/lib/format";
import {
  formatDayMonth,
  weekdayShort,
  type WorklogReport,
} from "@/lib/pdf-report";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
    color: "#1f2937",
  },
  headerBlock: { marginBottom: 14 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 11, marginTop: 4, color: "#374151" },
  table: { width: "100%" },
  rowHeader: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
    borderTopWidth: 1,
    borderTopColor: "#111827",
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    backgroundColor: "#f3f4f6",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: "#e5e7eb",
    alignItems: "flex-start",
  },
  rowZebra: { backgroundColor: "#fafafa" },
  cell: { paddingRight: 4 },
  cellDate: { width: 46 },
  cellWeekday: { width: 24 },
  cellTime: { width: 42 },
  cellDuration: { width: 46 },
  cellDurationText: { textAlign: "right", paddingRight: 6 },
  cellIssue: { width: 72 },
  cellComment: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  cellStatus: { width: 36 },
  cellStatusText: { textAlign: "center" },
  muted: { color: "#9ca3af" },
  empty: {
    marginTop: 40,
    textAlign: "center",
    color: "#6b7280",
    fontSize: 11,
  },
  totalsBlock: {
    marginTop: 14,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#111827",
    alignItems: "flex-end",
  },
  totalsLine: { flexDirection: "row", alignItems: "baseline" },
  totalsLabel: { fontSize: 10, color: "#374151", marginRight: 8 },
  totalsValue: { fontSize: 14, fontFamily: "Helvetica-Bold" },
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

function TableHeader() {
  return (
    <View style={styles.rowHeader} fixed>
      <View style={[styles.cell, styles.cellDate]}>
        <Text>Datum</Text>
      </View>
      <View style={[styles.cell, styles.cellWeekday]}>
        <Text>Tag</Text>
      </View>
      <View style={[styles.cell, styles.cellTime]}>
        <Text>Beginn</Text>
      </View>
      <View style={[styles.cell, styles.cellTime]}>
        <Text>Ende</Text>
      </View>
      <View style={[styles.cell, styles.cellDuration]}>
        <Text style={styles.cellDurationText}>Dauer</Text>
      </View>
      <View style={[styles.cell, styles.cellIssue]}>
        <Text>Issue</Text>
      </View>
      <View style={[styles.cell, styles.cellComment]}>
        <Text>Kommentar</Text>
      </View>
      <View style={[styles.cell, styles.cellStatus]}>
        <Text style={styles.cellStatusText}>Gebucht</Text>
      </View>
    </View>
  );
}

export function WorklogPdf({ report }: { report: WorklogReport }) {
  const totalMinutes = Math.round(report.totalSeconds / 60);

  return (
    <Document
      title={`Stundenzettel · ${report.rangeLabel}`}
      author={report.displayName}
      subject={`Stundenzettel ${report.rangeLabel}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>
            Stundenzettel · {report.rangeLabel}
          </Text>
          <Text style={styles.subtitle}>{report.displayName}</Text>
        </View>

        {report.rows.length === 0 ? (
          <Text style={styles.empty}>Keine Einträge in diesem Zeitraum.</Text>
        ) : (
          <View style={styles.table}>
            <TableHeader />
            {report.rows.map((row, i) => {
              const issueText = row.isAllgemeines
                ? `Allg. · ${row.category ?? "—"}`
                : (row.issueKey ?? "—");
              return (
                <View
                  key={`${row.startedAt}-${i}`}
                  style={
                    i % 2 === 1
                      ? [styles.row, styles.rowZebra]
                      : styles.row
                  }
                  wrap={false}
                >
                  <View style={[styles.cell, styles.cellDate]}>
                    <Text>{formatDayMonth(row.startedAt)}</Text>
                  </View>
                  <View style={[styles.cell, styles.cellWeekday]}>
                    <Text>{weekdayShort(row.startedAt)}</Text>
                  </View>
                  <View style={[styles.cell, styles.cellTime]}>
                    <Text>{clockTime(row.startedAt)}</Text>
                  </View>
                  <View style={[styles.cell, styles.cellTime]}>
                    <Text>{clockTime(row.endedAt)}</Text>
                  </View>
                  <View style={[styles.cell, styles.cellDuration]}>
                    <Text style={styles.cellDurationText}>
                      {formatHm(Math.round(row.durationSeconds / 60))}
                    </Text>
                  </View>
                  <View style={[styles.cell, styles.cellIssue]}>
                    <Text
                      style={
                        row.issueKey || row.isAllgemeines
                          ? undefined
                          : styles.muted
                      }
                    >
                      {issueText}
                    </Text>
                  </View>
                  <View style={[styles.cell, styles.cellComment]}>
                    <Text>{row.comment}</Text>
                  </View>
                  <View style={[styles.cell, styles.cellStatus]}>
                    <Text style={styles.cellStatusText}>
                      {row.submitted ? "Ja" : "—"}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.totalsBlock}>
          <View style={styles.totalsLine}>
            <Text style={styles.totalsLabel}>Gesamtzeit:</Text>
            <Text style={styles.totalsValue}>{formatHm(totalMinutes)}</Text>
          </View>
        </View>

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
