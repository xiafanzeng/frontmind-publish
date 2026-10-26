import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile
P = Path(__file__).resolve().parents[1]

class PackageTests(unittest.TestCase):
    def test_frontmatter_and_links(self):
        text = (P / 'SKILL.md').read_text()
        match = re.match(r'^---\nname: ([^\n]+)\ndescription: ([^\n]+)\n---', text)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), 'source-matrix-planner')
        self.assertTrue(match.group(2).startswith('Use when '))
        for link in re.findall(r'\]\(([^)]+)\)', text):
            self.assertTrue((P / link).is_file(), link)

    def test_distribution_docs_and_dependencies(self):
        for name in ('README.md', 'verification.md'):
            self.assertTrue((P / name).is_file(), name)
        self.assertTrue((P / 'requirements.txt').is_file())
        self.assertFalse([s for s in (P / 'requirements.txt').read_text().splitlines() if s.strip() and not s.startswith('#')])

    def test_archive_reproducible_clean_and_runnable(self):
        builder = P / 'scripts/build_package.py'
        self.assertTrue(builder.is_file(), 'archive builder missing')
        with tempfile.TemporaryDirectory() as directory:
            tmp = Path(directory)
            archives = [tmp / 'one.zip', tmp / 'two.zip']
            for archive in archives:
                subprocess.run([sys.executable, str(builder), '--output', str(archive)], check=True, capture_output=True)
            self.assertEqual(archives[0].read_bytes(), archives[1].read_bytes())
            with zipfile.ZipFile(archives[0]) as archive:
                names = archive.namelist()
                for required in ('README.md', 'verification.md', 'source-matrix-planner/requirements.txt',
                                 'source-matrix-planner/examples/aggregate-request.json',
                                 'source-matrix-planner/examples/aggregate-decisions.json',
                                 'source-matrix-planner/tests/test_final_regressions.py',
                                 'source-matrix-planner/scripts/export_adapter.py',
                                 'source-matrix-planner/scripts/render_preview.py',
                                 'source-matrix-planner/assets/preview.html',
                                 'source-matrix-planner/assets/preview.css',
                                 'source-matrix-planner/assets/preview.js',
                                 'source-matrix-planner/tests/test_draft_explanation.py',
                                 'source-matrix-planner/references/export-research.md',
                                 'source-matrix-planner/requirements-excel.txt'):
                    self.assertIn(required, names)
                for required in ('scripts/content_planning.py','references/content-planning.md','references/website-integration.md','tests/test_content_planning.py','ORIGIN.md','VERSION'):
                    self.assertIn('source-matrix-planner/'+required,names)
                for name in names:
                    self.assertFalse(any(p in {'.git', '__pycache__', '.superpowers', 'evaluation', '.env'} for p in Path(name).parts), name)
                    self.assertFalse(any(w in name.lower() for w in ('credential', 'secret', '.pyc')), name)
                archive.extractall(tmp / 'extracted')
            cwd = tmp / 'extracted/source-matrix-planner'
            common = [sys.executable, 'scripts/planner.py', '--input', 'examples/request.json', '--decisions', 'examples/decisions.json', '--as-of', '2026-10-11T00:00:00Z']
            matrix = tmp / 'matrix.json'
            for stage in ('matrix', 'budget', 'both'):
                out = matrix if stage == 'matrix' else tmp / (stage + '.json')
                args = common + ['--stage', stage, '--output', str(out)]
                if stage == 'budget':
                    args += ['--matrix', str(matrix)]
                result = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                payload = json.loads(out.read_text())
                self.assertEqual(payload['matrix_version'], json.loads(matrix.read_text())['matrix_version'])
                if stage != 'matrix':
                    self.assertEqual(payload['budget_plans'][0]['total_cost'], '100.00')
                    self.assertTrue(payload['budget_plans'][0]['execution_recommended'])

    def test_aggregate_example_is_runnable_without_detail(self):
        request = P / 'examples/aggregate-request.json'
        decisions = P / 'examples/aggregate-decisions.json'
        self.assertTrue(request.is_file())
        self.assertTrue(decisions.is_file())
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'result.json'
            process = subprocess.run([sys.executable, str(P / 'scripts/planner.py'),
                '--input', str(request), '--decisions', str(decisions), '--stage', 'both',
                '--as-of', '2026-10-11T00:00:00Z', '--output', str(output)], capture_output=True, text=True)
            self.assertEqual(process.returncode, 0, process.stderr)
            payload = json.loads(output.read_text())
            self.assertEqual(payload['status'], 'complete')
            self.assertEqual(payload['source_analysis']['detail_citations'], [])
            self.assertIsNone(payload['source_analysis']['total_citations'])
            self.assertEqual(payload['matrix']['candidates'][0]['aggregate_ids'], ['ag1'])
            self.assertTrue(payload['budget_plans'][0]['execution_recommended'])
