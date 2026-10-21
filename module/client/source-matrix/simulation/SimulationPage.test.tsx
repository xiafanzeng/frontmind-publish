// @vitest-environment jsdom
// Source-only UI regression cases; not executed in this round.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SourceMatrixPage from '../SourceMatrixPage';
import { SourceMatrixPreviewContext } from './mode';
import { SIMULATION_NOTICE } from './data';
const gateway=vi.hoisted(()=>({listMedia:vi.fn()}));
vi.mock('../../PublishingContext',()=>({usePublisherGateway:()=>gateway}));

afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();window.history.replaceState({},'', '/');});
it('uses an offline pipeline even when a real task and draft are present in the URL',{timeout:300000},async()=>{
  window.history.replaceState({},'', '/publishing/source-matrix?simulation=1&task=real-task&draftId=real-draft');
  const fetch=vi.fn(()=>{throw new Error('Simulation must not call network');});vi.stubGlobal('fetch',fetch);
  render(<div className="monitoring-module"><SourceMatrixPage/></div>);
  await screen.findByRole('button',{name:'生成模拟信源矩阵 →'});
  expect(screen.getByText(SIMULATION_NOTICE)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'生成模拟信源矩阵 →'}));
  await screen.findByRole('button',{name:'按预算真实计算 →'});
  fireEvent.click(screen.getByRole('button',{name:'按预算真实计算 →'}));
  await screen.findByText('边界观察（诊断提案）');
  expect(screen.queryByRole('button',{name:/确认加入购物车/})).toBeNull();
  expect(screen.queryByRole('link',{name:/购物车/})).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
it('defaults standalone preview to simulation and allows an explicit real-mode override',async()=>{
  window.history.replaceState({},'', '/publishing/source-matrix');
  const fetch=vi.fn(async()=>({ok:true,json:async()=>({industries:[],message:'真实服务配置'})}));vi.stubGlobal('fetch',fetch);
  const view=render(<div className="monitoring-module"><SourceMatrixPreviewContext.Provider value={true}><SourceMatrixPage/></SourceMatrixPreviewContext.Provider></div>);
  await screen.findByRole('button',{name:'生成模拟信源矩阵 →'});expect(fetch).not.toHaveBeenCalled();
  view.unmount();window.history.replaceState({},'', '/publishing/source-matrix?simulation=0');
  render(<div className="monitoring-module"><SourceMatrixPreviewContext.Provider value={true}><SourceMatrixPage/></SourceMatrixPreviewContext.Provider></div>);
  await screen.findByText('真实服务配置');expect(fetch).toHaveBeenCalled();
});
