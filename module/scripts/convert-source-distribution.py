"""Offline, standard-library-only XLSX conversion. Never calls a service or runs the app.

Usage: python module/scripts/convert-source-distribution.py input.xlsx [output.json]
Rows in 详细表格 remain separate even when all seven values are identical.
The other sheets are preserved for reconciliation, never added to record totals.
"""
import argparse
import hashlib
import json
import re
import zipfile
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET

MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def read_workbook(path):
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = ["".join(n.itertext()) for n in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(MAIN + "si")]
        relationships = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        result = []
        for sheet in ET.fromstring(z.read("xl/workbook.xml")).find(MAIN + "sheets"):
            target = relationships[sheet.attrib[REL + "id"]]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            rows = []
            for row in ET.fromstring(z.read(target)).iter(MAIN + "row"):
                cells = {}
                for cell in row.findall(MAIN + "c"):
                    raw = cell.findtext(MAIN + "v")
                    kind = cell.attrib.get("t")
                    if kind == "s":
                        value = shared[int(raw)] if raw is not None else None
                    elif kind == "inlineStr":
                        value = "".join(cell.find(MAIN + "is").itertext())
                    elif raw is None:
                        value = None
                    elif kind == "b":
                        value = raw == "1"
                    elif kind in ("str", "e"):
                        value = raw
                    else:
                        value = float(raw) if "." in raw or "E" in raw.upper() else int(raw)
                    cells[cell.attrib["r"]] = {"value": value, "raw": raw, "type": kind, "style": cell.attrib.get("s"), "formula": cell.findtext(MAIN + "f")}
                rows.append({"sourceRow": int(row.attrib["r"]), "cells": cells})
            result.append({"name": sheet.attrib["name"], "rows": rows})
        return result


def cell_value(row, col):
    return row["cells"].get(f'{col}{row["sourceRow"]}', {}).get("value")


def text_value(value):
    return None if value is None or value == "" else str(value)


def day_value(value):
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return (datetime(1899, 12, 30) + timedelta(days=value)).date().isoformat()
    matched = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", str(value))
    if not matched:
        raise ValueError(f"Unrecognised citation date: {value!r}")
    return "-".join((matched[1], matched[2].zfill(2), matched[3].zfill(2)))


def convert(path):
    fingerprint = hashlib.sha256(path.read_bytes()).hexdigest()
    sheets = read_workbook(path)
    by_name = {sheet["name"]: sheet for sheet in sheets}
    required = {"媒体统计", "内容统计", "详细表格", "字段说明"}
    if not required.issubset(by_name):
        raise ValueError("Expected all four source sheets")
    contents = by_name["内容统计"]["rows"][1:]
    status_by_url = {text_value(cell_value(row, "D")): text_value(cell_value(row, "B")) for row in contents}
    mapping = {"citedAt": "A:引用日期", "model": "B:模型", "question": "C:监控问题", "title": "D:内容标题", "url": "E:内容链接", "mediaName": "F:媒体名称", "mediaUrl": "G:媒体url"}
    records = []
    for row in by_name["详细表格"]["rows"][1:]:
        values = {key: text_value(cell_value(row, spec[0])) for key, spec in mapping.items()}
        values["citedAt"] = day_value(cell_value(row, "A"))
        records.append({"id": f'{fingerprint}:详细表格:{row["sourceRow"]}', "sourceSheet": "详细表格", "sourceRow": row["sourceRow"], **values, "mediaType": None, "publishedAt": None, "contentStatus": status_by_url.get(values["url"])})
    first_media = by_name["媒体统计"]["rows"][1]
    period_raw = str(cell_value(first_media, "D") or "")
    dates = re.findall(r"\d{4}[-/]\d{1,2}[-/]\d{1,2}", period_raw)
    period = {"start": day_value(dates[0]) if dates else None, "end": day_value(dates[-1]) if dates else None}
    batch = {"id": f"sha256:{fingerprint}", "label": "一航软件样本", "version": fingerprint, "sourceFile": path.name, "sourceSha256": fingerprint, "industryId": None, "industryName": None, "period": period, "records": records, "limitations": ["行业未确认，归入未分类；文件名不作为行业依据。", "502 行为原始导出引用记录，保留相同明细行；缺回答、轮次和引用事件 ID，不能计算回答引用率。", "无媒体类型和内容发布时间，保持未知；引用日期不是发布时间。", "媒体分组以原媒体名称＋媒体 url 区分，不等于已确认独立媒体。", "本样本仅用于分析和可查背景，不进入推荐内核有效 detail 或 aggregate_ids。", "统计区间不代表每天采集完整；无报价、模型版本或采购映射。"]}
    raw_counts = Counter(tuple(cell_value(row, col) for col in "ABCDEFG") for row in by_name["详细表格"]["rows"][1:])
    reconciliation = {"records": len(records), "contentUrls": len({r["url"] for r in records if r["url"]}), "mediaGroups": len({(r["mediaName"], r["mediaUrl"]) for r in records}), "uniqueSevenFieldRows": len(raw_counts), "additionalIdenticalRows": sum(v - 1 for v in raw_counts.values()), "models": dict(sorted(Counter(r["model"] for r in records).items())), "citationDates": dict(sorted(Counter(r["citedAt"] for r in records).items())), "mediaSummaryCount": sum(int(cell_value(row, "E") or 0) for row in by_name["媒体统计"]["rows"][1:]), "contentSummaryCount": sum(int(cell_value(row, "H") or 0) for row in contents)}
    sheet_column_mapping = {sheet["name"]: {re.sub(r"\d+$", "", address): cell["value"] for address, cell in sheet["rows"][0]["cells"].items()} for sheet in sheets}
    return {"batch": batch, "provenance": {"sourceFile": path.name, "sourceSha256": fingerprint, "detailFieldMapping": mapping, "sheetColumnMapping": sheet_column_mapping, "contentStatusMapping": "内容统计!B 按 D:内容URL 精确匹配；不是发布时间或发布状态", "unavailableFields": ["industryId", "industryName", "mediaType", "publishedAt", "answerId", "modelVersion", "pricing"], "sheets": sheets, "reconciliation": reconciliation}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", nargs="?", type=Path, default=Path(__file__).resolve().parents[1] / "client/source-matrix/industry/yihang-data.json")
    args = parser.parse_args()
    data = convert(args.input)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(data["provenance"]["reconciliation"], ensure_ascii=True, indent=2))
    print("sourceSha256=" + data["batch"]["sourceSha256"])


if __name__ == "__main__":
    main()
