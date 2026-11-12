import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createNativeApp } from "./main";
import { nativeSavePath } from "./save";

declare const NATIVE_ASSETS: string;
declare const NATIVE_HARBOR: string;
const { values } = parseArgs({ options: { save: { type: "string" }, harbor: { type: "string" } } });
await createNativeApp(
  NATIVE_ASSETS
    ? new URL(NATIVE_ASSETS)
    : pathToFileURL(join(dirname(process.execPath), "../Resources/public/")),
  values.save ?? nativeSavePath(join(homedir(), ".poketone")),
  values.harbor ?? NATIVE_HARBOR,
);
