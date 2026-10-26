"""Build a byte-reproducible allowlisted distribution (Python 3.10+, stdlib)."""
import argparse
from pathlib import Path
import zipfile

PACKAGE = Path(__file__).resolve().parents[1]
ROOT = PACKAGE
FILES = ['README.md', 'verification.md'] + ['source-matrix-planner/' + name for name in [
    'SKILL.md', 'README.md', 'verification.md', 'ORIGIN.md', 'VERSION', 'requirements.txt', 'requirements-excel.txt', 'agents/openai.yaml',
    'scripts/content_planning.py', 'references/content-planning.md', 'references/website-integration.md', 'tests/test_content_planning.py',
    'scripts/export_adapter.py', 'scripts/render_preview.py', 'assets/preview.html',
    'assets/preview.css', 'assets/preview.js', 'tests/test_draft_explanation.py',
    'references/export-research.md', 'examples/export-brief.json',
    'tests/test_export_adapter.py', 'tests/test_preview.py',
    'examples/request.json', 'examples/decisions.json',
    'examples/aggregate-request.json', 'examples/aggregate-decisions.json',
    'references/contracts.md', 'references/evidence-rules.md', 'references/matrix-rules.md',
    'references/budget-rules.md', 'references/identity-config.json',
    'scripts/__init__.py', 'scripts/contracts.py', 'scripts/evidence.py', 'scripts/matrix.py',
    'scripts/budget.py', 'scripts/planner.py', 'scripts/build_package.py',
    'tests/__init__.py', 'tests/test_contracts.py', 'tests/test_evidence.py',
    'tests/test_matrix.py', 'tests/test_budget.py', 'tests/test_planner.py',
    'tests/test_package.py', 'tests/test_final_regressions.py', 'tests/scenarios.md',
]]


def build(output):
    contents = []
    for name in sorted(FILES):
        source = ROOT / name.removeprefix('source-matrix-planner/')
        if source.is_symlink() or any(p.is_symlink() for p in source.parents if p != ROOT):
            raise ValueError('Symlink not allowed: ' + name)
        contents.append((name, source.read_bytes()))
    output = Path(output)
    if output.resolve() in {(ROOT / name.removeprefix('source-matrix-planner/')).resolve() for name in FILES}:
        raise ValueError('Output would overwrite distribution source')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, content in contents:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    print(build(parser.parse_args().output))
