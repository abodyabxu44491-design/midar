// قراءة نص ملف Word (.docx) في المتصفح بلا مكتبات: الملف أرشيف ZIP فيه word/document.xml.
// الترقيم التلقائي في Word لا يُخزَّن نصًا، فنعيد بناءه: المستوى الأول أرقام (1- 2-)،
// والمستوى الثاني حروف (أ) ب)) حتى يتعرّف عليها محلّل الأسئلة كما لو كُتبت يدويًا.
const LETTERS = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح"];

async function unzipEntries(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("الملف ليس ملف Word صالحًا (docx)");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
    const data = new Uint8Array(buf, start, e.size);
    if (e.method === 0) return dec.decode(data);
    if (e.method !== 8) throw new Error("ضغط غير مدعوم في الملف");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  };
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const kids = (el, name) => [...el.getElementsByTagNameNS(W, name)];

// numId → [numFmt لكل مستوى]
function numberingFormats(xml) {
  const out = new Map();
  if (!xml) return out;
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const abstract = new Map(kids(doc, "abstractNum").map((a) => [attr(a, "abstractNumId"),
    kids(a, "lvl").map((l) => attr(kids(l, "numFmt")[0], "val") || "decimal")]));
  for (const n of kids(doc, "num")) out.set(attr(n, "numId"), abstract.get(attr(kids(n, "abstractNumId")[0], "val")) || []);
  return out;
}

export async function docxToText(file) {
  if (!("DecompressionStream" in window)) throw new Error("المتصفح لا يدعم قراءة ملفات Word. حدّث المتصفح أو انسخ الأسئلة والصقها.");
  const read = await unzipEntries(await file.arrayBuffer());
  const xml = await read("word/document.xml");
  if (!xml) throw new Error("الملف ليس ملف Word صالحًا (docx)");
  const formats = numberingFormats(await read("word/numbering.xml"));
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const lines = [];
  const counters = new Map();   // numId → عدادات المستويات
  let images = 0;
  let letter = 0;               // حروف الخيارات تبدأ من (أ) بعد كل سؤال
  for (const p of kids(doc, "p")) {
    let text = "";
    for (const node of p.getElementsByTagName("*")) {
      if (node.namespaceURI !== W) { if (node.localName === "blip") images++; continue; }
      if (node.localName === "t") text += node.textContent;
      else if (node.localName === "tab") text += "\t";
      else if (node.localName === "br") text += "\n";
    }
    const numPr = kids(p, "numPr")[0];
    if (numPr && text.trim()) {
      const numId = attr(kids(numPr, "numId")[0], "val");
      const lvl = Number(attr(kids(numPr, "ilvl")[0], "val") || 0);
      const c = counters.get(numId) || [];
      c[lvl] = (c[lvl] || 0) + 1;
      c.length = lvl + 1;               // مستوى أعلى جديد يصفّر ما تحته
      counters.set(numId, c);
      const fmt = formats.get(numId)?.[lvl] || (lvl ? "arabicAlpha" : "decimal");
      const isLetter = fmt !== "bullet" && (/letter|alpha|abjad|hebrew/i.test(fmt) || lvl > 0);
      if (fmt === "bullet") text = `• ${text.trim()}`;
      else if (isLetter) text = `${LETTERS[letter++ % LETTERS.length]}) ${text.trim()}`;
      else { text = `${c[lvl]}- ${text.trim()}`; letter = 0; }
    } else if (text.trim() && !/^\s*[(\[]?\s*(هـ|[أابجدهوزح]|[a-hA-H])\s*[)\]\-.:]/.test(text)) letter = 0;
    lines.push(text.replace(/ /g, " "));
  }
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), images };
}
