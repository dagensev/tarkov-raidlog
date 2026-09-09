"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAppStore } from "@/lib/store/app-store";
import { useCurrentMap, useRaidActive, useSelectedWipe } from "@/lib/store/hooks";
import { SquadSync } from "./squad-sync";
import { Lamp, cx } from "./ui";

const NAV = [
  { href: "/", label: "Tasks" },
  { href: "/raid/", label: "Raid" },
  { href: "/squad/", label: "Squad" },
  { href: "/sell/", label: "Sell check" },
  { href: "/settings/", label: "Settings" },
] as const;

/** Status of the log link, as a lamp plus a word. */
function LogLamp() {
  const status = useAppStore((s) => s.logStatus);
  const progress = useAppStore((s) => s.scanProgress);

  const map = {
    idle: { tone: "muted", text: "No logs", live: false },
    unsupported: { tone: "rust", text: "Unsupported", live: false },
    "needs-permission": { tone: "amber", text: "Reconnect", live: false },
    scanning: {
      tone: "amber",
      text: progress ? `Scan ${progress.index + 1}/${progress.total}` : "Scanning",
      live: true,
    },
    watching: { tone: "moss", text: "Live", live: true },
    error: { tone: "rust", text: "Error", live: false },
  } as const;

  const state = map[status];
  return (
    <span className="flex items-center gap-2">
      <Lamp tone={state.tone} live={state.live} />
      <span className="data text-[11px] text-bone-dim">{state.text}</span>
    </span>
  );
}

function DataLamp() {
  const loading = useAppStore((s) => s.dataLoading);
  const error = useAppStore((s) => s.dataError);
  const tasks = useAppStore((s) => s.bundle);
  const items = useAppStore((s) => s.itemIndex);

  const state = loading
    ? { tone: "amber" as const, text: "Loading data", live: true }
    : error && !tasks
      ? { tone: "rust" as const, text: "No data", live: false }
      : tasks
        ? { tone: "moss" as const, text: items ? "Data ready" : "Names loading", live: !items }
        : { tone: "muted" as const, text: "No data", live: false };

  return (
    <span className="flex items-center gap-2">
      <Lamp tone={state.tone} live={state.live} />
      <span className="data text-[11px] text-bone-dim">{state.text}</span>
    </span>
  );
}

function StatusStrip() {
  const wipe = useSelectedWipe();
  const currentMap = useCurrentMap();
  const inRaid = useRaidActive();

  const wipeLabel = wipe
    ? new Date(wipe.firstSeenAt).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <LogLamp />
      <DataLamp />
      <span className="flex items-center gap-2">
        <span className="stencil text-[10px] text-muted">Wipe</span>
        <span className="data text-[11px] text-bone-dim">{wipeLabel}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="stencil text-[10px] text-muted">Map</span>
        <span className={cx("data text-[11px]", inRaid ? "text-amber glow-amber" : "text-bone-dim")}>
          {currentMap?.name ?? "—"}
        </span>
      </span>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const hydrate = useAppStore((s) => s.hydrate);
  const stopWatching = useAppStore((s) => s.stopWatching);
  const pathname = usePathname();

  useEffect(() => {
    void hydrate();
    return () => stopWatching();
  }, [hydrate, stopWatching]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 sm:px-6">
      <header className="rise border-b border-line pt-6 pb-0">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Link href="/" className="group flex items-baseline gap-3">
            <span className="stencil text-xl leading-none text-amber glow-amber">RAIDLOG</span>
            <span className="data hidden text-[10px] text-muted transition-colors group-hover:text-bone-dim sm:inline">
              escape from tarkov · field terminal
            </span>
          </Link>
          <StatusStrip />
        </div>

        <nav className="-mb-px flex gap-0 pt-4">
          {NAV.map((item, index) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href.slice(0, -1));
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{ animationDelay: `${80 + index * 45}ms` }}
                className={cx(
                  "rise stencil border-b-2 px-4 py-2 text-[11px] transition-colors",
                  active
                    ? "border-amber text-amber"
                    : "border-transparent text-muted hover:text-bone-dim",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Headless: feeds log-derived progress to the squad room. */}
      <SquadSync />

      <main className="flex-1 py-6">{children}</main>

      <footer className="border-t border-line py-4">
        <p className="data text-[10px] text-muted">
          Reads logs locally in your browser. Game data from{" "}
          <a
            href="https://tarkov.dev"
            target="_blank"
            rel="noreferrer"
            className="text-bone-dim underline decoration-line-bright underline-offset-2 hover:text-amber"
          >
            tarkov.dev
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
