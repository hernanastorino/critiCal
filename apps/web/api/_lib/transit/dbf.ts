// Reader for the dBASE (.dbf) tables inside the Intendencia's shapefile downloads.

/** Rows of a .dbf as trimmed strings by field name. Text is UTF-8 in these files. */
export function readDbf(buf: Buffer): Record<string, string>[] {
  if (buf.length < 32) throw new Error("dbf_invalid");
  const rows = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields: { name: string; len: number }[] = [];
  for (let o = 32; o < headerLen && buf[o] !== 0x0d; o += 32) {
    const end = buf.indexOf(0, o);
    fields.push({
      name: buf.toString("latin1", o, Math.min(end < 0 ? o + 11 : end, o + 11)),
      len: buf[o + 16] as number,
    });
  }
  if (headerLen + rows * recordLen > buf.length) throw new Error("dbf_invalid");
  const out: Record<string, string>[] = [];
  for (let i = 0; i < rows; i++) {
    const at = headerLen + i * recordLen;
    // 0x2A marks a deleted record.
    if (buf[at] === 0x2a) continue;
    const row: Record<string, string> = {};
    let p = at + 1;
    for (const f of fields) {
      row[f.name] = buf.toString("utf8", p, p + f.len).trim();
      p += f.len;
    }
    out.push(row);
  }
  return out;
}
