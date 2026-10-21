import type { Row } from './kernel/common.js';

export const SIMULATION_SEED = 0x5eed2026;
export const SIMULATION_AS_OF = '2026-10-21T08:00:00Z';
export const SIMULATION_NOTICE = '模拟模式：媒体数据与 AI 决策为模拟生成，计算结果仅供演示，非真实采购依据';
export const industries = [
  { id:'sim-orbit', name:'星穹微农', topic:'轨道温室与微型种植', prefix:'星穹' },
  { id:'sim-tide', name:'潮汐储能', topic:'潮汐电池与海岸储能', prefix:'潮汐' },
  { id:'sim-cloud', name:'云织家居', topic:'自适应织物与智能家居', prefix:'云织' },
  { id:'sim-light', name:'光苔照明', topic:'植物光源与生态照明', prefix:'光苔' },
  { id:'sim-sand', name:'砂舟出行', topic:'沙地轻型交通与导航', prefix:'砂舟' },
  { id:'sim-snow', name:'雪晶制造', topic:'低温精密制造与材料', prefix:'雪晶' },
  { id:'sim-sound', name:'声谷教育', topic:'空间声学与沉浸式教学', prefix:'声谷' },
] as const;
export const demoManuscripts = [
  { article_id:'sim-article-a', version:'v1', title:'虚构技术应用介绍（模拟稿件）' },
  { article_id:'sim-article-b', version:'v1', title:'虚构采购场景说明（模拟稿件）' },
];
export interface SimulationInput {
  industryId:string; product:string; audience:string; regions:string[]; questions:string[];
  hours:string; requirement:string; platform:string;
}
export interface SimulationBudget {
  currency:string; total_cap:string; exploration_enabled:boolean;
  exploration_cap?:string; unit_price_min?:string; unit_price_max?:string;
}
export const defaultInput = ():SimulationInput => ({
  industryId:industries[0].id, product:'示例品牌（虚构）', audience:'企业采购与技术团队', regions:['全国'],
  questions:['如何选择适合企业的技术方案？','采购时应核实哪些应用案例？'], hours:'', requirement:'', platform:'',
});
function random(seed:number) {
  let x=seed>>>0;
  return (bound:number) => {x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)%bound;};
}
const edgeKinds = ['attribute_conflict','identity_conflict','missing_price','explicitly_unlimited','unknown'] as const;
const platforms=['模拟资讯站','模拟公众号','模拟视频号','模拟社区','模拟垂直期刊'];
const regions=['上海','广东','北京','江苏','浙江','四川','全国'];
/** Only inputs are invented here. All derived statuses/counts/costs belong to the kernel. */
export function generateSimulationData(seed=SIMULATION_SEED) {
  const next=random(seed), catalog:Row[]=[], evidenceTemplates:Row[]=[], recommendations:Row[]=[];
  for (const [group,industry] of industries.entries()) {
    for (let local=0;local<32;local++) {
      const index=group*32+local, id=`sim-media-${String(index+1).padStart(3,'0')}`;
      const edge=local<edgeKinds.length?edgeKinds[local]:undefined;
      const platform=platforms[next(platforms.length)]!, region=regions[next(regions.length)]!;
      const currency=local%11===6?'USD':local%13===7?'EUR':local%17===8?'JPY':'CNY';
      const kind=local%9===5?'package':local%7===6?'range':'unit';
      const tier=[80,240,650,1800,4200][next(5)]!, amount=String(tier+next(90));
      const name=`${industry.prefix}${['观察','研报','视界','前沿','工坊','周刊','见闻','智讯'][local%8]}${String(local+1).padStart(2,'0')}（虚构）`;
      const domain=`${id}.example.invalid`, spec=kind==='package'?'双稿图文套餐':'单篇图文';
      const publication=(m:Row)=>({article_id:m.article_id,version:m.version,resource_id:id,offer_id:`sim-offer-${index+1}`,publication_spec:spec,quantity:1,purpose:'standard'});
      const row:Row={
        resource_id:id,offer_id:`sim-offer-${index+1}`,source_name:name,domain,account_id:`sim-account-${index+1}`,
        url:`https://${domain}/`,industry:industry.name,industry_topic:industry.topic,platform,regions:[region],
        publication_status:'available',publication_spec:spec,supported_formats:['text','image'],
        supports_links:true,supports_images:true,supports_tables:local%6!==5,
        publication_hours:[6,12,24,48,72][next(5)],indexing_type:['模拟全文收录','模拟标题收录','不承诺收录'][next(3)],
        weight:next(10)+1,followers:1000+next(800000),verified:local%3!==1,
        case_links:[`https://${domain}/case/${next(9000)+1}`],
        title_rule:{state:'limited',max:20+next(50)},body_rule:{state:'limited',max:1800+next(8000)},
        image_rule:{state:'limited',max:3+next(10)},simulation_edge:edge??null,
        hard_conditions:[],manuscript_checks:demoManuscripts.map(m=>({article_id:m.article_id,version:m.version,status:'pass',source:'simulated_input'})),
        pricing:{kind,currency,...(kind==='range'?{lower_bound:amount,upper_bound:String(Number(amount)+120)}:{amount}),
          quoted_at:'2026-10-01T00:00:00Z',valid_until:'2026-12-31T23:59:59Z',
          mandatory_fees:local%4===0?[{amount:'15',basis:'item'}]:[],
          ...(kind==='package'?{included_items:demoManuscripts.map(publication)}:{}),
        },
      };
      if(edge==='missing_price')delete row.pricing.amount;
      if(edge==='explicitly_unlimited') {
        row.title_rule={state:'explicitly_unlimited'};row.body_rule={state:'explicitly_unlimited'};
        row.image_rule={state:'explicitly_unlimited'};
      }
      if(edge==='unknown') {
        row.supports_images=null;row.publication_hours=null;row.image_rule={state:'unknown'};
        row.hard_conditions=[{rule_id:'provider_condition_unconfirmed',status:'needs_review'}];
        row.manuscript_checks=[];delete row.pricing.mandatory_fees;
      }
      catalog.push(row);
      if(edge==='attribute_conflict')catalog.push({...structuredClone(row),offer_id:`sim-conflict-${index+1}`,supports_images:false,industry:`${industry.name}（供应商分类冲突）`});
      recommendations.push({recommendation_id:`sim-rec-${index+1}`,resource_id:id,industry:industry.name,source_name:name,reason:`虚构的${industry.topic}行业清单`,source:'simulated'});
      const count=1+next(3);
      for(let n=0;n<count;n++) {
        const record:Row={
          data_kind:'detail',source_type:'external_data',evidence_id:`sim-e-${index+1}-${n}`,usage:'detail_evidence',
          source_name:name,domain,account_id:row.account_id,industry:industry.name,
          answer_record_id:`sim-answer-${index+1}-${n}`,citation_url:`https://${domain}/articles/${n+1}`,
          platform:n%2?'模拟问答乙':'模拟问答甲',model:'sim-model',model_version:'v1',question_slot:n%2,
          period:{start:'2026-09-01',end:'2026-10-20'},published_at:['2026-10-19','2026-09-30','2025-01-01'][n%3],
        };
        if(edge==='unknown')delete record.model_version;
        evidenceTemplates.push(record);
        if(edge==='identity_conflict'&&n===0)evidenceTemplates.push({...record,evidence_id:`${record.evidence_id}-conflict`,account_id:'sim-wrong-identity'});
      }
      if(local%8===0)evidenceTemplates.push({
        data_kind:'aggregate',source_type:'external_data',aggregate_id:`sim-aggregate-${index+1}`,
        source_id:'sim-industry-dataset',data_version:'seed-v1',unit:'mentions',count:10+next(200),usage:'industry_context',
        source_name:name,domain,account_id:row.account_id,scope:{industry:industry.name},
        applicability:{kind:'industry_context',industry:industry.name},
      });
      if(local===1)evidenceTemplates.push({
        data_kind:'aggregate',source_type:'supplier_claim',evidence_id:`sim-claim-${group}`,
        source_name:name,domain,industry:industry.name,usage:'supplier_claim',claim:'供应商声称覆盖本行业，尚无独立证明',count:500+next(500),
      });
    }
  }
  return {seed,catalog,evidenceTemplates,recommendations};
}
export type SimulationDataset=ReturnType<typeof generateSimulationData>;

export function simulationRequest(input:SimulationInput,dataset:SimulationDataset):Row {
  const industry=industries.find(x=>x.id===input.industryId);
  if(!industry)throw new Error('请选择模拟行业。');
  const questions=input.questions.map(x=>x.trim()).filter(Boolean).map((text,i)=>({question_id:`sim-q-${i+1}`,text}));
  if(!questions.length)throw new Error('请填写至少一个目标问题，每行一个。');
  if(input.hours!==''&&(!/^\d+$/.test(input.hours)||!Number.isSafeInteger(Number(input.hours))))throw new Error('发布时效须为非负整数小时，留空表示不限定。');
  const requirements:Row={formats:['text']};
  if(input.requirement)requirements[input.requirement]=true;
  const catalog=structuredClone(dataset.catalog);
  // Simulated observations, expressed as the kernel's trusted hard-condition input contract.
  for(const row of catalog)if(input.hours!=='')row.hard_conditions.push({
    rule_id:'requested_publication_hours',status:row.publication_hours==null?'needs_review':row.publication_hours<=Number(input.hours)?'pass':'fail',
    actual:row.publication_hours,expected_max:input.hours,
  });
  const citations=dataset.evidenceTemplates.filter(r=>!input.platform||r.data_kind==='aggregate'||r.platform===input.platform).map(original=>{
    const r=structuredClone(original);r.tenant_id='simulated-offline';
    if(r.data_kind==='detail') {r.question_id=questions[Number(r.question_slot)%questions.length]!.question_id;delete r.question_slot;}
    return r;
  });
  return {
    tenant_id:'simulated-offline',task_id:'simulated-source-matrix',brand_id:'simulated-brand',
    task:{industry:industry.name,product:input.product,audience:input.audience,regions:input.regions.length?input.regions:['全国'],questions,requirements,manuscripts:structuredClone(demoManuscripts)},
    catalog,citations,industry_recommendations:structuredClone(dataset.recommendations),
    scope:{tenant_id:'simulated-offline',period:{start:'2026-09-01',end:'2026-10-20'}},
    identity_config:{tracking_parameters:['utm_source']},
  };
}
