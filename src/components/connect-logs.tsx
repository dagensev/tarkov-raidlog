"use client";

import { useSyncExternalStore } from "react";

import { isFileSystemAccessSupported } from "@/lib/logs/fs-access-source";
import { useAppStore } from "@/lib/store/app-store";
import { Button, Panel, PanelHeader } from "./ui";

/** Capability never changes within a page load, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

/**
 * The one thing that has to work before anything else does.
 *
 * Four states worth distinguishing, because the fix is different in each: the browser
 * cannot do this at all, no folder has been picked yet, a folder was picked but the
 * permission lapsed, or something failed.
 */
export function ConnectLogs() {
  const status = useAppStore((s) => s.logStatus);
  const error = useAppStore((s) => s.logError);
  const connect = useAppStore((s) => s.connectLogs);
  const reconnect = useAppStore((s) => s.reconnectLogs);

  // A browser capability is external state, not React state. The server snapshot claims
  // support so the prerendered HTML does not flash "unsupported" at a browser that has it;
  // the client snapshot corrects it on hydration.
  const supported = useSyncExternalStore(
    subscribeNever,
    isFileSystemAccessSupported,
    () => true,
  );

  if (!supported) {
    return (
      <Panel>
        <PanelHeader title="Log access" meta="unavailable" />
        <div className="space-y-3 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-bone-dim">
            This browser cannot read a local folder. Reading your logs live needs the File
            System Access API, which exists in <span className="text-bone">Chrome</span> and{" "}
            <span className="text-bone">Edge</span> but not in Firefox or Safari.
          </p>
          <p className="text-[13px] leading-relaxed text-muted">
            Everything else still works — you can track tasks by hand.
          </p>
        </div>
      </Panel>
    );
  }

  if (status === "needs-permission") {
    return (
      <Panel>
        <PanelHeader title="Log access" meta="permission lapsed" />
        <div className="space-y-3 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-bone-dim">
            Your folder is remembered, but the browser drops read permission between visits.
            One click restores it — you will not have to find the folder again.
          </p>
          <Button variant="primary" onClick={() => void reconnect()}>
            Reconnect logs
          </Button>
          <p className="data text-[10px] text-muted">
            Installing Raidlog as an app makes the permission stick.
          </p>
        </div>
      </Panel>
    );
  }

  if (status === "idle" || status === "error") {
    return (
      <Panel>
        <PanelHeader title="Log access" meta={status === "error" ? "failed" : "not connected"} />
        <div className="space-y-4 px-4 py-4">
          <p className="text-[13px] leading-relaxed text-bone-dim">
            Point Raidlog at the game&rsquo;s <span className="data text-bone">Logs</span> folder
            and it will work out which quests you have finished this wipe.
          </p>
          <p className="data text-[11px] break-all text-muted">
            C:\Battlestate Games\Escape from Tarkov\Logs
          </p>
          <Button variant="primary" onClick={() => void connect()}>
            Choose logs folder
          </Button>
          {error ? <p className="data text-[11px] text-rust">{error}</p> : null}
          <p className="text-[12px] leading-relaxed text-muted">
            Read-only, and the logs never leave your machine — parsing happens in this tab.
          </p>
        </div>
      </Panel>
    );
  }

  return null;
}
