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
  | "lock"
  | "heart"
  | LabIconName
  | RuleIconName
  | BadgeIconName;

/** The 研究所's places, research tasks and unlock kinds. */
export type LabIconName =
  | "eye"
  | "defeat"
  | "binder"
  | "flask"
  | "case"
  | "drawer"
  | "pin"
  | "event"
  | "ability"
  | "flag";

/** Challenge rules (`sim/content/rules.ts`), drawn with the same stroke as every menu icon. */
export type RuleIconName =
  | "rule-nuzlocke"
  | "rule-level-cap"
  | "rule-no-items"
  | "rule-mono-type"
  | "rule-alpha-elites"
  | "rule-wild-weather";
/** The eight gym badges (`sim/content/badges.ts`), each its Kanto outline. */
export type BadgeIconName =
  | "badge-boulder"
  | "badge-cascade"
  | "badge-thunder"
  | "badge-rainbow"
  | "badge-soul"
  | "badge-marsh"
  | "badge-volcano"
  | "badge-earth";

/** A closed polygon through `points`. */
function polygon(points: readonly (readonly [number, number])[]): Path {
  const path = new Path().moveTo(points[0]![0], points[0]![1]);
  for (const [x, y] of points.slice(1)) path.lineTo(x, y);
  return path.lineTo(points[0]![0], points[0]![1]);
}

/** A star of `count` points about (12, 12). */
function star(count: number, outer: number, inner: number): Path {
  const points: [number, number][] = [];
  for (let i = 0; i < count * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / count;
    points.push([12 + r * Math.cos(a), 12 + r * Math.sin(a)]);
  }
  return polygon(points);
}

const circle = (x: number, y: number, r: number) =>
  new Path().absarc(x, y, r, 0, Math.PI * 2, false);

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
    case "eye":
      return [
        path.moveTo(2, 12).quadraticCurveTo(12, 2, 22, 12).quadraticCurveTo(12, 22, 2, 12),
        circle(12, 12, 3),
      ];
    case "defeat":
      return [
        path.moveTo(5, 5).lineTo(19, 19),
        new Path().moveTo(19, 5).lineTo(5, 19),
        new Path().moveTo(3, 9).lineTo(3, 3).lineTo(9, 3),
        new Path().moveTo(21, 15).lineTo(21, 21).lineTo(15, 21),
      ];
    case "binder":
      return [
        roundRect(5, 3, 14, 18, 2),
        new Path().moveTo(9, 3).lineTo(9, 21),
        new Path().moveTo(12, 8).lineTo(16, 8),
        circle(9, 15, 1.5),
      ];
    case "flask":
      return [
        path
          .moveTo(9, 3)
          .lineTo(9, 9)
          .lineTo(4, 19)
          .lineTo(5, 21)
          .lineTo(19, 21)
          .lineTo(20, 19)
          .lineTo(15, 9)
          .lineTo(15, 3),
        new Path().moveTo(8, 3).lineTo(16, 3),
        new Path().moveTo(7, 15).lineTo(17, 15),
      ];
    case "case":
      return [
        roundRect(2, 4, 20, 16, 2),
        circle(8, 10, 2),
        circle(16, 10, 2),
        new Path().moveTo(6, 16).lineTo(18, 16),
      ];
    case "drawer":
      return [
        roundRect(3, 4, 18, 16, 2),
        new Path().moveTo(3, 12).lineTo(21, 12),
        new Path().moveTo(10, 8).lineTo(14, 8),
        new Path().moveTo(10, 16).lineTo(14, 16),
      ];
    case "pin":
      return [
        path
          .moveTo(12, 21)
          .bezierCurveTo(5, 13, 5, 10, 5, 9)
          .absarc(12, 9, 7, Math.PI, 0, false)
          .bezierCurveTo(19, 10, 19, 13, 12, 21),
        circle(12, 9, 2.5),
      ];
    case "event":
      return [
        roundRect(3, 3, 18, 14, 3),
        new Path().moveTo(8, 17).lineTo(7, 21).lineTo(12, 17),
        new Path().moveTo(12, 6).lineTo(12, 11),
        new Path().moveTo(12, 13.5).lineTo(12, 14),
      ];
    case "ability":
      return [circle(12, 12, 9), star(5, 5.5, 2.5)];
    case "flag":
      return [
        path.moveTo(5, 21).lineTo(5, 3),
        new Path().moveTo(5, 4).lineTo(19, 4).lineTo(15, 8.5).lineTo(19, 13).lineTo(5, 13),
      ];
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
    case "heart":
      path
        .moveTo(12, 20)
        .bezierCurveTo(6, 15.5, 3, 12.5, 3, 9)
        .bezierCurveTo(3, 6.2, 5.2, 4.5, 7.5, 4.5)
        .bezierCurveTo(9.4, 4.5, 11.1, 5.6, 12, 7.4)
        .bezierCurveTo(12.9, 5.6, 14.6, 4.5, 16.5, 4.5)
        .bezierCurveTo(18.8, 4.5, 21, 6.2, 21, 9)
        .bezierCurveTo(21, 12.5, 18, 15.5, 12, 20);
      return [path];
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
    // A gravestone: who falls stays down.
    case "rule-nuzlocke":
      return [
        path.moveTo(6, 20).lineTo(6, 10).absarc(12, 10, 6, Math.PI, 0, false).lineTo(18, 20),
        new Path().moveTo(3, 20).lineTo(21, 20),
        new Path().moveTo(12, 8).lineTo(12, 15),
        new Path().moveTo(9.5, 10.5).lineTo(14.5, 10.5),
      ];
    // An arrow stopped under a ceiling.
    case "rule-level-cap":
      return [
        path.moveTo(4, 4).lineTo(20, 4),
        new Path().moveTo(12, 21).lineTo(12, 9),
        new Path().moveTo(7, 14).lineTo(12, 9).lineTo(17, 14),
      ];
    // The bag, struck through.
    case "rule-no-items":
      return [
        roundRect(5, 9, 14, 11, 2.5),
        new Path().moveTo(9, 9).lineTo(9, 7).absarc(12, 7, 3, Math.PI, 0, false).lineTo(15, 9),
        new Path().moveTo(3.5, 3.5).lineTo(20.5, 20.5),
      ];
    // One gem: a single type.
    case "rule-mono-type":
      return [
        polygon([
          [12, 3],
          [20, 12],
          [12, 21],
          [4, 12],
        ]),
        polygon([
          [12, 8.5],
          [15.5, 12],
          [12, 15.5],
          [8.5, 12],
        ]),
      ];
    // A crown: every elite an alpha.
    case "rule-alpha-elites":
      return [
        polygon([
          [3.5, 18],
          [3.5, 8],
          [8, 12],
          [12, 5],
          [16, 12],
          [20.5, 8],
          [20.5, 18],
        ]),
        new Path().moveTo(3.5, 21).lineTo(20.5, 21),
      ];
    // A storm cloud.
    case "rule-wild-weather":
      return [
        path
          .moveTo(7.5, 15)
          .bezierCurveTo(3.5, 15, 3, 9.5, 7.5, 9)
          .bezierCurveTo(8.5, 5, 15, 4.5, 16.5, 8.5)
          .bezierCurveTo(21, 8.5, 21.5, 15, 16.5, 15),
        new Path().moveTo(12.5, 12).lineTo(10, 17).lineTo(14, 17).lineTo(11.5, 22),
      ];
    case "badge-boulder":
      return [
        polygon([
          [8, 3],
          [16, 3],
          [21, 8],
          [21, 16],
          [16, 21],
          [8, 21],
          [3, 16],
          [3, 8],
        ]),
        new Path().moveTo(3, 8).lineTo(12, 12).lineTo(21, 8),
        new Path().moveTo(12, 12).lineTo(12, 21),
      ];
    case "badge-cascade":
      return [
        path
          .moveTo(12, 3)
          .bezierCurveTo(14, 7, 19, 10.5, 19, 14.5)
          .bezierCurveTo(19, 18.6, 15.9, 21.5, 12, 21.5)
          .bezierCurveTo(8.1, 21.5, 5, 18.6, 5, 14.5)
          .bezierCurveTo(5, 10.5, 10, 7, 12, 3),
      ];
    case "badge-thunder":
      return [star(8, 10, 5), circle(12, 12, 2.5)];
    case "badge-rainbow":
      return [
        circle(12, 12, 2.5),
        ...[0, 1, 2, 3, 4, 5].map((i) => {
          const a = -Math.PI / 2 + (i * Math.PI) / 3;
          const x = 12 + 6 * Math.cos(a),
            y = 12 + 6 * Math.sin(a);
          return new Path().absellipse(x, y, 2.4, 4, 0, Math.PI * 2, false, a + Math.PI / 2);
        }),
      ];
    case "badge-soul":
      return [
        path
          .moveTo(12, 20.5)
          .bezierCurveTo(4, 15, 2, 10, 5.5, 6.5)
          .bezierCurveTo(8.5, 3.7, 11, 5.5, 12, 7.5)
          .bezierCurveTo(13, 5.5, 15.5, 3.7, 18.5, 6.5)
          .bezierCurveTo(22, 10, 20, 15, 12, 20.5),
      ];
    case "badge-marsh":
      return [circle(12, 12, 9), circle(12, 12, 4.5)];
    case "badge-volcano":
      return [
        path
          .moveTo(12, 3)
          .bezierCurveTo(13, 7, 19, 9.5, 19, 15)
          .bezierCurveTo(19, 18.9, 15.9, 21.5, 12, 21.5)
          .bezierCurveTo(8.1, 21.5, 5, 18.9, 5, 15)
          .bezierCurveTo(5, 11.5, 7.5, 9.5, 8.5, 7)
          .bezierCurveTo(9.5, 9, 10, 10, 10.5, 11)
          .bezierCurveTo(11, 8, 11.5, 5.5, 12, 3),
        new Path()
          .moveTo(12, 21.5)
          .bezierCurveTo(10, 21.5, 9, 19.5, 9.5, 17.5)
          .bezierCurveTo(10, 15.5, 12, 14, 12, 12.5)
          .bezierCurveTo(13.5, 14, 15, 16, 14.5, 18)
          .bezierCurveTo(14.2, 20, 13.2, 21.5, 12, 21.5),
      ];
    case "badge-earth":
      return [
        path
          .moveTo(4.5, 19.5)
          .bezierCurveTo(4.5, 10, 10.5, 4.5, 20, 4.5)
          .bezierCurveTo(20, 14, 14, 19.5, 4.5, 19.5),
        new Path().moveTo(4.5, 19.5).lineTo(15, 9),
      ];
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
