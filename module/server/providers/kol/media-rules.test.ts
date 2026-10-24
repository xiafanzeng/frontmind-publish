// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  mediaRulesImageBlocker,
  mediaRulesTitleLimit,
  parseMediaRules,
  preflightMediaRules,
} from "./media-rules";

const collectedAt = "2026-10-24T00:00:00.000Z";
const article = { title: "已确认稿件", body: "稿件正文", images: 2, links: 0 };
const imagesRule = (remark: string) => parseMediaRules(remark, collectedAt)
  .rules.find(rule => rule.field === "images")!;

describe("unspecified media requirements", () => {
  it.each(["", "未注明", "-", "图片要求：未注明；标题字数未提供；正文要求：—"])(
    "allows missing requirements without inventing supplier evidence: %s",
    remark => {
      const rules = parseMediaRules(remark, collectedAt);
      const result = preflightMediaRules(rules, article);
      expect(rules.rawRemark).toBe(remark);
      expect(rules.rules.every(rule => rule.state === "unknown" && rule.evidence.length === 0)).toBe(true);
      expect(rules.unresolved).toEqual([]);
      expect(result.status).toBe("pass");
      expect(result.items.every(item => item.status === "pass")).toBe(true);
      expect(mediaRulesImageBlocker(remark, undefined, undefined, article.images)).toBeNull();
    },
  );

  it("retains unresolved real requirements and conflicting evidence for review", () => {
    const formatRules = parseMediaRules("图片仅限 JPG 格式", collectedAt);
    expect(formatRules.unresolved).toEqual(["图片仅限 JPG 格式"]);
    expect(preflightMediaRules(formatRules, article).status).toBe("needs_review");
    const conflict = parseMediaRules("图片不限；不支持图片", collectedAt);
    expect(conflict.rules.find(rule => rule.field === "images")?.state).toBe("conflict");
    expect(preflightMediaRules(conflict, article).status).toBe("needs_review");
    expect(mediaRulesImageBlocker(conflict.rawRemark, undefined, undefined, 2)).toContain("冲突");
    expect(mediaRulesImageBlocker(conflict.rawRemark, undefined, undefined, 0)).toBeNull();
  });

  it("preserves the existing technical title cap and empty-content validation", () => {
    expect(mediaRulesTitleLimit("", null)).toBe(200);
    const rules = parseMediaRules("", collectedAt);
    expect(preflightMediaRules(rules, { ...article, title: "" }).status).toBe("fail");
    expect(preflightMediaRules(rules, { ...article, body: "" }).status).toBe("fail");
  });
});

describe("explicit media image requirements", () => {
  it.each([
    "禁止图片", "不允许配图", "不得图片", "不支持图片", "不支持配图",
    "禁止添加图片", "图片不支持", "仅限纯文字", "仅限纯文字稿件", "仅支持纯文本", "不支持图文",
  ])("preserves a complete explicit image prohibition: %s", remark => {
    expect(imagesRule(remark)).toMatchObject({ state: "constrained", max: 0, evidence: [remark] });
    expect(mediaRulesImageBlocker(remark, undefined, undefined, 1)).toContain("明确不支持图片");
    expect(mediaRulesImageBlocker(remark, undefined, undefined, 0)).toBeNull();
    expect(preflightMediaRules(parseMediaRules(remark, collectedAt), article).status).toBe("fail");
  });

  it.each(["可添加图片", "不限制图片", "不支持图片时请联系编辑", "图片最多2张，特殊稿件除外"])(
    "does not turn qualified or affirmative text into a hard image ban: %s",
    remark => {
      expect(imagesRule(remark).state).toBe("unknown");
      expect(mediaRulesImageBlocker(remark, undefined, undefined, 2)).toBeNull();
      expect(parseMediaRules(remark, collectedAt).unresolved).toEqual([remark]);
    },
  );

  it("keeps inclusive and exclusive picture counts consistent with requirements preflight", () => {
    expect(mediaRulesImageBlocker("图片最多2张", null, null, 2)).toBeNull();
    expect(mediaRulesImageBlocker("图片最多2张", null, null, 3)).toContain("不超过 2 张");
    expect(mediaRulesImageBlocker("图片少于2张", null, null, 1)).toBeNull();
    expect(mediaRulesImageBlocker("图片少于2张", null, null, 2)).toContain("少于 2 张");
    expect(preflightMediaRules(parseMediaRules("图片最多2张", collectedAt), article).status).toBe("pass");
    expect(preflightMediaRules(parseMediaRules("图片少于2张", collectedAt), article).status).toBe("fail");
  });

  it("uses saved catalog requirements evidence instead of a stale display remark", () => {
    const raw = { frontmindMediaRules: { rawRemark: "仅限纯文字", collectedAt, apiTitleLimit: null } };
    expect(mediaRulesImageBlocker("图片不限", null, raw, 2)).toContain("明确不支持图片");
    expect(raw.frontmindMediaRules.rawRemark).toBe("仅限纯文字");
    const unknown = { frontmindMediaRules: { rawRemark: "未注明", collectedAt } };
    expect(mediaRulesImageBlocker("禁止图片", null, unknown, 2)).toBeNull();
    expect(unknown.frontmindMediaRules.rawRemark).toBe("未注明");
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])("rejects an invalid image count: %s", count => {
    expect(() => mediaRulesImageBlocker("禁止图片", null, null, count)).toThrow(TypeError);
  });
});
