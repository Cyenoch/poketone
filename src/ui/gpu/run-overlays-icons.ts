import { Content } from "@pmndrs/uikit";
import { Box3, Mesh, MeshBasicMaterial, Path, Vector3 } from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import type { StatKey } from "../../run/sim/stats";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** The original pause and choice command SVG paths, tessellated as ordinary GPU geometry. */
export function createRunCommandIcon(name: "play" | "chart" | "reset"): Content {
  const paths =
    name === "play"
      ? [new Path().moveTo(8, 4).lineTo(20, 12).lineTo(8, 20).lineTo(8, 4)]
      : name === "reset"
        ? // ui/Icon.tsx "M4 10a8 8 0 1 1 .7 6M4 4v6h6": the arc's centre solved from its two ends.
          [
            new Path().absarc(11.708, 12.139, 8, 3.41213, 8.92213, false),
            new Path().moveTo(4, 4).lineTo(4, 10).lineTo(10, 10),
          ]
        : [
            new Path().moveTo(4, 20).lineTo(4, 10),
            new Path().moveTo(10, 20).lineTo(10, 4),
            new Path().moveTo(16, 20).lineTo(16, 13),
            new Path().moveTo(20, 20).lineTo(2, 20),
          ];
  return strokeGlyph(paths, 2.5);
}

function strokeGlyph(paths: Path[], width: number): Content {
  const style = SVGLoader.getStrokeStyle(width, "#142f50", "round", "round");
  const parts = paths.map((p) => SVGLoader.pointsToStroke(p.getPoints(24), style)!);
  const geometry = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  geometry.translate(-12, -12, 0);
  geometry.boundingBox = new Box3(new Vector3(-12, -12, 0), new Vector3(12, 12, 0));
  const material = new MeshBasicMaterial({
    color: "#142f50",
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.y = -1;
  const content = new Content({ width: 24, height: 24, flexShrink: 0, depthTest: false });
  content.add(mesh);
  content.notifyAncestorsChanged();
  content.abortSignal.addEventListener("abort", () => {
    geometry.dispose();
    material.dispose();
  });
  return content;
}

/** Stat row glyphs: 24px paths with 2.2px round strokes. */
export function createRunStatIcon(key: StatKey): Content {
  const circle = (x: number, y: number, r: number) =>
    new Path().absarc(x, y, r, 0, Math.PI * 2, false);
  let paths: Path[];
  switch (key) {
    case "maxHp": {
      const factor = Math.sqrt((4.3 ** 2 - (3.75 ** 2 + 1.4 ** 2)) / (3.75 ** 2 + 1.4 ** 2));
      const x = 8.25 + factor * 1.4,
        y = 7.61 + factor * 3.75;
      const otherX = 24 - x;
      paths = [
        new Path()
          .moveTo(12, 19.21)
          .bezierCurveTo(12, 19.21, 4.5, 14.61, 4.5, 9.01)
          .absarc(x, y, 4.3, Math.atan2(9.01 - y, 4.5 - x), Math.atan2(6.21 - y, 12 - x), false)
          .absarc(
            otherX,
            y,
            4.3,
            Math.atan2(6.21 - y, 12 - otherX),
            Math.atan2(9.01 - y, 19.5 - otherX),
            false,
          )
          .bezierCurveTo(19.5, 14.61, 12, 19.21, 12, 19.21),
      ];
      break;
    }
    case "armor":
      paths = [
        new Path()
          .moveTo(12, 3)
          .lineTo(5, 6)
          .lineTo(5, 11.5)
          .bezierCurveTo(5, 15.8, 7.9, 19.1, 12, 21)
          .bezierCurveTo(16.1, 19.1, 19, 15.8, 19, 11.5)
          .lineTo(19, 6)
          .lineTo(12, 3),
      ];
      break;
    case "regen":
      paths = [
        circle(12, 12, 9),
        new Path().moveTo(12, 7.5).lineTo(12, 16.5),
        new Path().moveTo(7.5, 12).lineTo(16.5, 12),
      ];
      break;
    case "lifesteal":
      paths = [
        new Path()
          .moveTo(12, 3.5)
          .bezierCurveTo(12, 3.5, 18, 9.9, 18, 14.3)
          .absarc(12, 14.3, 6, 0, Math.PI, false)
          .bezierCurveTo(6, 9.9, 12, 3.5, 12, 3.5),
        new Path().absarc(12, 14.5, 2.5, Math.PI, Math.PI / 2, true),
      ];
      break;
    case "thorns":
      paths = [
        new Path().moveTo(3, 19).lineTo(21, 19),
        new Path().moveTo(5, 19).lineTo(7.5, 8).lineTo(10, 19),
        new Path().moveTo(11, 19).lineTo(12, 5).lineTo(13, 19),
        new Path().moveTo(14, 19).lineTo(16.5, 8).lineTo(19, 19),
      ];
      break;
    case "damage":
      paths = [
        new Path().moveTo(19.5, 4.5).lineTo(9, 15),
        new Path().moveTo(19.5, 4.5).lineTo(15, 4.5),
        new Path().moveTo(19.5, 4.5).lineTo(19.5, 9),
        new Path().moveTo(6, 12).lineTo(12, 18),
        new Path().moveTo(4.5, 19.5).lineTo(7.5, 16.5),
      ];
      break;
    case "crit":
      paths = [
        circle(12, 12, 7),
        new Path().moveTo(12, 2).lineTo(12, 8),
        new Path().moveTo(12, 16).lineTo(12, 22),
        new Path().moveTo(2, 12).lineTo(8, 12),
        new Path().moveTo(16, 12).lineTo(22, 12),
      ];
      break;
    case "cooldown":
      paths = [circle(12, 12, 9), new Path().moveTo(12, 7.5).lineTo(12, 12).lineTo(15, 14)];
      break;
    case "area":
      paths = [circle(12, 12, 3), circle(12, 12, 9)];
      break;
    case "ultCharge":
      paths = [
        new Path()
          .moveTo(12, 3)
          .lineTo(14.6, 9.4)
          .lineTo(21, 12)
          .lineTo(14.6, 14.6)
          .lineTo(12, 21)
          .lineTo(9.4, 14.6)
          .lineTo(3, 12)
          .lineTo(9.4, 9.4)
          .lineTo(12, 3),
      ];
      break;
    case "speed":
      paths = [
        new Path()
          .moveTo(3, 10)
          .lineTo(13.5, 10)
          .absarc(13.5, 7, 3, Math.PI / 2, Math.PI, true),
        new Path()
          .moveTo(3, 14)
          .lineTo(18, 14)
          .absarc(18, 17, 3, -Math.PI / 2, Math.PI, false),
        new Path().moveTo(3, 18).lineTo(10, 18),
      ];
      break;
    case "pickup":
      paths = [
        new Path()
          .moveTo(6, 4.75)
          .lineTo(6, 13.25)
          .absarc(12, 13.25, 6, Math.PI, 0, true)
          .lineTo(18, 4.75)
          .lineTo(14, 4.75)
          .lineTo(14, 13.25)
          .absarc(12, 13.25, 2, 0, Math.PI, false)
          .lineTo(10, 4.75)
          .lineTo(6, 4.75),
        new Path().moveTo(6, 8.75).lineTo(10, 8.75),
        new Path().moveTo(14, 8.75).lineTo(18, 8.75),
      ];
      break;
    case "xp":
      paths = [
        new Path().moveTo(6, 12).lineTo(12, 6).lineTo(18, 12),
        new Path().moveTo(6, 18).lineTo(12, 12).lineTo(18, 18),
      ];
      break;
    case "stardust": {
      const top = new Path()
        .moveTo(12, 4)
        .bezierCurveTo(16.1, 4, 19.5, 5.3, 19.5, 7)
        .bezierCurveTo(19.5, 8.7, 16.1, 10, 12, 10)
        .bezierCurveTo(7.9, 10, 4.5, 8.7, 4.5, 7)
        .bezierCurveTo(4.5, 5.3, 7.9, 4, 12, 4);
      paths = [
        top,
        ...[7, 12].map((y) =>
          new Path()
            .moveTo(4.5, y)
            .lineTo(4.5, y + 5)
            .bezierCurveTo(4.5, y + 6.7, 7.9, y + 8, 12, y + 8)
            .bezierCurveTo(16.1, y + 8, 19.5, y + 6.7, 19.5, y + 5)
            .lineTo(19.5, y),
        ),
      ];
      break;
    }
    case "luck":
      paths = [
        new Path()
          .moveTo(12, 11.5)
          .bezierCurveTo(9, 8.5, 9, 4.5, 12, 4.5)
          .bezierCurveTo(15, 4.5, 15, 8.5, 12, 11.5),
        new Path()
          .moveTo(12, 11.5)
          .bezierCurveTo(15, 8.5, 19, 8.5, 19, 11.5)
          .bezierCurveTo(19, 14.5, 15, 14.5, 12, 11.5),
        new Path()
          .moveTo(12, 11.5)
          .bezierCurveTo(15, 14.5, 15, 18.5, 12, 18.5)
          .bezierCurveTo(9, 18.5, 9, 14.5, 12, 11.5),
        new Path()
          .moveTo(12, 11.5)
          .bezierCurveTo(9, 14.5, 5, 14.5, 5, 11.5)
          .bezierCurveTo(5, 8.5, 9, 8.5, 12, 11.5),
        new Path().moveTo(12, 11.5).lineTo(15.5, 19.5),
      ];
      break;
    case "healing":
      // A first-aid box: a rounded square with a cross.
      paths = [
        new Path()
          .moveTo(7, 4.5)
          .lineTo(17, 4.5)
          .absarc(17, 7, 2.5, -Math.PI / 2, 0, false)
          .lineTo(19.5, 17)
          .absarc(17, 17, 2.5, 0, Math.PI / 2, false)
          .lineTo(7, 19.5)
          .absarc(7, 17, 2.5, Math.PI / 2, Math.PI, false)
          .lineTo(4.5, 7)
          .absarc(7, 7, 2.5, Math.PI, Math.PI * 1.5, false),
        new Path().moveTo(12, 8).lineTo(12, 16),
        new Path().moveTo(8, 12).lineTo(16, 12),
      ];
      break;
    case "shield":
      // A bubble with its highlight.
      paths = [
        circle(12, 12, 9),
        new Path().absarc(12, 12, 5.5, Math.PI * 1.1, Math.PI * 1.55, false),
      ];
      break;
    case "evasion":
      // A path swerving round: an arc with its arrowhead.
      paths = [
        new Path().moveTo(4, 17).bezierCurveTo(7, 6, 17, 6, 20, 17),
        new Path().moveTo(16.5, 15.5).lineTo(20, 17).lineTo(21, 13.5),
      ];
      break;
    case "damageTaken":
      // A cracked shield.
      paths = [
        new Path()
          .moveTo(12, 3)
          .lineTo(5, 6)
          .lineTo(5, 11.5)
          .bezierCurveTo(5, 15.8, 7.9, 19.1, 12, 21)
          .bezierCurveTo(16.1, 19.1, 19, 15.8, 19, 11.5)
          .lineTo(19, 6)
          .lineTo(12, 3),
        new Path().moveTo(12, 6).lineTo(10, 11).lineTo(14, 13).lineTo(12, 18),
      ];
      break;
    case "critDamage":
      // The crit sight with a filled-in centre.
      paths = [
        circle(12, 12, 7),
        circle(12, 12, 2.5),
        new Path().moveTo(12, 2).lineTo(12, 6),
        new Path().moveTo(12, 18).lineTo(12, 22),
        new Path().moveTo(2, 12).lineTo(6, 12),
        new Path().moveTo(18, 12).lineTo(22, 12),
      ];
      break;
    case "projectiles":
      paths = [circle(5, 12, 2.4), circle(12, 12, 2.4), circle(19, 12, 2.4)];
      break;
    case "projSpeed":
      // A shot with its speed lines.
      paths = [
        circle(17, 12, 3.5),
        new Path().moveTo(3, 8.5).lineTo(11, 8.5),
        new Path().moveTo(5, 12).lineTo(11.5, 12),
        new Path().moveTo(3, 15.5).lineTo(11, 15.5),
      ];
      break;
    case "duration":
      // An hourglass.
      paths = [new Path().moveTo(6, 3).lineTo(18, 3).lineTo(6, 21).lineTo(18, 21).lineTo(6, 3)];
      break;
    case "statusChance":
      // Spore bubbles.
      paths = [circle(9, 14.5, 4.5), circle(16.5, 8.5, 3), circle(17.5, 17, 2)];
      break;
    case "statusDamage":
      // A flask.
      paths = [
        new Path().moveTo(8.5, 3).lineTo(15.5, 3),
        new Path()
          .moveTo(10, 3)
          .lineTo(10, 9)
          .lineTo(5, 19.5)
          .lineTo(19, 19.5)
          .lineTo(14, 9)
          .lineTo(14, 3),
        new Path().moveTo(7.5, 14.5).lineTo(16.5, 14.5),
      ];
      break;
    case "dashCharges":
      // Double chevron: more than one dash.
      paths = [
        new Path().moveTo(5, 6).lineTo(11, 12).lineTo(5, 18),
        new Path().moveTo(12, 6).lineTo(18, 12).lineTo(12, 18),
      ];
      break;
    case "partnerDamage":
      // Two heads side by side.
      paths = [
        circle(8, 8.5, 3),
        circle(16, 8.5, 3),
        new Path().absarc(8, 19.5, 5, Math.PI, 0, false),
        new Path().absarc(16, 19.5, 5, Math.PI, 0, false),
      ];
      break;
    case "partnerRate":
      // A head with a quick-strike chevron: partners act more often.
      paths = [
        circle(9, 8.5, 3),
        new Path().absarc(9, 19.5, 5, Math.PI, 0, false),
        new Path().moveTo(15, 7).lineTo(19.5, 12).lineTo(15, 17),
      ];
      break;
    case "guardRest":
      // A shield with a clock hand: time between guards.
      paths = [
        new Path()
          .moveTo(12, 3)
          .lineTo(19.5, 6)
          .lineTo(19, 13)
          .quadraticCurveTo(17.5, 18.5, 12, 21)
          .quadraticCurveTo(6.5, 18.5, 5, 13)
          .lineTo(4.5, 6)
          .lineTo(12, 3),
        new Path().moveTo(12, 8).lineTo(12, 12.5).lineTo(15, 14.5),
      ];
      break;
    case "pierce":
      // An arrow passing through a bar.
      paths = [
        new Path().moveTo(3, 12).lineTo(20, 12),
        new Path().moveTo(15.5, 7.5).lineTo(20, 12).lineTo(15.5, 16.5),
        new Path().moveTo(10, 5).lineTo(10, 19),
      ];
      break;
    case "spawns":
      paths = [circle(6.5, 15.5, 3), circle(12, 7.5, 3), circle(17.5, 15.5, 3)];
      break;
    case "elites":
      // A crown.
      paths = [
        new Path()
          .moveTo(4, 18)
          .lineTo(4, 8)
          .lineTo(8.5, 12.5)
          .lineTo(12, 5.5)
          .lineTo(15.5, 12.5)
          .lineTo(20, 8)
          .lineTo(20, 18)
          .lineTo(4, 18),
      ];
      break;
  }
  return strokeGlyph(paths, 2.2);
}
