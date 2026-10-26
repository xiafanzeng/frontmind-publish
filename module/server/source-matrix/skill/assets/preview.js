'use strict';
const CASES=JSON.parse(document.getElementById('caseData').textContent);
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ROLE={authority:'权威参考',industry:'行业核心',regional:'地域覆盖',supplement:'覆盖补充',exploration:'探索验证'};
const ROLE_DESCRIPTION={authority:'企业背景与专业依据',industry:'专业选型与应用问题',regional:'区域服务与本地场景',supplement:'补充内容形式与人群',exploration:'有假设的候选验证'};
const ROLE_HELP={
 authority:{purpose:'提供行业背景、技术概念和专业资料，让读者先理解产品或服务所处的事实语境。',sources:'适合承担背景任务的企业报道、研究资料、实验室介绍或标准解释等；按实际内容选择。',usage:'用于梳理概念、组织有来源的事实和解释应用背景，再衔接到核心层的具体选型内容。例如先说明一类技术解决什么场景问题，再讨论产品参数。'},
 industry:{purpose:'直接回答本次目标问题，是整套内容的主要解释部分。重点是读者为什么需要、怎样选择以及应比较哪些条件。',sources:'与目标行业、产品或服务问题紧密相关的专业介绍、选型问答、技术文章和场景说明。',usage:'围绕核心需求展开比较维度、使用情境、工作流程和交付内容，形成其他层共用的信息主线。例如解释测试服务的范围、实施过程与报告交付。'},
 regional:{purpose:'把行业信息落到目标地区，帮助读者理解当地的服务、采购、到访或使用情境。',sources:'覆盖目标城市或区域、且内容与当地需求有实际联系的媒体或服务栏目。',usage:'说明当地读者关心的服务范围、区域案例与现场安排。选择时同时对照目标地区和候选的覆盖依据；没有匹配候选时保留空行，便于看清这一项覆盖需求。'},
 supplement:{purpose:'补足核心层尚未展开的内容形式、读者问题或阅读场景，使同一套事实更便于不同人群理解。',sources:'能够提供明确补充任务的问答、比较式图文、流程长文或其他适配内容。',usage:'先说明补哪一处，再安排媒体分工。例如核心层解释技术范围，补充层把这些信息转成采购清单、对照表或家长流程问答，帮助读者继续做决定。'},
 exploration:{purpose:'围绕一个明确假设，小范围研究新的表达方式、受众或查询场景，帮助决定是否值得继续投入。',sources:'可能带来新内容形式或新问题入口、适合开展限定范围验证的候选。',usage:'先写清要验证的问题、拟用内容、观察方式和停止条件，再安排小范围验证。例如检验一个操作视频是否让读者更容易复述步骤，并根据问题反馈决定后续内容。'}
};
let current=0,stale=false,opener=null;
const expandedRoles=new Set();
let helpTrigger=null,helpPinned=false,helpHideTimer=null;
const c=()=>CASES[current];
const displayName=r=>r.display_name||r.brief.brand_product||r.observation.source_file.name;
const num=n=>n==null?'未知':Number(n).toLocaleString('zh-CN');
const candidate=key=>c().matrix.find(x=>x.candidate_key===key);

function rows(){const m=$('model').value;return c().observation.records.filter(r=>!m||r.model===m)}
function groups(){
 if(c().observation.metrics.raw_rows===null)return c().observation.groups.map(g=>({...g,records:(c().observation.media_summary.length?c().observation.media_summary:c().observation.content_summary).filter(r=>g.locator_keys.includes(r.locator_key))}));
 const map=new Map();rows().forEach(r=>{const k=JSON.stringify([r.source_name,r.media_domain]);if(!map.has(k))map.set(k,{source_name:r.source_name,media_domain:r.media_domain,records:[]});map.get(k).records.push(r)});
 return [...map.values()].map(g=>({...g,raw_rows:g.records.length,unique_urls:new Set(g.records.map(r=>r.content_url).filter(Boolean)).size}));
}
function openDialog(title,html,trigger){
 hideRoleHelp();
 const dialog=$('detailDialog');if(!dialog.open)opener=trigger||document.activeElement;
 $('dialogTitle').textContent=title;$('dialogBody').innerHTML=html;if(!dialog.open)dialog.showModal();$('closeDialog').focus();
}
function closeDialog(){$('detailDialog').close()}
$('detailDialog').addEventListener('close',()=>{if(opener?.isConnected)opener.focus()});
function sample(r){
 const safe=/^https?:\/\//i.test(r.content_url||'');
 return `<div class="sample"><p><b>${esc(r.title||r.source_name)}</b></p><p>${esc(r.model||'汇总，暂无逐条模型')} · ${esc(r.observed_date||'日期未提供')} · ${esc(r.question||'未提供逐条问题')}</p><p>${esc(r.locator.file)} / ${esc(r.locator.sheet)} / 第 ${esc(r.locator.row)} 行</p>${r.content_url?(safe?`<a href="${esc(r.content_url)}" target="_blank" rel="noopener noreferrer">${esc(r.content_url)}</a>`:`<p>${esc(r.content_url)}</p>`):''}</div>`;
}
function showEvidence(key,trigger,planIndex=null){
 const item=candidate(key);if(!item)return;
 const rr=rows().filter(r=>r.source_name===item.source_name&&r.media_domain===item.media_domain);
 const refs=item.references_detail.filter(r=>!$('model').value||r.model===$('model').value);
 const samples=refs.length?refs:rr.filter((r,i,a)=>a.findIndex(x=>x.content_url===r.content_url)===i).slice(0,3);
 const stats=c().observation.metrics.raw_rows===null?'当前是原汇总数据，没有逐条明细。':`${num(rr.length)} 条导出明细行，${num(new Set(rr.map(r=>r.content_url).filter(Boolean)).size)} 个不同 URL；这些数字不等于独立回答数。`;
 const researchState=({reference_only:'资料参考，未确认可作为本品牌刊发渠道',hold:'暂缓，先核验行业与受众适配',consider:'候选待核验，账号与报价尚未确认'})[item.disposition]||'候选待核验';
 const back=planIndex!==null?`<button class="btn dialog-back" data-plan-back="${planIndex}">← 返回方案理由</button>`:'';
 openDialog(item.source_name+' · 推荐理由',`${back}<h3>为什么放在${esc(ROLE[item.primary_role])}层</h3><div class="media-rationale">${paragraphs(item.reason)}</div>${item.layer_rank?`<h3>本层排序依据</h3><p>本层第 ${esc(item.layer_rank)} 位。${esc(item.ranking_reason)}</p>`:''}<h3>内容方向</h3><div class="media-direction">${paragraphs(item.content_direction)}</div>${item.exploration_hypothesis?`<h3>探索假设</h3>${paragraphs(item.exploration_hypothesis)}`:''}<h3>需要核验</h3><div class="media-verification"><p class="small muted">研究状态：${esc(researchState)}</p>${item.caution?`<p class="small muted">${esc(item.caution)}</p>`:''}${textList(item.verification_items||[])}</div><h3>附件样本行</h3><p class="small muted sample-stats">${stats}</p>${samples.length?samples.map(sample).join(''):'<p>当前筛选下无该媒体样本，不能沿用其观察依据。</p>'}`,trigger);
}
function showRanking(e){openDialog('同层媒体怎样排序',`<p>先明确每层的内容任务，再给符合任务的研究候选排列优先顺序。每层默认显示前三个；更多候选保留在对应层中。</p><ol><li>目标问题贴合度：是否直接回应本次行业、产品与读者问题。</li><li>本层任务匹配：是否能承担背景、核心解释、地域场景、内容补充或探索任务。</li><li>附件样本支撑：主题与具体样本是否足以支持这一判断。</li><li>内容互补性：优先展示分工不同的候选，减少同类页面和相似任务占满前三位。</li><li>核验可行性：把账号、素材和合作条件作为需确认事项；已知错位且暂缓的候选不进入默认展示。</li></ol><p>这是逐候选的语义优先序。报价、预算和导出行数不直接决定顺序，不生成综合分或未来引用概率。具体排序原因可在各媒体详情查看。</p><p class="small muted">${c().ranking_policy?`原始案例 ${esc(c().ranking_policy.observation_groups)} 个观察分组中，${esc(c().ranking_policy.judged_candidates)} 个候选已完成判断。`:'未提供观察范围元数据；按已有层内序号排列，未提供序号时保留原次序。'} 尚未判断的分组继续保留原始观察。地域层需要明确目标地区及对应的研究线索。</p>`,e.currentTarget)}
function paragraphs(value){return String(value||'').split(/\n\s*\n/).filter(x=>x.trim()).map(x=>`<p>${esc(x)}</p>`).join('')}
function textList(values){return `<ul>${values.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`}
function hideRoleHelp(){
 clearTimeout(helpHideTimer);if(helpTrigger){helpTrigger.removeAttribute('aria-describedby');helpTrigger.setAttribute('aria-expanded','false')}
 $('roleHelpTooltip').hidden=true;helpTrigger=null;helpPinned=false;
}
function showRoleHelp(button,pinned=false){
 const detail=ROLE_HELP[button.dataset.roleHelp];if(!detail)return;
 if(helpTrigger&&helpTrigger!==button)hideRoleHelp();clearTimeout(helpHideTimer);helpTrigger=button;helpPinned=pinned;
 const tip=$('roleHelpTooltip');tip.innerHTML=`<h4>${esc(ROLE[button.dataset.roleHelp])}层</h4><b>这一层做什么</b><p>${esc(detail.purpose)}</p><b>适合放什么</b><p>${esc(detail.sources)}</p><b>怎样使用</b><p>${esc(detail.usage)}</p>`;
 tip.hidden=false;button.setAttribute('aria-describedby','roleHelpTooltip');button.setAttribute('aria-expanded','true');
 const anchor=button.getBoundingClientRect(),box=tip.getBoundingClientRect();
 tip.style.left=Math.max(12,Math.min(anchor.right+8,window.innerWidth-box.width-12))+'px';
 tip.style.top=Math.max(12,Math.min(anchor.top,window.innerHeight-box.height-12))+'px';
}
function scheduleRoleHelpHide(){clearTimeout(helpHideTimer);helpHideTimer=setTimeout(()=>{if(helpTrigger&&!helpPinned&&document.activeElement!==helpTrigger&&!$('roleHelpTooltip').matches(':hover')&&!helpTrigger.matches(':hover'))hideRoleHelp()},180)}
function showPlanReason(index,trigger){
 const d=c().research_drafts[index];if(!d||stale||$('model').value)return;
 const ex=d.explanation;
 if(!ex){openDialog(d.name+' · 方案理由',`<p>${esc(d.reason)}</p><p>详细方案说明尚未补齐，请重新生成选择逻辑、媒体分工与方案取舍。</p>`,trigger);return}
 const allocation=ex.content_allocation.map(a=>{const media=candidate(a.candidate_key);return `<div class="allocation-item"><div class="allocation-title"><b>${esc(media?.source_name||a.candidate_key)}</b><span>${esc(a.responsibility)}</span></div><p>${esc(a.content_angle)}</p><button class="quiet" data-reason="${esc(a.candidate_key)}" data-parent-plan="${index}">查看该媒体理由与样本 ↗</button></div>`}).join('');
 const excluded=ex.excluded_candidates.length?`<ul>${ex.excluded_candidates.map(x=>`<li><b>${esc(candidate(x.candidate_key)?.source_name||x.candidate_key)}</b>：${esc(x.reason)}</li>`).join('')}</ul>`:'<p class="muted small">当前判断中没有额外排除候选。</p>';
 openDialog(d.name+' · 方案理由',`<h3>方案目标</h3><p class="plan-objective">${esc(ex.objective)}</p><h3>选择逻辑</h3>${textList(ex.selection_logic)}<h3>媒体分工与内容安排</h3>${allocation}<h3>方案取舍</h3>${textList(ex.tradeoffs)}<h3>未纳入的候选</h3>${excluded}<h3>适用条件</h3>${textList(ex.fit_conditions)}<h3>执行前需确认</h3>${textList(ex.verification_items)}<div class="dialog-cost">费用未知。当前说明解释研究思路；具体账号、报价、稿件版本与数量确认后，才能核算预算和发布条件。</div>`,trigger);
}
function semanticState(){
 const b=c().brief;stale=$('brand').value!==(b.brand_product||'')||$('industry').value!==(b.target_industry||'')||$('regions').value!==(b.regions||[]).join('、')||$('audience').value!==(b.audience||'')||$('hours').value!==String(b.expected_publish_hours||'')||$('material').value!==(b.material_requirement||'')||$('questions').value!==(b.target_questions||[]).join('\n');
}
function loadCase(index){
 current=index;stale=false;expandedRoles.clear();const b=c().brief;
 ['brand','industry','audience'].forEach((id,i)=>$(id).value=b[['brand_product','target_industry','audience'][i]]||'');
 $('regions').value=(b.regions||[]).join('、');$('hours').value=b.expected_publish_hours||'';$('material').value=b.material_requirement||'';$('questions').value=(b.target_questions||[]).join('\n');
 $('sampleFile').value=displayName(c())+'样本';$('model').innerHTML='<option value="">全部已输入模型</option>'+Object.entries(c().observation.models).map(([m,n])=>`<option value="${esc(m)}">${esc(m)} · ${n} 行</option>`).join('');
 $('fileLine').textContent=c().observation.source_file.name;$('budget').value='';$('formStatus').textContent='当前展示本轮已生成的研究结果。';
 ['industry','questions','hours'].forEach(id=>{$(id).removeAttribute('aria-invalid');$(id+'Error').textContent=''});
 render();renderCases();
}
function renderCases(){$('caseSwitch').innerHTML=CASES.map((r,i)=>`<button onclick="loadCase(Number(this.dataset.case))" aria-pressed="${i===current}" data-case="${i}">${esc(displayName(r))}</button>`).join('')}
function render(){renderMatrix();renderDrafts()}
function renderMatrix(){
 hideRoleHelp();
 const gs=groups(),active=$('model').value!=='';
 const eligible=stale?[]:c().matrix.filter(x=>x.disposition!=='hold'&&(!active||gs.some(g=>g.source_name===x.source_name&&g.media_domain===x.media_domain)));
 $('matrixState').hidden=!stale&&!active;
 $('matrixState').textContent=stale?'投放要求已变化，原建议已隐藏。按新要求重新判断后更新矩阵。':'当前仅展示筛选模型下仍有样本的原候选；新组合需重新判断。';
 $('matrixRows').innerHTML=Object.entries(ROLE).map(([key,name])=>{
  const ordered=eligible.filter(x=>x.primary_role===key).sort((a,b)=>(a.layer_rank??Number.MAX_SAFE_INTEGER)-(b.layer_rank??Number.MAX_SAFE_INTEGER));
  const items=expandedRoles.has(key)?ordered:ordered.slice(0,3);
  const content=items.length?`<div class="layer-cards">${items.map(x=>`<article class="matrix-media" data-role="${key}" data-candidate="${esc(x.candidate_key)}"><div class="media-header"><b class="media-name" title="${esc(x.source_name)}">${esc(x.source_name)}</b><button class="quiet media-reason" onclick="showEvidence(this.dataset.reason,this)" data-reason="${esc(x.candidate_key)}" aria-label="查看${esc(x.source_name)}推荐理由">查看推荐理由 ↗</button></div><div class="domain">${esc(x.media_domain)}</div><div class="direction media-intro">${esc(x.media_intro||'本次信源分析样本中的内容来源。')}</div></article>`).join('')}</div>`:`<div class="layer-empty">${stale?'新要求尚无判断。':key==='regional'?'暂无可确认地域覆盖的候选。':'本例暂无符合条件的候选。'}</div>`;
  return `<tr data-role="${key}"><th scope="row"><div class="role-heading"><strong>${name}层</strong><button type="button" class="role-help" data-role-help="${key}" aria-label="了解${name}层的作用" aria-controls="roleHelpTooltip" aria-expanded="false">?</button></div><span>${ROLE_DESCRIPTION[key]}</span>${ordered.length>3?`<button type="button" id="more-${key}" class="quiet layer-more" data-layer-more="${key}" onclick="toggleLayer(this.dataset.layerMore)" aria-expanded="${expandedRoles.has(key)}">${expandedRoles.has(key)?'收起候选':'更多候选 '+(ordered.length-3)}</button>`:''}</th><td>${content}</td></tr>`;
 }).join('');
}
function renderDrafts(){
 const filtered=$('model').value!=='';
 $('drafts').innerHTML=stale?'<div class="empty">新投放要求尚无组合判断。</div>':filtered?'<div class="empty">模型范围已变化。<br>需用筛选后的样本重新判断组合。</div>':c().research_drafts.map((d,i)=>`<section class="draft"><h4>${esc(d.name)}</h4><p class="muted">${esc(d.reason)}</p><div class="chips">${d.candidate_keys.map(k=>`<span class="chip">${esc(candidate(k)?.source_name||k)}</span>`).join('')}</div><div class="draft-state"><span>费用 <b>未知</b></span><span>研究草案 · 待报价</span></div><div class="draft-action"><button class="btn" data-plan-reason="${i}">查看方案理由与内容分工 ↗</button></div></section>`).join('');
 budgetNote();
}
function budgetNote(){const b=$('budget').value;$('budgetNote').textContent=b&&Number(b)>=0?`已记录预算 ${Number(b).toLocaleString('zh-CN')} 元。无报价，当前无法核算费用。`:b?'预算需为非负金额。':'没有报价，当前费用未知。'}



$('drafts').addEventListener('click',e=>{const b=e.target.closest('[data-plan-reason]');if(b)showPlanReason(Number(b.dataset.planReason),b)});
$('dialogBody').addEventListener('click',e=>{
 const media=e.target.closest('[data-reason]');if(media){showEvidence(media.dataset.reason,media,Number(media.dataset.parentPlan));return}
 const back=e.target.closest('[data-plan-back]');if(back)showPlanReason(Number(back.dataset.planBack),back);
});
$('model').addEventListener('change',()=>{expandedRoles.clear();render();$('formStatus').textContent=$('model').value?'已筛选样本；原组合暂不展示，需重新判断。':'已恢复全部模型与原研究草案。'});
$('briefForm').addEventListener('input',e=>{if(!['model','sampleFile'].includes(e.target.id)){semanticState();render();$('formStatus').textContent=stale?'要求已变化，原语义判断已失效。':'已恢复本例原投放要求。'}});
$('briefForm').addEventListener('submit',e=>{
 e.preventDefault();const errors=[];
 [['industry','请填写目标行业。'],['questions','请填写至少一个目标问题。']].forEach(([id,msg])=>{const bad=!$(id).value.trim();$(id+'Error').textContent=bad?msg:'';$(id).setAttribute('aria-invalid',String(bad));if(bad)errors.push(id)});
 const badHours=$('hours').value&&!(Number($('hours').value)>0);$('hoursError').textContent=badHours?'时效需为正数，或留空表示未限定。':'';$('hours').setAttribute('aria-invalid',String(!!badHours));if(badHours)errors.push('hours');
 if(errors.length){$(errors[0]).focus();$('formStatus').textContent='请先补齐标出的投放要求。';return}
 semanticState();render();$('formStatus').textContent=stale?'新输入已保留。当前离线预览不调用模型，请按新要求重新判断。':'已显示本轮研究矩阵；当前没有调用新模型。';$('recommendationView').scrollIntoView({block:'start',behavior:'instant'});$('recommendationTitle').focus({preventScroll:true});
});
$('budget').addEventListener('input',budgetNote);
function toggleLayer(role){if(!Object.hasOwn(ROLE,role))return;if(expandedRoles.has(role))expandedRoles.delete(role);else expandedRoles.add(role);renderMatrix();$('more-'+role)?.focus({preventScroll:true})}
$('matrixRows').addEventListener('pointerover',e=>{const b=e.target.closest('[data-role-help]');if(b&&b!==helpTrigger)showRoleHelp(b)});
$('matrixRows').addEventListener('pointerout',e=>{if(e.target.closest('[data-role-help]'))scheduleRoleHelpHide()});
$('matrixRows').addEventListener('focusin',e=>{const b=e.target.closest('[data-role-help]');if(b&&b!==helpTrigger)showRoleHelp(b)});
$('matrixRows').addEventListener('focusout',scheduleRoleHelpHide);
$('matrixRows').addEventListener('click',e=>{const b=e.target.closest('[data-role-help]');if(!b)return;if(helpTrigger===b&&helpPinned)hideRoleHelp();else showRoleHelp(b,true)});
$('roleHelpTooltip').addEventListener('pointerenter',()=>clearTimeout(helpHideTimer));
$('roleHelpTooltip').addEventListener('pointerleave',scheduleRoleHelpHide);
document.addEventListener('pointerdown',e=>{if(helpTrigger&&!helpTrigger.contains(e.target)&&!$('roleHelpTooltip').contains(e.target))hideRoleHelp()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&helpTrigger){hideRoleHelp();e.preventDefault()}});
window.addEventListener('scroll',e=>{if(e.target!==$('roleHelpTooltip'))hideRoleHelp()},true);window.addEventListener('resize',hideRoleHelp);
function countBy(rr,field){const map={};rr.forEach(r=>{if(r[field]!=null)map[r[field]]=(map[r[field]]||0)+1});return map}
function currentInput(){return {brand_product:$('brand').value||null,target_industry:$('industry').value||null,regions:$('regions').value.split(/[、,，]/).map(x=>x.trim()).filter(Boolean),audience:$('audience').value||null,expected_publish_hours:$('hours').value?Number($('hours').value):null,material_requirement:$('material').value||null,target_questions:$('questions').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),sample_models:$('model').value?[$('model').value]:null,budget:$('budget').value?{currency:'CNY',total_cap:$('budget').value}:null,assumptions:c().brief.assumptions}}
function currentObservation(){
 const a=JSON.parse(JSON.stringify(c().observation));if(!$('model').value)return a;
 const rr=rows();a.records=rr;a.groups=groups().map(g=>{const original=c().observation.groups.find(x=>x.source_name===g.source_name&&x.media_domain===g.media_domain);return {...original,raw_rows:g.raw_rows,unique_urls:g.unique_urls,locator_keys:g.records.map(r=>r.locator_key),models:countBy(g.records,'model'),questions:countBy(g.records,'question')}});
 a.models=countBy(rr,'model');a.monitored_questions=countBy(rr,'question');a.observed_dates=countBy(rr,'observed_date');a.reconciliation.status='not_comparable_filtered';a.reconciliation.original_detail_rows=c().observation.metrics.raw_rows;a.reconciliation.detail_rows=rr.length;
 if(a.metrics.raw_rows!==null){const distinct=new Set(rr.map(r=>JSON.stringify([r.observed_date,r.model,r.question,r.title,r.content_url,r.source_name,r.media_domain]))).size;a.metrics={raw_rows:rr.length,distinct_export_rows:distinct,extra_identical_rows:rr.length-distinct,unique_urls:new Set(rr.map(r=>r.content_url).filter(Boolean)).size,source_groups:a.groups.length,exact_citation_count:null}}
 return a;
}
function showInput(e){const a=currentObservation();openDialog('本次输入与样本信息',`<pre>${esc(JSON.stringify({brief:currentInput(),source_file:a.source_file,monitored_questions:a.monitored_questions,metrics:a.metrics,reconciliation:a.reconciliation,reported_periods:a.reported_periods,observed_dates:a.observed_dates,missing_evidence_fields:a.missing_evidence_fields,limitations:a.limitations},null,2))}</pre>`,e.currentTarget)}
function downloadResult(){
 const result=JSON.parse(JSON.stringify(c()));const oldVersion=result.input_version;result.brief=currentInput();result.observation=currentObservation();
 result.preview={base_input_version:oldVersion,semantic_status:stale||$('model').value?'stale_decisions':'original_judgment',selected_model:$('model').value||null,presentation_version:'2026-10-26'};
 if(stale||$('model').value){result.status='stale_decisions';result.matrix=[];result.research_drafts=[];result.input_version=null;delete result.ranking_policy}
 const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(c().case_id||'case')+'-research-snapshot.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('formStatus').textContent='已导出当前结果；需求或样本变化时不包含过期建议。';
}
loadCase(0);
