"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  section: "overview" | "system";
  icon: React.ReactNode;
};

const ICONS = {
  buchen: (
    <svg
      className="h-[18px] w-[18px] flex-shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  auswertung: (
    <svg
      className="h-[18px] w-[18px] flex-shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 19V5M4 19h16M8 16v-5M13 16V8M18 16v-9" />
    </svg>
  ),
  einstellungen: (
    <svg
      className="h-[18px] w-[18px] flex-shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
} as const;

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Buchen", section: "overview", icon: ICONS.buchen },
  {
    href: "/auswertung",
    label: "Auswertung",
    section: "overview",
    icon: ICONS.auswertung,
  },
  {
    href: "/einstellungen",
    label: "Einstellungen",
    section: "system",
    icon: ICONS.einstellungen,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="sticky top-0 h-screen flex flex-col px-3 py-5 border-r"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <Link href="/" className="flex items-center gap-2.5 px-3 pb-5">
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-white font-bold text-[13px]"
          style={{
            background: "linear-gradient(135deg, var(--accent), #ec4899)",
          }}
        >
          JW
        </div>
        <div>
          <div className="font-semibold text-[14px]">JiraWorklog (alpha)</div>
          <div className="text-[11px]" style={{ color: "var(--text-2)" }}>
            Tracker
          </div>
        </div>
      </Link>

      <NavSection
        title="Übersicht"
        items={NAV_ITEMS.filter((i) => i.section === "overview")}
        pathname={pathname}
      />
      <NavSection
        title="System"
        items={NAV_ITEMS.filter((i) => i.section === "system")}
        pathname={pathname}
      />

      <div
        className="mt-auto pt-3 px-3 text-[12px] border-t"
        style={{ color: "var(--text-3)", borderColor: "var(--border)" }}
      >
        Lokal · SQLite
      </div>
    </aside>
  );
}

function NavSection({
  title,
  items,
  pathname,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="mb-4">
      <div
        className="text-[10px] uppercase tracking-wider px-3 pb-1.5"
        style={{ color: "var(--text-3)" }}
      >
        {title}
      </div>
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium mb-px transition-colors"
            style={
              active
                ? { background: "var(--accent-soft)", color: "var(--accent)" }
                : { color: "var(--text-2)" }
            }
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
