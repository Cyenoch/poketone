import { deflateSync, inflateSync } from "fflate";
import { encode, decode } from "./codec";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maxBytes = 16 * 1024 * 1024;

/** One independently compressed packet: reliable ordering and delta baselines stay unchanged. */
export function pack(packet: unknown): string {
  const text = encode(packet);
  if (text.length < 1024) return text;
  const bytes = encoder.encode(text);
  if (bytes.length > maxBytes) throw new Error("联机数据过大。");
  const compressed = deflateSync(bytes, { level: 1 });
  let binary = "";
  for (let start = 0; start < compressed.length; start += 32768)
    binary += String.fromCharCode(...compressed.subarray(start, start + 32768));
  const packed = `~${bytes.length}:${btoa(binary)}`;
  return packed.length < text.length ? packed : text;
}

export function unpack<T>(text: string): T {
  if (!text.startsWith("~")) return decode<T>(text);
  const colon = text.indexOf(":");
  const size = Number(text.slice(1, colon));
  if (colon < 2 || !Number.isSafeInteger(size) || size <= 0 || size > maxBytes)
    throw new Error("联机数据过大。");
  const bytes = Uint8Array.from(atob(text.slice(colon + 1)), (char) => char.charCodeAt(0));
  // Bound expansion at the transport boundary, including a falsely declared length.
  const expanded = inflateSync(bytes, { out: new Uint8Array(size + 1) });
  if (expanded.length !== size) throw new Error("联机数据格式错误。");
  return decode<T>(decoder.decode(expanded));
}
