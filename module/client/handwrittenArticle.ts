/**
 * 浏览器内最小 DOCX 生成（方案 A 桥接）：
 * 把手写标题/正文打包成结构合法的 .docx，走现有 importDocx 真实接口创建稿件，
 * 随后用 saveArticle 覆写为用户输入的内容。无新增依赖、无虚构接口。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    const entry = CRC_TABLE[(c ^ byte) & 0xff];
    c = (entry === undefined ? 0 : entry) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** 无压缩（STORE）最小 ZIP：本地文件头 + 中央目录 + 结束记录。 */
const asBlobPart = (value: Uint8Array): BlobPart =>
  value as unknown as BlobPart;

function buildStoredZip(entries: { name: string; data: Uint8Array }[]): Blob {
  const encoder = new TextEncoder();
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  const writeU16 = (value: number) => [value & 0xff, (value >> 8) & 0xff];
  const writeU32 = (value: number) => [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const localHeader = new Uint8Array([
      ...writeU32(0x04034b50),
      ...writeU16(20),
      ...writeU16(0),
      ...writeU16(0),
      ...writeU16(0),
      ...writeU16(0),
      ...writeU32(crc),
      ...writeU32(entry.data.length),
      ...writeU32(entry.data.length),
      ...writeU16(nameBytes.length),
      ...writeU16(0),
    ]);
    chunks.push(asBlobPart(localHeader), asBlobPart(nameBytes), asBlobPart(entry.data));
    central.push(
      asBlobPart(new Uint8Array([
        ...writeU32(0x02014b50),
        ...writeU16(20),
        ...writeU16(20),
        ...writeU16(0),
        ...writeU16(0),
        ...writeU16(0),
        ...writeU16(0),
        ...writeU32(crc),
        ...writeU32(entry.data.length),
        ...writeU32(entry.data.length),
        ...writeU16(nameBytes.length),
        ...writeU16(0),
        ...writeU16(0),
        ...writeU16(0),
        ...writeU16(0),
        ...writeU32(0),
        ...writeU32(offset),
      ])),
      asBlobPart(nameBytes),
    );
    offset += localHeader.length + nameBytes.length + entry.data.length;
  }
  const centralSize = central.reduce(
    (sum, part) => sum + (part as Uint8Array).byteLength,
    0,
  );
  const endRecord = new Uint8Array([
    ...writeU32(0x06054b50),
    ...writeU16(0),
    ...writeU16(0),
    ...writeU16(entries.length),
    ...writeU16(entries.length),
    ...writeU32(centralSize),
    ...writeU32(offset),
    ...writeU16(0),
  ]);
  return new Blob([...chunks, ...central, asBlobPart(endRecord)], {
    type: "application/zip",
  });
}

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildHandwrittenDocxFile(
  title: string,
  bodyText: string,
): File {
  const paragraphs = (bodyText || "")
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const bodyXml = (paragraphs.length ? paragraphs : [""]).
    map(
      (line) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`,
    )
    .join("");
  const safeName = (title.trim().slice(0, 30) || "手写新稿件").replace(
    /[\\/:*?"<>|]/gu,
    "_",
  );
  const blob = buildStoredZip([
    {
      name: "[Content_Types].xml",
      data: encodeText(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: encodeText(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      data: encodeText(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
      ),
    },
  ]);
  return new File([blob], `${safeName}.docx`, { type: DOCX_MIME });
}
