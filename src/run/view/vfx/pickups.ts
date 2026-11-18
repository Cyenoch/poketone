import {
  BoxGeometry,
  Float32BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** One flat-coloured part of a pickup, already placed. */
function paint(geometry: BufferGeometry, hex: string): BufferGeometry {
  const part = geometry.index ? geometry.toNonIndexed() : geometry;
  part.deleteAttribute("uv");
  const { r, g, b } = new Color(hex);
  const colors = new Float32Array(part.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([r, g, b], i);
  part.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return part;
}

function merge(parts: BufferGeometry[], lift = 0): BufferGeometry {
  const geometry = mergeGeometries(parts)!.translate(0, lift, 0);
  for (const part of parts) part.dispose();
  geometry.computeVertexNormals();
  return geometry;
}

/** Rare Candy (exp): a round sweet with its wrapper twisted into two fans, centred on its middle. */
export function candyGeometry(): BufferGeometry {
  const fan = (side: 1 | -1) =>
    paint(
      new ConeGeometry(0.11, 0.13, 6).rotateZ((side * Math.PI) / 2).translate(side * 0.21, 0, 0),
      "#d8f3ff",
    );
  const knot = (side: 1 | -1) =>
    paint(
      new CylinderGeometry(0.035, 0.045, 0.05, 6).rotateZ(Math.PI / 2).translate(side * 0.14, 0, 0),
      "#2f8fd6",
    );
  return merge([
    paint(new SphereGeometry(0.15, 10, 7).scale(1.05, 0.95, 0.95), "#59c8ff"),
    paint(new CylinderGeometry(0.152, 0.152, 0.05, 10).rotateZ(Math.PI / 2), "#ffffff"),
    knot(1),
    knot(-1),
    fan(1),
    fan(-1),
  ]);
}

/** Oran Berry: a blue berry with a pale crown, a stem and one leaf, centred on its body. */
export function berryGeometry(): BufferGeometry {
  return merge(
    [
      paint(new SphereGeometry(0.25, 10, 8).scale(1, 0.88, 1).translate(0, 0.22, 0), "#3d7bf0"),
      paint(
        new SphereGeometry(0.17, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2)
          .scale(1, 0.45, 1)
          .translate(0, 0.4, 0),
        "#9fd0ff",
      ),
      paint(
        new CylinderGeometry(0.018, 0.026, 0.12, 5).rotateZ(0.25).translate(-0.01, 0.47, 0),
        "#5b4228",
      ),
      paint(
        new SphereGeometry(0.1, 6, 4).scale(1.6, 0.2, 0.7).rotateZ(0.45).translate(0.1, 0.5, 0),
        "#4f9a3a",
      ),
    ],
    -0.22,
  );
}

/** Treasure chest: wooden box, domed lid, gold bands and a latch, front to +Z; base 0.3 below its origin. */
export function chestGeometry(): BufferGeometry {
  const band = (x: number) => [
    paint(new BoxGeometry(0.08, 0.36, 0.6).translate(x, 0.18, 0), "#ffd45b"),
    paint(
      new CylinderGeometry(0.305, 0.305, 0.08, 10, 1, false, 0, Math.PI)
        .rotateZ(Math.PI / 2)
        .scale(1, 0.62, 1)
        .translate(x, 0.36, 0),
      "#ffd45b",
    ),
  ];
  return merge(
    [
      paint(new BoxGeometry(0.76, 0.34, 0.56).translate(0, 0.17, 0), "#7a4424"),
      paint(new BoxGeometry(0.8, 0.04, 0.6).translate(0, 0.34, 0), "#55301a"),
      paint(
        new CylinderGeometry(0.29, 0.29, 0.76, 10, 1, false, 0, Math.PI)
          .rotateZ(Math.PI / 2)
          .scale(1, 0.62, 1)
          .translate(0, 0.36, 0),
        "#94532c",
      ),
      ...band(-0.24),
      ...band(0.24),
      paint(new BoxGeometry(0.14, 0.16, 0.04).translate(0, 0.32, 0.3), "#ffe08a"),
      paint(new BoxGeometry(0.05, 0.06, 0.02).translate(0, 0.3, 0.325), "#5a3a12"),
    ],
    -0.3,
  );
}
