"use client";

import Link from "next/link";

import { ConnectLogs } from "@/components/connect-logs";
import { EmptyNote, Label, Lamp, Panel, PanelHeader, Pill, Readout, cx } from "@/components/ui";
import { useAppStore } from "@/lib/store/app-store";
import { useCurrentMap, useProgressCounts, useSelectedWipe } from "@/lib/store/hooks";

function RaidBanner() {
  const raid = useAppStore((s) => s.raid);
  const map = useCurrentMap();

  if (!raid.active) return null;

  return (
    <Panel className="rise overflow-hidden border-amber/40">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <Lamp tone="amber" live />
          <span className="stencil text-[11px] text-amber">In raid</span>
          <span className="text-lg text-bone">{map?.name ?? "Map not recognised"}</span>
        </div>
        <Link
          href="/raid/"
          className="stencil border border-amber px-3 py-1.5 text-[10px] text-amber transition-colors hover:bg-amber hover:text-ground"
        >
          Open raid board
        </Link>
      </div>
    </Panel>
  );
}

function ProgressBoard() {
  const { finished, started, manual, available, locked, total } = useProgressCounts();
  const pct = total > 0 ? Math.round((finished / total) * 100) : 0;

  return (
    <Panel className="rise">
      <PanelHeader
        title="Progress"
        meta={total > 0 ? `${finished}/${total} tasks` : "no game data"}
      />
      <div className="grid grid-cols-2 gap-6 px-4 py-5 sm:grid-cols-4">
        <Readout label="Completed" value={finished} tone="moss" />
        <Readout label="In progress" value={started} tone="amber" />
        <Readout
          label="Available"
          value={available}
          hint={available > 0 ? "ready to pick up" : undefined}
        />
        <Readout label="Locked" value={locked} tone="muted" />
      </div>

      <div className="px-4 pb-5">
        <div className="mb-2 flex items-baseline justify-between">
          <Label>Wipe completion</Label>
          <span className="data text-[11px] text-bone-dim">{pct}%</span>
        </div>
        {/* Segmented bar: reads as a magazine of rounds rather than a progress meter. */}
        <div className="flex gap-[2px]">
          {Array.from({ length: 40 }, (_, i) => (
            <span
              key={i}
              className={cx(
                "h-3 flex-1",
                i < Math.round((pct / 100) * 40) ? "bg-amber" : "bg-line",
              )}
            />
          ))}
        </div>
        {manual > 0 ? (
          <p className="data mt-2 text-[10px] text-muted">
            {manual} set by hand, the rest read from your logs
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function WipePanel() {
  const wipes = useAppStore((s) => s.wipes);
  const wipe = useSelectedWipe();

  if (!wipes || wipes.generations.length === 0) return null;

  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });

  return (
    <Panel className="rise">
      <PanelHeader
        title="Wipe detection"
        meta={`${wipes.generations.length} profile${wipes.generations.length === 1 ? "" : "s"}`}
        action={
          <Link
            href="/settings/"
            className="stencil text-[10px] text-muted transition-colors hover:text-amber"
          >
            Change
          </Link>
        }
      />
      <ul className="divide-y divide-line">
        {wipes.generations.map((generation) => {
          const active = generation.id === wipe?.id;
          return (
            <li
              key={generation.id}
              className={cx("flex flex-wrap items-center gap-3 px-4 py-3", active && "bg-amber/5")}
            >
              <Lamp tone={active ? "amber" : "muted"} />
              <span className="data text-[12px] text-bone">
                {fmt(generation.firstSeenAt)} → {fmt(generation.lastSeenAt)}
              </span>
              <span className="data text-[11px] text-muted">
                {generation.folders.length} session{generation.folders.length === 1 ? "" : "s"}
              </span>
              {generation.sessionModes.map((mode) => (
                <Pill key={mode} tone={mode === "Pve" ? "steel" : "muted"}>
                  {mode}
                </Pill>
              ))}
              {active ? <Pill tone="amber">current</Pill> : null}
            </li>
          );
        })}
      </ul>
      <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
        Wipes are told apart by profile ID. Progress from an older wipe is kept, just not
        counted.
      </p>
    </Panel>
  );
}

function DataStatus() {
  const data = useAppStore((s) => s.tarkovData);
  const stale = useAppStore((s) => s.tarkovDataStale);
  const error = useAppStore((s) => s.tarkovDataError);

  if (data && !error && !stale) return null;

  return (
    <Panel className="rise">
      <PanelHeader title="Game data" meta={data ? "cached" : "unavailable"} />
      <div className="space-y-2 px-4 py-4">
        {error ? (
          <p className="text-[13px] leading-relaxed text-bone-dim">
            tarkov.dev did not answer:{" "}
            <span className="data text-[12px] text-rust">{error}</span>
          </p>
        ) : null}
        <p className="text-[13px] leading-relaxed text-muted">
          {data
            ? "Showing the last copy saved on this machine. Task names and requirements may be out of date, but your progress is unaffected."
            : "Task names and requirements come from tarkov.dev. Without them Raidlog can still read your logs, but has nothing to match them against."}
        </p>
      </div>
    </Panel>
  );
}

export default function OverviewPage() {
  const logStatus = useAppStore((s) => s.logStatus);
  const events = useAppStore((s) => s.events);

  return (
    <div className="space-y-4">
      <RaidBanner />
      <ConnectLogs />
      <DataStatus />

      {logStatus === "watching" || events.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <ProgressBoard />
          <WipePanel />
        </div>
      ) : logStatus === "scanning" ? (
        <Panel>
          <EmptyNote>Reading your log folder…</EmptyNote>
        </Panel>
      ) : null}
    </div>
  );
}
