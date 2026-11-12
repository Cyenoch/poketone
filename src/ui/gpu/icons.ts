import { Content } from "@pmndrs/uikit";
import { Box3, Mesh, MeshBasicMaterial, Path, Vector3 } from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type MenuIconName =
  | "spark"
  | "coin"
  | "settings"
  | "fullscreen"
  | "exit-fullscreen"
  | "cube"
  | "chevron"
  | "close"
  | "minus"
  | "plus"
  | "upload"
  | "back"
  | "arrow"
  | "check"
  | "person"
  | "spinner"
  | "danger"
  | "erase"
  | "backpack"
  | "lock";

/** A closed rounded rectangle path. */
function roundRect(x: number, y: number, w: number, h: number, r: number): Path {
  return new Path()
    .moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r)
    .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h)
    .quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r)
    .quadraticCurveTo(x, y, x + r, y);
}

/** Same paths and 2.5px round stroke as ui/Icon.tsx; tessellated directly, without a DOM parser. */
function paths(name: MenuIconName): Path[] {
  const path = new Path();
  switch (name) {
    case "person":
      return [
        path.absarc(12, 7, 4, 0, Math.PI * 2, false),
        new Path().moveTo(4, 21).lineTo(4, 19).bezierCurveTo(4, 10, 20, 10, 20, 19).lineTo(20, 21),
      ];
    case "spinner":
      return [path.absarc(12, 12, 8, 0, Math.PI * 1.5, false)];
    case "danger":
      return [
        path.moveTo(12, 3).lineTo(22, 21).lineTo(2, 21).lineTo(12, 3),
        new Path().moveTo(12, 9).lineTo(12, 14),
        new Path().moveTo(12, 17).lineTo(12, 17.5),
      ];
    case "erase":
      return [
        path.moveTo(8, 5).lineTo(22, 5).lineTo(22, 19).lineTo(8, 19).lineTo(2, 12).lineTo(8, 5),
        new Path().moveTo(11, 9).lineTo(17, 15),
        new Path().moveTo(17, 9).lineTo(11, 15),
      ];
    case "exit-fullscreen":
      return [
        path.moveTo(4, 9).lineTo(9, 9).lineTo(9, 4),
        new Path().moveTo(15, 4).lineTo(15, 9).lineTo(20, 9),
        new Path().moveTo(4, 15).lineTo(9, 15).lineTo(9, 20),
        new Path().moveTo(15, 20).lineTo(15, 15).lineTo(20, 15),
      ];
    case "fullscreen":
      return [
        path.moveTo(9, 4).lineTo(4, 4).lineTo(4, 9),
        new Path().moveTo(15, 4).lineTo(20, 4).lineTo(20, 9),
        new Path().moveTo(4, 15).lineTo(4, 20).lineTo(9, 20),
        new Path().moveTo(15, 20).lineTo(20, 20).lineTo(20, 15),
      ];
    case "upload":
      return [
        path.moveTo(12, 16).lineTo(12, 3),
        new Path().moveTo(7, 8).lineTo(12, 3).lineTo(17, 8),
        new Path().moveTo(4, 15).lineTo(4, 20).lineTo(20, 20).lineTo(20, 15),
      ];
    case "close":
      return [path.moveTo(6, 6).lineTo(18, 18), new Path().moveTo(6, 18).lineTo(18, 6)];
    case "back":
      return [
        path.moveTo(20, 12).lineTo(4, 12),
        new Path().moveTo(10, 6).lineTo(4, 12).lineTo(10, 18),
      ];
    case "arrow":
      return [
        path.moveTo(4, 12).lineTo(20, 12),
        new Path().moveTo(14, 6).lineTo(20, 12).lineTo(14, 18),
      ];
    case "check":
      return [path.moveTo(5, 12).lineTo(9.5, 16.5).lineTo(19, 7)];
    case "backpack":
      // A backpack: handle, body, flap and buckle (no shackle, so it never reads as a lock).
      return [
        new Path()
          .moveTo(9.5, 6)
          .lineTo(9.5, 4.5)
          .quadraticCurveTo(9.5, 3, 11, 3)
          .lineTo(13, 3)
          .quadraticCurveTo(14.5, 3, 14.5, 4.5)
          .lineTo(14.5, 6),
        roundRect(4.5, 6, 15, 15.5, 3.5),
        new Path().moveTo(4.5, 12.5).lineTo(19.5, 12.5),
        new Path().moveTo(12, 12.5).lineTo(12, 15.5),
      ];
    case "lock":
      return [
        new Path().moveTo(8, 11).lineTo(8, 8).absarc(12, 8, 4, Math.PI, 0, false).lineTo(16, 11),
        roundRect(5, 11, 14, 10, 2),
      ];
    case "minus":
      return [path.moveTo(5, 12).lineTo(19, 12)];
    case "plus":
      return [path.moveTo(5, 12).lineTo(19, 12), new Path().moveTo(12, 5).lineTo(12, 19)];
    case "spark":
      path
        .moveTo(12, 3)
        .lineTo(14.6, 9.4)
        .lineTo(21, 12)
        .lineTo(14.6, 14.6)
        .lineTo(12, 21)
        .lineTo(9.4, 14.6)
        .lineTo(3, 12)
        .lineTo(9.4, 9.4)
        .lineTo(12, 3);
      return [path];
    case "chevron":
      return [path.moveTo(9, 5).lineTo(16, 12).lineTo(9, 19)];
    case "coin": {
      path.absellipse(12, 7, 7.5, 3, 0, Math.PI * 2, false, 0);
      const rows = [7, 12].map((y) =>
        new Path()
          .moveTo(4.5, y)
          .lineTo(4.5, y + 5)
          .bezierCurveTo(4.5, y + 6.7, 7.9, y + 8, 12, y + 8)
          .bezierCurveTo(16.1, y + 8, 19.5, y + 6.7, 19.5, y + 5)
          .lineTo(19.5, y),
      );
      return [path, ...rows];
    }
    case "settings": {
      const points = [
        [10, 3],
        [9.4, 5.2],
        [7.4, 6.1],
        [5.4, 5.5],
        [3.4, 9],
        [4.9, 10.6],
        [4.9, 13.4],
        [3.4, 15],
        [5.4, 18.5],
        [7.4, 17.9],
        [9.4, 18.8],
        [10, 21],
        [14, 21],
        [14.6, 18.8],
        [16.6, 17.9],
        [18.6, 18.5],
        [20.6, 15],
        [19.1, 13.4],
        [19.1, 10.6],
        [20.6, 9],
        [18.6, 5.5],
        [16.6, 6.1],
        [14.6, 5.2],
        [14, 3],
        [10, 3],
      ];
      path.moveTo(10, 3);
      for (const [x, y] of points.slice(1)) path.lineTo(x!, y!);
      const circle = new Path();
      circle.absarc(12, 12, 3, 0, Math.PI * 2, false);
      return [path, circle];
    }
    case "cube":
      return [
        path
          .moveTo(12, 3)
          .lineTo(20, 7.5)
          .lineTo(20, 16.5)
          .lineTo(12, 21)
          .lineTo(4, 16.5)
          .lineTo(4, 7.5)
          .lineTo(12, 3),
        new Path().moveTo(12, 12).lineTo(4, 7.5),
        new Path().moveTo(12, 12).lineTo(20, 7.5),
        new Path().moveTo(12, 12).lineTo(12, 21),
        new Path().moveTo(8, 5.2).lineTo(16, 9.8),
      ];
  }
}

/** Layout owns the 24×24 view box; strokes remain geometry when scaling, clipping or recoloring. */
export function menuIconGeometry(name: MenuIconName) {
  const style = SVGLoader.getStrokeStyle(2.5, "#142f50", "round", "round");
  const parts = paths(name).map((path) => SVGLoader.pointsToStroke(path.getPoints(24), style)!);
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.translate(-12, -12, 0);
  geometry.boundingBox = new Box3(new Vector3(-12, -12, 0), new Vector3(12, 12, 0));
  return geometry;
}

export function createMenuIcon(name: MenuIconName): Content {
  const geometry = menuIconGeometry(name);
  const material = new MeshBasicMaterial({
    color: "#142f50",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  // Keep the reflection in the object matrix so Three also reverses triangle front faces.
  mesh.scale.y = -1;
  const icon = new Content({ width: 24, height: 24, flexShrink: 0, depthTest: false });
  icon.add(mesh);
  icon.notifyAncestorsChanged();
  icon.abortSignal.addEventListener("abort", () => {
    geometry.dispose();
    material.dispose();
  });
  return icon;
}
