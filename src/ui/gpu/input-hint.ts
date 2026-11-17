import { InputGlyph } from "./input-glyph";
import { Component, Container, Text } from "@pmndrs/uikit";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial } from "three";
import type { UiStage } from "./stage";
import { slantOf, ui } from "./tokens";

/** Keyboard hint uses measured content width, on an ink backing whose left edge leans −14°. */
export class InputHint {
  readonly content = new Container({
    positionType: "absolute",
    positionRight: 0,
    positionBottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 50,
    paddingRight: 30,
    paddingY: 12,
    minHeight: 51,
    color: ui.mist,
    fontSize: 13,
  });
  private readonly geometry = new BufferGeometry();
  private readonly material = new MeshBasicMaterial({
    color: ui.ink,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  private readonly backing = new Mesh(this.geometry, this.material);
  private width = 0;
  private height = 0;
  private bottom = 0;
  private readonly stage: UiStage;

  constructor(stage: UiStage, parent: Container) {
    this.stage = stage;
    for (const [key, label] of [
      ["↑↓", "选择"],
      ["Enter", "确认"],
    ]) {
      this.content.add(
        new InputGlyph(key === "Enter" ? "confirm" : "down", key!),
        new Text({ text: label, whiteSpace: "pre" }),
      );
    }
    parent.add(this.content);
    this.backing.renderOrder = -5;
    stage.scene.add(this.backing);
  }

  private shown = true;
  private coarsePointer = false;

  resize(coarsePointer: boolean): void {
    const { height, safeArea } = this.stage.viewport;
    this.content.setProperties({
      display: coarsePointer ? "none" : "flex",
      fontSize: height <= 560 ? 11 : 13,
      minHeight: height <= 560 ? 40 : 51,
      paddingTop: height <= 560 ? 8 : 12,
      paddingRight: Math.max(30, safeArea.right),
      paddingBottom: Math.max(height <= 560 ? 8 : 12, safeArea.bottom),
    });
    this.coarsePointer = coarsePointer;
    this.backing.visible = this.shown && !coarsePointer;
    this.stage.invalidate();
  }

  /** The backing lives outside the UIKit tree, so hiding the tree does not hide it. */
  setShown(shown: boolean): void {
    this.shown = shown;
    this.backing.visible = shown && !this.coarsePointer;
  }

  afterLayout(): void {
    const size = this.content.size.value,
      matrix = this.content.globalMatrix.value;
    if (!size || !matrix || !this.backing.visible) return;
    const [width, height] = size;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      const x = -width / 2,
        y = height / 2;
      this.geometry.setAttribute(
        "position",
        new Float32BufferAttribute(
          [x + slantOf(height), y, 0, x, -y, 0, -x, y, 0, -x, y, 0, x, -y, 0, -x, -y, 0],
          3,
        ),
      );
      this.geometry.computeBoundingSphere();
      this.stage.invalidate();
    }
    this.backing.position.setFromMatrixPosition(matrix);
  }

  setBottom(bottom: number): void {
    if (bottom === this.bottom) return;
    this.bottom = bottom;
    this.content.setProperties({ positionBottom: bottom });
  }

  dispose(): void {
    const components: { dispose(): void }[] = [];
    this.content.traverse((node) => {
      if (node instanceof Component) components.push(node);
    });
    for (const node of components.reverse()) node.dispose();
    this.backing.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
