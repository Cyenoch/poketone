/** View-only switches; never saved in World or sent over multiplayer. */
export const debugLayers = [
  "bodies",
  "nav",
  "flow",
  "spawn",
  "states",
  "hits",
  "sites",
  "aim",
] as const;
export type DebugLayer = (typeof debugLayers)[number];

export function layerLegend(enabled: ReadonlySet<DebugLayer>): string {
  return [0, 4]
    .map((start) =>
      debugLayers
        .slice(start, start + 4)
        .map((name, i) => `${start + i + 1} ${enabled.has(name) ? `[${name}]` : name}`)
        .join("  "),
    )
    .join("\n");
}
