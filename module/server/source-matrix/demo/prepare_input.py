"""Map preserved workbook observations to non-purchasable Skill research rows.

This does not assign roles, choose combinations, manufacture evidence IDs or
declare a publication channel. AI decisions are separately authored JSON.
"""
import argparse
from collections import OrderedDict
from copy import deepcopy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def prepare(workbook):
    batch = workbook['batch']
    groups = OrderedDict()
    for record in batch['records']:
        key = (record['mediaName'], record['mediaUrl'])
        groups.setdefault(key, []).append(deepcopy(record))
    catalog = []
    for (name, url), records in groups.items():
        catalog.append({
            'source_name': name, 'domain': url,
            'data_kind': 'raw_brand_observation_context',
            'observation_context': {
                'source_file': batch['sourceFile'], 'source_sha256': batch['sourceSha256'],
                'source_period': deepcopy(batch['period']), 'grouping': 'exact mediaName + mediaUrl',
                'records': records,
                'limitations': ['原始导出行不等于可确认的独立回答引用事件。',
                    '平台、账号和可售渠道未映射；标题仅是导出内容，不表示已核验原文或其中宣传主张。',
                    '没有报价、稿件版本、刊发能力或发布时间。']
            }
        })
    questions = [
        {'question_id': 'q1', 'text': '采购第三方软件测试服务时，应如何核验机构资质与测试报告适用范围？'},
        {'question_id': 'q2', 'text': '软件验收与安全测试服务如何比较技术方法、交付物和服务商能力？'},
        {'question_id': 'q3', 'text': '如何用资质说明、技术案例和常见问题内容帮助企业理解一航软件的服务？'}
    ]
    assumptions = [
        {'field':'product','label':'演示假设','value':'一航软件；名称来自用户提供样本，具体产品和品牌资质未核验。'},
        {'field':'industry','label':'演示假设','value':'软件测试服务；依据样本唯一监控问题设置，不代表上游行业分类。'},
        {'field':'audience','label':'演示假设','value':'企业采购、信息化负责人和软件质量负责人。'},
        {'field':'regions','label':'演示假设','value':'全国；未设置局部地域目标。'},
        {'field':'questions','label':'演示假设','value':'三个任务问题由 AI 根据原监控问题细化，并非原始回答问题 ID。'},
        {'field':'budget','label':'演示假设','value':'总预算人民币 3000 元；启用探索，探索上限 600 元包含在总额内，均不是报价。'},
        {'field':'requirements','label':'演示假设','value':'不限定发布时效与素材能力；未提供稿件，不生成稿件身份。'}
    ]
    request = {'task': {'industry':'软件测试服务','product':'一航软件','audience':'企业采购、信息化负责人、软件质量负责人',
        'regions':['nationwide'], 'questions':questions,'requirements':{}},
        'citations':[], 'industry_recommendations':[], 'catalog':catalog,
        'identity_config':{}, 'scope':{'data_kind':'raw_brand_observation_context',
            'source_sha256':batch['sourceSha256'], 'period':deepcopy(batch['period'])}}
    # Missing answer identities remain observations inside research attributes.
    # No original content is interpreted as an external industry aggregate.
    mapping = {'source_file':batch['sourceFile'],'source_sha256':batch['sourceSha256'],
        'field_mapping':workbook['provenance']['detailFieldMapping'],
        'sheet_mapping':workbook['provenance']['sheetColumnMapping'],
        'reconciliation':workbook['provenance']['reconciliation'],
        'original_question_texts':list(dict.fromkeys(r['question'] for r in batch['records'])),
        'policy':{'duplicates':'Retained in workbook.json and each observation_context.records.',
          'catalog':'Research attribute rows only: resource_id, offer_id and pricing are absent.',
          'candidate_id':'unverified_offer:<catalog index> is the original Skill research key, not an offer ID.',
          'citations':'Empty: no answer IDs or evidence IDs are fabricated from workbook row numbers.',
          'industry_recommendations':'Empty: brand observations are not independent industry background.',
          'source_row_id':'Workbook SHA + sheet + row is provenance only, not citation evidence.',
          'published_at':'Unknown; citation date is never used as publication date.'},
        'groups':[{'catalog_index':i,'candidate_id':f'unverified_offer:{i}','media_name':c['source_name'],
                   'media_url':c['domain'],'rows':[r['sourceRow'] for r in c['observation_context']['records']]}
                  for i,c in enumerate(catalog)]}
    form={'product':'一航软件','industry':'软件测试服务','region':'全国',
        'audience':'企业采购、信息化负责人、软件质量负责人','publicationHours':'','materialRequirement':'',
        'brandDataBatchId':batch['id'],'platforms':[], 'questions':'\n'.join(q['text'] for q in questions),
        'budget':'3000','explorationEnabled':True,'explorationCap':'600'}
    write(ROOT/'inputs/matrix-input.json',request)
    budget_input=deepcopy(request)
    budget_input['budget']={'currency':'CNY','total_cap':'3000','exploration_enabled':True,'exploration_cap':'600'}
    write(ROOT/'inputs/budget-input.json',budget_input)
    write(ROOT/'inputs/source-mapping.json',mapping)
    write(ROOT/'inputs/demo-context.json',{'assumptions':assumptions,'form':form})
    return mapping


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook',type=Path,default=ROOT/'inputs/workbook.json')
    args=parser.parse_args()
    result=prepare(json.loads(args.workbook.read_text(encoding='utf-8')))
    print(json.dumps({'status':'prepared','groups':len(result['groups']),'reconciliation':result['reconciliation']},ensure_ascii=False))
