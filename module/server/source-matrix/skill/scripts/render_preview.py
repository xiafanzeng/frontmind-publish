"""Embed verified export-research snapshots into a standalone offline HTML preview."""
import argparse
import json
from pathlib import Path

def render(results, output):
    if not results or any(r.get('schema_version')!='export-research/1.0' for r in results):
        raise ValueError('Expected at least one export-research/1.0 result')
    payload=json.dumps(results,ensure_ascii=False,allow_nan=False).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026')
    assets=Path(__file__).resolve().parents[1]/'assets'
    template=(assets/'preview.html').read_text(encoding='utf-8')
    template=template.replace('/*__PREVIEW_CSS__*/',(assets/'preview.css').read_text(encoding='utf-8'))
    template=template.replace('/*__PREVIEW_JS__*/',(assets/'preview.js').read_text(encoding='utf-8'))
    output=Path(output); output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(template.replace('/*__CASE_DATA__*/',payload),encoding='utf-8')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--result',action='append',required=True);p.add_argument('--output',required=True)
    a=p.parse_args(); render([json.loads(Path(x).read_text(encoding='utf-8-sig')) for x in a.result],a.output)

if __name__=='__main__': main()
