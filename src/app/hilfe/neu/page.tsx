import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { parseChangelog, parseInline } from "@/lib/changelog";

// CHANGELOG.md sits next to the server's working directory: the project root
// in dev, the standalone folder in the desktop app (copied there through
// `outputFileTracingIncludes` in next.config.ts).
function readReleases() {
  try {
    return parseChangelog(
      readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8"),
    );
  } catch {
    return [];
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}.${m}.${y}` : iso;
}

export default function WasIstNeuPage() {
  const releases = readReleases().filter((r) => r.groups.length > 0);

  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7 max-w-[920px]">
      <PageHeader
        title="Was ist neu"
        subtitle={`Änderungen pro Version · aktuell v${process.env.NEXT_PUBLIC_APP_VERSION}`}
        actions={
          <Link
            href="/hilfe"
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium border"
            style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
          >
            Zur Anleitung
          </Link>
        }
      />

      {releases.length === 0 ? (
        <Card>
          <EmptyState title="Keine Änderungsliste gefunden" />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {releases.map((release) => (
            <Card key={release.version}>
              <div className="flex items-center gap-2.5 mb-3">
                <h2 className="text-[16px] font-semibold">
                  {release.date ? `Version ${release.version}` : "In Arbeit"}
                </h2>
                {release.date ? (
                  <Badge>{formatDate(release.date)}</Badge>
                ) : (
                  <Badge tone="open">noch nicht veröffentlicht</Badge>
                )}
              </div>
              {release.groups.map((group) => (
                <div key={group.title} className="mt-3">
                  <div
                    className="text-[12px] font-medium mb-1"
                    style={{ color: "var(--text-2)" }}
                  >
                    {group.title}
                  </div>
                  <ul className="pl-5 list-disc flex flex-col gap-1 text-[13.5px] leading-relaxed">
                    {group.items.map((item, i) => (
                      <li key={i}>
                        {parseInline(item).map((part, j) =>
                          part.kind === "bold" ? (
                            <b key={j}>{part.text}</b>
                          ) : part.kind === "code" ? (
                            <code
                              key={j}
                              className="px-1 py-0.5 rounded text-[12.5px]"
                              style={{ background: "var(--surface-2)" }}
                            >
                              {part.text}
                            </code>
                          ) : (
                            part.text
                          ),
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
