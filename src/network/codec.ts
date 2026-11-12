/** Map grids keep their typed representation and float bits; dynamic snapshots keep signed zero. */
const arrays = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
};
export function encode(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) => {
    if (Object.is(field, -0)) return { $number: "-0" };
    if (ArrayBuffer.isView(field) && !(field instanceof DataView)) {
      const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return { $array: field.constructor.name, bytes: btoa(binary) };
    }
    return field;
  });
}
export function decode<T>(text: string): T {
  return JSON.parse(text, (_key, field) => {
    if (field?.$number === "-0") return -0;
    if (field?.$array) {
      const ArrayType = arrays[field.$array as keyof typeof arrays];
      if (!ArrayType || typeof field.bytes !== "string") throw new Error("地图数组格式错误。");
      const binary = atob(field.bytes);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new ArrayType(bytes.buffer);
    }
    return field;
  }) as T;
}
