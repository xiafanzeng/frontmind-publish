import json
from html.parser import HTMLParser
from pathlib import Path
import tempfile
import unittest
from scripts.render_preview import render

class DataParser(HTMLParser):
    def __init__(self):super().__init__();self.active=False;self.data=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and dict(attrs).get('id')=='caseData':self.active=True
    def handle_endtag(self,tag):
        if tag=='script':self.active=False
    def handle_data(self,data):
        if self.active:self.data.append(data)

class PreviewTests(unittest.TestCase):
    def test_untrusted_title_cannot_escape_embedded_json(self):
        malicious='</script><img src=x onerror="throw 1">&'
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'preview.html'
            render([{'schema_version':'export-research/1.0','title':malicious}],path)
            parser=DataParser();parser.feed(path.read_text(encoding='utf-8'))
            self.assertEqual(json.loads(''.join(parser.data))[0]['title'],malicious)
            self.assertNotIn('<img src=x',path.read_text(encoding='utf-8'))

    def test_rejects_core_planner_result_as_export_preview(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):render([{'schema_version':'1.0'}],Path(folder)/'bad.html')

if __name__=='__main__':unittest.main()
