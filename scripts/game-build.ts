import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

/** The same simulation fingerprint is sent by Web and native when joining a room. */
export function gameBuild(root: URL): string {
  return createHash("sha256")
    .update(
      readdirSync(new URL("src/run/sim/", root), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts"))
        .sort()
        .map((file) => file + readFileSync(new URL(`src/run/sim/${file}`, root), "utf8"))
        .join("\n"),
    )
    .digest("hex")
    .slice(0, 16);
}
