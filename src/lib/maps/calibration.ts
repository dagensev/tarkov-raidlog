/**
 * Where a game coordinate falls on tarkov.dev's map drawings.
 *
 * Not part of the JSON API — this lives in `src/data/maps.json` in the-hideout/tarkov-dev,
 * alongside the SVGs on assets.tarkov.dev. Vendored rather than fetched for the same
 * reason as `maps-3d.ts`: thirteen entries of static data that change only when somebody
 * redraws a map, against a third-party dependency, a CORS surface and a failure mode on
 * every page load.
 *
 * Only the ten maps with an SVG are here. The Lab, The Labyrinth and Icebreaker publish
 * raster tiles instead, which this does not render — the map card hides itself for those.
 *
 * `live-svg.test.ts` checks each SVG's aspect ratio against these bounds, so a redraw
 * fails a test rather than silently sliding every pin.
 *
 * To refresh: pull that maps.json and re-read `bounds`, `svgBounds`, `coordinateRotation`,
 * `svgPath`, `svgLayer`, `heightRange` and `layers` for each map whose `projection` is
 * `interactive`.
 */

export interface MapFloor {
  /** Shown in the floor switcher. */
  name: string;
  /** `id` of the `<g>` in the SVG this floor draws. */
  svgLayer: string;
  /** Height band, as `[bottom, top]`, matched against a position's `y`. */
  height: readonly [number, number];
}

export interface MapCalibration {
  svgPath: string;
  /** The `<g>` drawn as the base. Not always `Ground_Level` — Factory says `Ground_Floor`. */
  svgLayer: string;
  /** Marker space, as `[[x, z], [x, z]]`. */
  bounds: readonly [readonly [number, number], readonly [number, number]];
  /** Picture space, where it differs from marker space. Reserve is the only such map. */
  svgBounds?: readonly [readonly [number, number], readonly [number, number]];
  /** Degrees. Always a multiple of 90, which is why a rotated rectangle stays a rectangle. */
  coordinateRotation: number;
  /** Height band of the base layer, or null where the map publishes none. */
  heightRange: readonly [number, number] | null;
  floors: readonly MapFloor[];
}

/**
 * Keyed by `GameMap.normalizedName`.
 *
 * Floors without an `svgLayer` in the source data are dropped: tarkov.dev uses those to
 * dim markers by height, but there is no `<g>` to draw, so offering them in a switcher
 * would be a control that changes nothing. That removes Customs' "4th Floor" and
 * Reserve's "5th Floor".
 */
export const MAP_CALIBRATION: Readonly<Record<string, MapCalibration>> = {
  "streets-of-tarkov": {
    svgPath: "https://assets.tarkov.dev/maps/svg/StreetsOfTarkov.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [323, -295],
      [-280, 532],
    ],
    coordinateRotation: 180,
    heightRange: [-6, 10],
    floors: [
      { name: "2nd Floor", svgLayer: "Second_Floor", height: [10, 15] },
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [15, 20] },
      { name: "4th Floor", svgLayer: "Fourth_Floor", height: [20, 25] },
      { name: "5th Floor", svgLayer: "Fifth_Floor", height: [25, 10000] },
      { name: "Underground", svgLayer: "Underground_Level", height: [-10000, -6] },
    ],
  },
  "ground-zero": {
    svgPath: "https://assets.tarkov.dev/maps/svg/GroundZero.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [249, -124],
      [-99, 364],
    ],
    coordinateRotation: 180,
    heightRange: [-1000, 28],
    floors: [
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [32.3, 1000] },
      { name: "Garage", svgLayer: "Underground_Level", height: [-1000, 21] },
    ],
  },
  customs: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Customs.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [698, -307],
      [-372, 237],
    ],
    coordinateRotation: 180,
    heightRange: [-1000, 1000],
    floors: [{ name: "Underground", svgLayer: "Underground_Level", height: [-1000, 0.5] }],
  },
  factory: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Factory.svg",
    svgLayer: "Ground_Floor",
    bounds: [
      [77, -64.5],
      [-65.5, 67.4],
    ],
    coordinateRotation: 90,
    heightRange: [-1, 3],
    floors: [
      { name: "2nd Floor", svgLayer: "Second_Floor", height: [3, 6] },
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [6, 10000] },
      { name: "Tunnels", svgLayer: "Basement", height: [-10000, -1] },
    ],
  },
  interchange: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Interchange.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [598, -442],
      [-433, 426],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [
      { name: "2nd Floor", svgLayer: "First_Floor", height: [25, 34] },
      { name: "3rd Floor", svgLayer: "Second_Floor", height: [34, 1000] },
    ],
  },
  lighthouse: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Lighthouse.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [515, -998],
      [-545, 725],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [],
  },
  reserve: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Reserve.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [289, -293],
      [-303, 244],
    ],
    svgBounds: [
      [289, -274],
      [-303, 272],
    ],
    coordinateRotation: 180,
    heightRange: [-7, 10000],
    floors: [],
  },
  shoreline: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Shoreline.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [504, -415],
      [-1056, 618],
    ],
    coordinateRotation: 180,
    heightRange: [-1000, -1],
    floors: [
      { name: "2nd Floor", svgLayer: "Second_Floor", height: [-1, 2] },
      { name: "3rd Floor", svgLayer: "Third_Floor", height: [2, 1000] },
      { name: "Underground", svgLayer: "Underground_Level", height: [-1000, -5] },
    ],
  },
  terminal: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Terminal.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [463, -580],
      [-433, 475],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [],
  },
  woods: {
    svgPath: "https://assets.tarkov.dev/maps/svg/Woods.svg",
    svgLayer: "Ground_Level",
    bounds: [
      [646, -914],
      [-761, 442],
    ],
    coordinateRotation: 180,
    heightRange: null,
    floors: [],
  },
};

/** Calibration for a map, or null where nobody has drawn an SVG for it. */
export function calibrationFor(
  map: { normalizedName: string } | null | undefined,
): MapCalibration | null {
  return (map && MAP_CALIBRATION[map.normalizedName]) ?? null;
}
