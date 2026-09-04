/**
 * Position from a screenshot file name.
 *
 * Escape from Tarkov writes where you were standing into the name of every screenshot it
 * saves, which is the whole trick behind in-raid position tracking — no memory reading, no
 * overlay, no screen capture. Verified against a real file taken on Customs, whose parsed
 * position lands 0.1 m from a player spawn tarkov.dev publishes:
 *
 *   2026-09-03[18-15]_356.64, 2.58, -24.30_0.00000, 0.79692, 0.00000, 0.60408_16.86 (0).png
 *   └── date ──┘└─t─┘ └─ x, y, z ────────┘ └─ quaternion ─────────────────┘ └fov┘ └n┘
 *
 * The file itself is never opened. Everything here works off the name, which is what keeps
 * polling a folder of thousands of screenshots to a plain directory listing.
 *
 * Ported from TarkovMonitor's `GameWatcher.ScreenshotWatcher_Created`.
 */

/** Splits the name into its date, time and payload. Non-global: reused every poll. */
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})\[(\d{2})-(\d{2})\]_?(.+) \(\d\)\.png$/;

/**
 * Position and quaternion inside the payload.
 *
 * Position always carries two decimal places, the quaternion five — both confirmed against
 * a real file. The quaternion components are matched loosely enough to accept the `-0.0`
 * and `1.00000` forms the game also emits.
 */
const POSITION_RE =
  /^(-?\d+\.\d{2}), (-?\d+\.\d{2}), (-?\d+\.\d{2})_?(-?[\d.]\.\d{1,5}), (-?[\d.]\.\d{1,5}), (-?[\d.]\.\d{1,5}), (-?[\d.]\.\d{1,5})/;

/**
 * A screenshot's file name can trail the raid's start by up to 59 seconds, because the
 * name records the minute and not the second. Without this grace the first screenshot of a
 * raid is dropped roughly half the time.
 */
const MINUTE_MS = 60_000;

export interface ScreenshotPosition {
  /** The file name, which is also the identity of a trail point. */
  name: string;
  /** Local time from the name, to the minute, as epoch milliseconds. */
  takenAt: number;
  x: number;
  y: number;
  z: number;
  /** Facing in degrees, or null where the quaternion could not be read. */
  yaw: number | null;
}

/**
 * Facing, from the rotation quaternion.
 *
 * The ordinary rotation about Unity's Y axis. TarkovMonitor's version of this declares its
 * parameters `(x, z, y, w)` and is called with `(rx, ry, rz, rw)`, which reads like a
 * deliberate axis swap and is not — following the call through gives exactly this.
 */
function yawFrom(x: number, y: number, z: number, w: number): number {
  const siny = 2 * (w * y + x * z);
  const cosy = 1 - 2 * (y * y + z * z);
  return (Math.atan2(siny, cosy) * 180) / Math.PI;
}

/** Read one screenshot file name, or null when it is not one of the game's. */
export function parseScreenshotName(name: string): ScreenshotPosition | null {
  const outer = NAME_RE.exec(name);
  if (!outer) return null;

  const inner = POSITION_RE.exec(outer[6]);
  if (!inner) return null;

  const [year, month, day, hour, minute] = outer.slice(1, 6).map(Number);
  const [x, y, z, qx, qy, qz, qw] = inner.slice(1).map(Number);

  return {
    name,
    // The game names files in local time, and log timestamps are local too, so the two
    // are directly comparable only if this is built from local components.
    takenAt: new Date(year, month - 1, day, hour, minute).getTime(),
    x,
    y,
    z,
    yaw: yawFrom(qx, qy, qz, qw),
  };
}

/**
 * This raid's screenshots, oldest first.
 *
 * Derived rather than accumulated: every poll re-reads the directory and re-filters it, so
 * there is no growing state to clear, reloading the page mid-raid rebuilds the same trail,
 * and a new raid empties it by moving `raidAt`.
 */
export function trailFrom(names: readonly string[], raidAt: number): ScreenshotPosition[] {
  if (!raidAt) return [];
  const trail: ScreenshotPosition[] = [];
  for (const name of names) {
    const shot = parseScreenshotName(name);
    if (shot && shot.takenAt >= raidAt - MINUTE_MS) trail.push(shot);
  }
  return trail.sort((a, b) => a.takenAt - b.takenAt);
}
