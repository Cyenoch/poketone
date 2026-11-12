import { Text, withOpacity } from "@pmndrs/uikit";
import type { UiStage } from "../../../ui/gpu/stage";
import { nearestPlayer } from "../../sim/director";
import type { PlayerId } from "../../sim/state/entities";
import type { World } from "../../sim/state/world";

/** GPU text anchored in the world, projected with the same camera as damage numbers. */
export class DebugLabels {
  private readonly labels: Text[] = [];
  private readonly stage: UiStage;
  private readonly project: (x: number, y: number, z: number) => [number, number] | null;
  constructor(
    stage: UiStage,
    project: (x: number, y: number, z: number) => [number, number] | null,
  ) {
    this.stage = stage;
    this.project = project;
  }

  update(world: World, local: PlayerId): void {
    let used = 0;
    const put = (x: number, z: number, value: string) => {
      const point = this.project(x, 2.1, z);
      const v = this.stage.viewport;
      if (
        !point ||
        point[0] < 0 ||
        point[1] < 0 ||
        point[0] > v.width * v.scale ||
        point[1] > v.height * v.scale
      )
        return;
      let label = this.labels[used];
      if (!label) {
        label = new Text({
          positionType: "absolute",
          fontSize: 11,
          fontWeight: 700,
          color: "#ffffff",
          backgroundColor: withOpacity("#0d233f", 0.5),
          paddingX: 3,
          whiteSpace: "pre",
          pointerEvents: "none",
        });
        this.labels.push(label);
        this.stage.root.add(label);
      }
      label.setProperties({
        display: "flex",
        text: value,
        positionLeft: point[0] / v.scale,
        positionTop: point[1] / v.scale,
      });
      used++;
    };
    const self = world.players[local]!;
    for (const enemy of world.enemies) {
      if (Math.hypot(enemy.x - self.x, enemy.z - self.z) > 24) continue;
      const target = nearestPlayer(world, enemy.x, enemy.z);
      put(
        enemy.x,
        enemy.z,
        `${enemy.boss ? "boss " : ""}${enemy.elite ? "elite " : ""}${enemy.phase} ${enemy.phaseTime.toFixed(1)} >P${target?.id ?? "-"}`,
      );
    }
    const pad = world.map.pads.find((site) => site.tag === "landmark");
    if (pad) put(pad.x, pad.z, `guardian ${world.zone.phase}`);
    for (let i = used; i < this.labels.length; i++)
      this.labels[i]!.setProperties({ display: "none" });
  }

  dispose(): void {
    for (const label of this.labels) {
      label.removeFromParent();
      label.dispose();
    }
  }
}
