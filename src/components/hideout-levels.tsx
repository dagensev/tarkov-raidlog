"use client";

import { recordedCount } from "@/lib/sell/hideout-levels";
import { useAppStore } from "@/lib/store/app-store";
import { useEconomy } from "@/lib/store/hooks";
import { Label, Panel, PanelHeader, cx } from "./ui";

/**
 * Which hideout stations you have built, and to what level.
 *
 * The logs never mention the hideout — no message, no template id, nothing — so unlike
 * quest progress there is no way to derive this. Typed once, it does two jobs: it stops
 * upgrades you finished months ago from flagging their items forever, and it drops crafts
 * you cannot run from the sell check's soft tier.
 */
export function HideoutLevels() {
  const economy = useEconomy();
  const levels = useAppStore((s) => s.settings.hideoutLevels);
  const setLevel = useAppStore((s) => s.setHideoutLevel);

  // Nothing to edit until the station list arrives, the same stance WipeSettings takes.
  if (!economy || economy.stations.length === 0) return null;

  const recorded = recordedCount(levels);

  return (
    <Panel className="rise" style={{ animationDelay: "150ms" }}>
      <PanelHeader
        title="Hideout"
        meta={`${recorded} of ${economy.stations.length} recorded`}
      />
      <div className="space-y-3 px-4 py-4">
        <p className="text-[12px] leading-relaxed text-muted">
          Blank means we have not been told, and the sell check assumes you might still
          need the items. Set 0 for a station you have not built — that is what stops
          crafts you cannot run from padding the list.
        </p>

        <ul className="divide-y divide-line">
          {economy.stations.map((station) => {
            const max = station.levels.reduce((top, level) => Math.max(top, level.level), 0);
            const current = levels[station.id];
            const options: Array<number | null> = [
              null,
              ...Array.from({ length: max + 1 }, (_, level) => level),
            ];

            return (
              <li
                key={station.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <Label>{station.name}</Label>
                <div className="flex">
                  {options.map((option) => {
                    const active = option === null ? current === undefined : current === option;
                    return (
                      <button
                        key={option ?? "unknown"}
                        type="button"
                        title={
                          option === null
                            ? "Not told — assume the items may still be needed"
                            : option === 0
                              ? "Not built"
                              : `Built to level ${option}`
                        }
                        onClick={() => void setLevel(station.id, option)}
                        className={cx(
                          "data cursor-pointer border px-2.5 py-1 text-[11px] transition-colors",
                          active
                            ? "border-amber bg-amber/15 text-amber"
                            : "border-line-bright text-muted hover:text-bone-dim",
                        )}
                      >
                        {option ?? "?"}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
