import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import sharp from "sharp";
import { Group, ShaderLib } from "three";
import { assetUrls } from "./web-build.mjs";
import { nativeResources } from "../src/platform/native/resources.ts";
import { installResources } from "../src/platform/resources.ts";
import { formDefs } from "../src/run/sim/content/lines/index.ts";
import {
  formModels,
  instantiate,
  lineNeeds,
  loadRunAssets,
  models,
  shinyMapNeed,
} from "../src/run/view/assets.ts";
import { createWindUniforms } from "../src/run/view/environment/wind.ts";
import { mountRig } from "../src/run/view/playerRig.ts";
import { stageThemes } from "../src/run/view/stageThemes.ts";
import { shinyTextureUrl } from "../src/run/view/shiny.ts";

const root = resolve(import.meta.dir, "..");
const output = process.env.SHINY_ASSET_ROOT ?? root;
const publicFile = (base, path) => resolve(base, "public", `.${path}`);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const body = (instance) => instance.root.getObjectByProperty("isSkinnedMesh", true);
function uniforms(material, kind) {
  const shader = { ...ShaderLib[kind], uniforms: {} };
  material.onBeforeCompile(shader);
  return shader.uniforms;
}

test("每个正式形态都有可寻址的异色头像，透明轮廓和登记的保护区域保持原样", async () => {
  const urls = assetUrls(output);
  for (const form of Object.keys(formDefs)) {
    const portrait = `/art/portraits/${form}-shiny.webp`;
    for (const path of [portrait, shinyTextureUrl(form)].filter(Boolean)) {
      const hash = sha(await readFile(publicFile(output, path))).slice(0, 16);
      assert.equal(urls[path], path.replace(/(\.[^.]+)$/, `.${hash}$1`), form);
    }
    const decode = (path) => sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [normal, shiny] = await Promise.all([
      decode(publicFile(root, `/art/portraits/${form}.webp`)),
      decode(publicFile(output, portrait)),
    ]);
    assert.equal(shiny.info.width, normal.info.width, form);
    assert.equal(shiny.info.height, normal.info.height, form);
    let changed = false;
    for (let offset = 0; offset < normal.data.length; offset += 4) {
      assert.equal(shiny.data[offset + 3], normal.data[offset + 3], form);
      if (normal.data[offset + 3] && !changed)
        changed = !shiny.data
          .subarray(offset, offset + 3)
          .equals(normal.data.subarray(offset, offset + 3));
    }
    assert.ok(changed, `${form} 的可见像素应有换色`);
    const protectedPixel = { charmander: [71, 103], squirtle: [155, 76] }[form];
    if (protectedPixel) {
      const [x, y] = protectedPixel;
      const start = 4 * (normal.info.width * y + x);
      assert.deepEqual(
        shiny.data.subarray(start, start + 4),
        normal.data.subarray(start, start + 4),
        form,
      );
    }
  }
});

test("转台和局内同形态可同时穿两种外观，已预载的进化形态可重复挂载", async () => {
  const original = nativeResources(pathToFileURL(resolve(root, "public") + "/"));
  const staged = nativeResources(pathToFileURL(resolve(output, "public") + "/"));
  const reads = [];
  installResources({
    ...original,
    read(path, options) {
      reads.push(path);
      return (path.startsWith("/textures/shiny/") ? staged : original).read(path, options);
    },
  });
  const world = {
    stage: "forest",
    enemies: [],
    partners: [],
    players: [
      { trainer: "chengxi", starter: "squirtle" },
      { trainer: "chengxi", starter: "squirtle" },
    ],
  };
  const run = await loadRunAssets(world, new AbortController().signal, undefined, [false, true]);
  try {
    const requested = reads.filter((key) => key.startsWith("/textures/shiny/"));
    const byPath = (first, second) => first.localeCompare(second);
    assert.deepEqual(
      requested.toSorted(byPath),
      lineNeeds("squirtle", true)
        .map(({ key }) => key)
        .filter((key) => key.startsWith("/textures/shiny/"))
        .toSorted(byPath),
    );
    assert.ok(!lineNeeds("squirtle").some(({ key }) => requested.includes(key)));
    const readCount = reads.length;
    for (const form of ["squirtle", "wartortle", "blastoise"]) {
      const handle = models.acquire(formModels[form].url, "interactive");
      const mapHandle = shinyMapNeed(form)?.acquire("interactive");
      const [canonical, map] = await Promise.all([handle.result, mapHandle?.result]);
      const normal = instantiate(canonical);
      const shiny = instantiate(canonical, { form, map });
      const standard = body(normal).material;
      const clone = body(shiny).material;
      let sharedDisposals = 0;
      const sharedDisposed = () => sharedDisposals++;
      standard.addEventListener("dispose", sharedDisposed);
      standard.map.addEventListener("dispose", sharedDisposed);
      map?.addEventListener("dispose", sharedDisposed);
      let cloneDisposals = 0;
      clone.addEventListener("dispose", () => cloneDisposals++);
      try {
        assert.equal(standard, body(canonical.model).material);
        assert.notEqual(clone, standard);
        const expectLook = (material, kind) => {
          if (map) {
            assert.equal(material.map, map);
            assert.notEqual(material.map, standard.map);
            assert.equal(uniforms(material, kind).shinySwaps, undefined, "烘焙色不能二次换色");
          } else {
            assert.equal(material.map, standard.map);
            assert.ok(uniforms(material, kind).shinySwaps);
          }
        };
        expectLook(clone, "standard");
        shiny.releaseUploads();
        assert.equal(cloneDisposals, 1);
        expectLook(clone, "standard");
        assert.equal(uniforms(standard, "standard").shinySwaps, undefined);
        if (map) {
          const source = publicFile(output, shinyTextureUrl(form));
          const pixels = await sharp(source).ensureAlpha().raw().toBuffer();
          assert.ok(
            pixels.equals(Buffer.from(map.image.data)),
            `${form} 的 glTF UV 应按原行序读图`,
          );
          for (const key of [
            "colorSpace",
            "wrapS",
            "wrapT",
            "minFilter",
            "magFilter",
            "flipY",
            "generateMipmaps",
          ])
            assert.equal(map[key], standard.map[key], `${form} ${key}`);
        }
        const wind = createWindUniforms(stageThemes.forest.clouds);
        const rigs = run.players.map((models) =>
          mountRig(new Group(), models.get(form), wind, false),
        );
        try {
          const ordinaryBody = body(run.players[0].get(form).model).material;
          assert.equal(ordinaryBody.map, standard.map);
          assert.equal(uniforms(ordinaryBody, "lambert").shinySwaps, undefined);
          expectLook(body(run.players[1].get(form).model).material, "lambert");
        } finally {
          for (const rig of rigs) rig.unmount();
        }
        assert.equal(body(run.players[1].get(form).model).material, standard);
      } finally {
        shiny.dispose();
        normal.dispose();
        standard.removeEventListener("dispose", sharedDisposed);
        standard.map.removeEventListener("dispose", sharedDisposed);
        map?.removeEventListener("dispose", sharedDisposed);
        mapHandle?.release();
        handle.release();
      }
      assert.equal(cloneDisposals, 2);
      assert.equal(sharedDisposals, 0);
    }
    assert.equal(reads.length, readCount, "挂载和进化不应发起新请求");
  } finally {
    run.dispose();
    installResources(original);
  }
});
