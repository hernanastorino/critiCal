// Test helpers: tiny invented schedules in the sources' own file formats.
import { zipStore } from "../fake-providers.js";

/** A .dbf with these text/number fields (name, width) and rows, UTF-8 like the real ones. */
export function makeDbf(
  fields: [string, number][],
  rows: Record<string, string | number>[],
): Buffer {
  const recordLen = 1 + fields.reduce((n, [, w]) => n + w, 0);
  const headerLen = 32 + fields.length * 32 + 1;
  const buf = Buffer.alloc(headerLen + rows.length * recordLen + 1, 0x20);
  buf.fill(0, 0, headerLen);
  buf.writeUInt32LE(rows.length, 4);
  buf.writeUInt16LE(headerLen, 8);
  buf.writeUInt16LE(recordLen, 10);
  fields.forEach(([name, width], i) => {
    buf.write(name, 32 + i * 32, "latin1");
    buf[32 + i * 32 + 16] = width;
  });
  buf[32 + fields.length * 32] = 0x0d;
  rows.forEach((row, r) => {
    let p = headerLen + r * recordLen;
    buf[p++] = 0x20;
    for (const [name, width] of fields) {
      const text = Buffer.from(String(row[name] ?? ""), "utf8");
      text.copy(buf, p, 0, width);
      buf.fill(0x20, p + Math.min(text.length, width), p + width);
      p += width;
    }
  });
  return buf;
}

export { zipStore };
