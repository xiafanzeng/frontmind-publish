import { describe, expect, it } from "vitest";
import { decodeMulterFilename } from "./http.js";

// V7：浏览器 UTF-8 中文文件名被 multer/busboy 按 latin-1 读出后应被还原，
// 纯 ASCII 与本已正确的中文文件名保持不变。
describe("decodeMulterFilename", () => {
  it("restores UTF-8 CJK filenames mangled by latin-1 decoding", () => {
    // “测试文档.docx” 的 UTF-8 字节按 latin-1 显示的形态
    const mangled = Buffer.from("测试文档.docx", "utf8").toString("latin1");
    expect(mangled).not.toContain("测");
    expect(decodeMulterFilename(mangled)).toBe("测试文档.docx");
  });

  it("keeps mixed Chinese-English names readable", () => {
    const mangled = Buffer.from("test测试文件.docx", "utf8").toString("latin1");
    expect(decodeMulterFilename(mangled)).toBe("test测试文件.docx");
  });

  it("leaves pure ASCII names untouched", () => {
    expect(decodeMulterFilename("report-final.docx")).toBe("report-final.docx");
  });

  it("leaves already-correct CJK names untouched", () => {
    expect(decodeMulterFilename("测试文档.docx")).toBe("测试文档.docx");
  });
});
