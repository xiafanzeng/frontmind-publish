import io,re

p='module/client/source-matrix/SourceMatrixPage.tsx'
s=io.open(p,encoding='utf-8',newline='').read()
pairs=[
# state
("const [confirmBudget,setConfirmBudget]=useState<BudgetPlan|null>(null),[confirmLayer,setConfirmLayer]=useState<MatrixResult['matrix']['candidates']|null>(null),[layerChecked,setLayerChecked]=useState<string[]>([]),[reasonCandidate,setReasonCandidate]=useState<MatrixResult['matrix']['candidates'][number]|null>(null),[planIndex,setPlanIndex]=useState(0),[showReport,setShowReport]=useState(false);",
 "const [confirmBudget,setConfirmBudget]=useState<BudgetPlan|null>(null),[confirmLayer,setConfirmLayer]=useState<MatrixResult['matrix']['candidates']|null>(null),[layerChecked,setLayerChecked]=useState<string[]>([]),[reasonCandidate,setReasonCandidate]=useState<MatrixResult['matrix']['candidates'][number]|null>(null),[planIndex,setPlanIndex]=useState(0);"),
# header buttons (real + demo)
("{result&&!showingPrevious&&<button className=\"link small\" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起报告':'查看报告'}</button>}",
 ""),
("<button className=\"link small\" onClick={()=>downloadMatrixData('一航软件-已生成研究样本.json',JSON.stringify(matrixDemo,null,2),'application/json')}>导出保存样本</button><button className=\"link small\" onClick={()=>setShowReport(value=>!value)}>{showReport?'收起样本报告':'查看样本报告'}</button>",
 "<button className=\"link small\" onClick={()=>downloadMatrixData('一航软件-已生成研究样本.json',JSON.stringify(matrixDemo,null,2),'application/json')}>导出保存样本</button>"),
# report panel
("    {showReport&&displayResult&&<div className=\"sm-report\"><div className=\"actions\"><button className=\"button secondary\" disabled={!demoActive&&!reportReady} onClick={()=>window.print()}>{demoActive?'打印保存样本报告':'打印报告'}</button></div>{demoActive?<DemoReport demo={matrixDemo} stale={demoBudgetStale}/>:quantityEditing?<p role=\"status\">篇数修改尚未完成费用更新，报告将在更新后显示。</p>:result&&<Report result={result}/>}</div>}\n",
 ""),
# reportReady
(" const reportReady=!!result&&!busy&&!quantityEditing&&!budgetStale&&result.matrix.status==='complete'&&['complete','needs_budget','needs_budget_plans'].includes(result.status)&&!result.errors.length&&!!result.plan_id&&!!result.plan_version;\n",
 ""),
# imports
("import {DemoBudgetRecommendations,DemoReport} from './DemoRecommendation';",
 "import {DemoBudgetRecommendations} from './DemoRecommendation';"),
("import { label,display,Report,BudgetConfirmDialog,MatrixDialog,downloadMatrixData } from './SourceMatrixPresentation';",
 "import { label,display,BudgetConfirmDialog,MatrixDialog,downloadMatrixData } from './SourceMatrixPresentation';"),
]
for old,new in pairs:
    assert s.count(old)==1,(old[:60],s.count(old))
    s=s.replace(old,new)
# strip remaining setShowReport calls
count=len(re.findall(r'setShowReport\(false\);',s))
s=s.replace('setShowReport(false);','')
print('page ok, removed setShowReport calls:',count)

p2='module/client/source-matrix/SourceMatrixPage.test.tsx'
t=io.open(p2,encoding='utf-8',newline='').read()
pairs2=[
(" expect(screen.queryByRole('link',{name:'导出当前版本'})).toBeNull();\r\n expect(screen.getByRole('button',{name:'查看报告'})).toBeTruthy();\r\n",
 " expect(screen.queryByRole('link',{name:'导出当前版本'})).toBeNull();\r\n"),
(" expect(screen.getByRole('button',{name:'查看样本报告'})).toBeTruthy();\r\n",
 " expect(screen.getByRole('button',{name:'导出保存样本'})).toBeTruthy();\r\n"),
(" fireEvent.click(screen.getByRole('button',{name:'查看样本报告'}));\r\n expect(screen.getByRole('heading',{name:'一航软件信源矩阵与研究组合'})).toBeTruthy();\r\n expect(screen.getByText(/保存条件下的历史对照/)).toBeTruthy();\r\n",
 ""),
(" await screen.findByRole('button',{name:'查看样本报告'});\r\n fireEvent.click(screen.getByRole('button',{name:'查看样本报告'}));\r\n",
 " await screen.findByRole('button',{name:'导出保存样本'});\r\n"),
("expect(screen.getByText('预计总价').parentElement?.textContent).toContain('500.00');expect(screen.getByRole('button',{name:'查看报告'})).toBeTruthy();expect(quantityRequests).toEqual([]);",
 "expect(screen.getByText('预计总价').parentElement?.textContent).toContain('500.00');expect(quantityRequests).toEqual([]);"),
]
for old,new in pairs2:
    assert t.count(old)==1,(old[:60],t.count(old))
    t=t.replace(old,new)
io.open(p2,'w',encoding='utf-8',newline='').write(t)
print('tests ok')
io.open(p,'w',encoding='utf-8',newline='').write(s)
