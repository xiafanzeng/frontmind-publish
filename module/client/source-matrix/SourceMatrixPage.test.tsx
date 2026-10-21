// @vitest-environment jsdom
import { cleanup,render,screen,waitFor } from '@testing-library/react';
import { afterEach,expect,it,vi } from 'vitest';
import SourceMatrixPage from './SourceMatrixPage';
const mediaGateway=vi.hoisted(()=>({listMedia:vi.fn()}));
vi.mock('../PublishingContext',()=>({usePublisherGateway:()=>mediaGateway}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();window.history.replaceState({},'', '/');});
it('shows the unconfigured industry state without invented media',async()=>{
 window.history.replaceState({},'', '/publishing/source-matrix');
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,json:async()=>({status:'configuration_required',industries:[],message:'行业数据尚未配置'})})));
 render(<div className="monitoring-module"><SourceMatrixPage/></div>);
 await screen.findByText('行业数据尚未配置');expect((screen.getByLabelText('目标行业') as HTMLSelectElement).disabled).toBe(true);expect(screen.queryByText('加入组合偏好')).toBeNull();
});
it('renders a structured stale result without reading nonexistent matrix fields',async()=>{
 window.history.replaceState({},'', '/publishing/source-analysis?task=task');
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/industries')?{industries:[]}:{task_id:'task',state:'complete',result:{status:'stale_matrix',errors:[{code:'stale_matrix',message:'任务已变化，请重新生成'}]}}})));
 render(<div className="monitoring-module"><SourceMatrixPage view="analysis"/></div>);
 await screen.findByText('任务已变化，请重新生成');await waitFor(()=>expect(screen.getByText('暂无引用信源数据')).toBeTruthy());
});
