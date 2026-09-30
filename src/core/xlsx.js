// كتابة ملف Excel (.xlsx) بلا أي مكتبة خارجية: XML داخل حزمة ZIP بدون ضغط.
// يكفي للقوالب: ورقة أو أكثر، عناوين بخط عريض، عرض أعمدة، اتجاه من اليمين لليسار، وقوائم منسدلة.
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** حزمة ZIP: files = [{ name, data: Buffer|string }] — تُخزَّن بلا ضغط (deflate اختياري) */
export function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const packed = zlib.deflateRawSync(raw);
    const useDeflate = packed.length < raw.length;
    const data = useDeflate ? packed : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8); local.writeUInt32LE(0x00210000, 10);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, data);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt32LE(0x00210000, 12);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}

const esc = (v) => String(v).replace(/[<>&"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) =>
  ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] || "");
const colName = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

/**
 * sheets: [{ name, headers:[string], rows:[[value]], widths?:[number], notes?:boolean,
 *            lists?: { [colIndex]: string[] }, textColumns?: number[] }]
 * القيم النصية تُخزَّن نصًا دائمًا (حتى لا يحوّل Excel 0501 إلى 501 أو الصف 1 إلى رقم).
 */
export function buildXlsx(sheets) {
  const files = [];
  files.push({ name: "[Content_Types].xml", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` });
  files.push({ name: "_rels/.rels", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` });
  files.push({ name: "xl/workbook.xml", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` });
  files.push({ name: "xl/_rels/workbook.xml.rels", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` });
  // الأنماط: 0 عادي، 1 عنوان (عريض + خلفية)، 2 نص (تنسيق @)
  files.push({ name: "xl/styles.xml", data:
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8F5"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` });

  sheets.forEach((s, i) => {
    const textCols = new Set(s.textColumns || []);
    const cell = (v, c, r, style) => {
      if (v === null || v === undefined || v === "") return "";
      const ref = `${colName(c)}${r}`;
      return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    const head = `<row r="1">${s.headers.map((v, c) => cell(v, c, 1, 1)).join("")}</row>`;
    const body = s.rows.map((row, ri) => `<row r="${ri + 2}">${row.map((v, c) => cell(v, c, ri + 2, textCols.has(c) ? 2 : 0)).join("")}</row>`).join("");
    const cols = `<cols>${s.headers.map((_, c) => `<col min="${c + 1}" max="${c + 1}" width="${s.widths?.[c] || 20}" customWidth="1"${textCols.has(c) ? ' style="2"' : ""}/>`).join("")}</cols>`;
    const last = Math.max(s.rows.length + 1, 300);
    const lists = Object.entries(s.lists || {}).filter(([, v]) => v.length && v.join(",").length < 250);
    const dv = lists.length ? `<dataValidations count="${lists.length}">${lists.map(([c, v]) =>
      `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${colName(+c)}2:${colName(+c)}${last}"><formula1>"${esc(v.join(","))}"</formula1></dataValidation>`).join("")}</dataValidations>` : "";
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data:
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${head}${body}</sheetData>${dv}</worksheet>` });
  });
  return zip(files);
}
