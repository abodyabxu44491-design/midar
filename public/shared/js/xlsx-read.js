// قراءة ملف Excel (.xlsx) داخل المتصفح بلا مكتبات: فك ZIP بـ DecompressionStream ثم قراءة XML.
// يعيد { headers, rows } بنفس شكل parseCsv، فيتعامل معه المعالج بالطريقة نفسها.

const dec = new TextDecoder("utf-8");

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** يقرأ فهرس ZIP ويعيد دالة لجلب نص أي ملف داخله */
async function openZip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("الملف ليس Excel صالحًا (.xlsx)");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    entries.set(dec.decode(u8.subarray(p + 46, p + 46 + nameLen)), { method, size, offset });
    p += 46 + nameLen + extra + comment;
  }
  return async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const lh = e.offset, start = lh + 30 + v.getUint16(lh + 26, true) + v.getUint16(lh + 28, true);
    const raw = u8.subarray(start, start + e.size);
    return dec.decode(e.method === 0 ? raw : await inflateRaw(raw));
  };
}

const xml = (text) => new DOMParser().parseFromString(text, "application/xml");
const colIndex = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const textOf = (node) => [...node.getElementsByTagName("t")].filter((t) => t.parentNode.nodeName !== "rPh").map((t) => t.textContent).join("");

export async function readXlsx(file) {
  const get = await openZip(await file.arrayBuffer());
  const wb = await get("xl/workbook.xml");
  if (!wb) throw new Error("الملف ليس Excel صالحًا (.xlsx)");
  // أول ورقة في المصنف
  const first = xml(wb).getElementsByTagName("sheet")[0];
  const rid = first?.getAttribute("r:id") || first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
  const rels = xml((await get("xl/_rels/workbook.xml.rels")) || "<r/>");
  let target = [...rels.getElementsByTagName("Relationship")].find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target") || "worksheets/sheet1.xml";
  target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const sheetXml = await get(target);
  if (!sheetXml) throw new Error("تعذر قراءة الورقة الأولى");

  const sst = await get("xl/sharedStrings.xml");
  const shared = sst ? [...xml(sst).getElementsByTagName("si")].map(textOf) : [];

  const grid = [];
  for (const row of xml(sheetXml).getElementsByTagName("row")) {
    const cells = [];
    for (const c of row.getElementsByTagName("c")) {
      const t = c.getAttribute("t"), v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let val = "";
      if (t === "s") val = shared[Number(v)] ?? "";
      else if (t === "inlineStr") val = textOf(c);
      else if (t === "b") val = v === "1" ? "نعم" : "لا";
      else val = v;
      cells[colIndex(c.getAttribute("r"))] = String(val).trim();
    }
    if (cells.some((x) => x)) grid.push(cells);
  }
  if (!grid.length) return { headers: [], rows: [] };
  const headers = Array.from(grid[0], (x) => (x || "").replace(/\s*\*\s*$/, "").trim());
  return {
    headers,
    rows: grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])).valueOf()).filter((r) => Object.values(r).some((x) => x)),
  };
}
