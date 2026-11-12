import { Content } from "@pmndrs/uikit";
import { Mesh, MeshBasicMaterial } from "three";
import { menuIconGeometry } from "./icons";

/** All fullscreen controls show the action they will perform. */
export class FullscreenIcon extends Content {
  private readonly enter = menuIconGeometry("fullscreen");
  private readonly exit = menuIconGeometry("exit-fullscreen");
  private readonly mesh: Mesh;

  constructor() {
    super({ width: 24, height: 24, flexShrink: 0, depthTest: false });
    const material = new MeshBasicMaterial({
      color: "#142f50",
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.enter, material);
    this.mesh.scale.y = -1;
    this.add(this.mesh);
    this.notifyAncestorsChanged();
    this.abortSignal.addEventListener("abort", () => {
      this.enter.dispose();
      this.exit.dispose();
      material.dispose();
    });
  }

  setActive(active: boolean): boolean {
    const geometry = active ? this.exit : this.enter;
    if (this.mesh.geometry === geometry) return false;
    this.mesh.geometry = geometry;
    return true;
  }
}
