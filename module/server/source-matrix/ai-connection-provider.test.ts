// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpointFor, invokeAi, listProviderModels, type AiProvider, type AiSettings } from './ai-connection-provider.js';

const settings = (provider: AiProvider, extra: Partial<AiSettings> = {}): AiSettings => ({ name: 'Example', provider, model: 'my-deployment', apiKey: 'test-only-key', ...extra });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const completion = () => json({ id: 'example', object: 'chat.completion', created: 1, model: 'my-deployment', choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('AI provider routing', () => {
  it.each<[AiProvider, string]>([
    ['openai', 'https://api.openai.com/v1/responses'],
    ['deepseek', 'https://api.deepseek.com/chat/completions'],
    ['dashscope', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
    ['glm', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ['claude', 'https://api.anthropic.com/v1/messages'],
    ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
    ['siliconflow', 'https://api.siliconflow.cn/v1/chat/completions'],
  ])('routes %s to its own official service', (provider, expected) => {
    expect(endpointFor(settings(provider), {})).toBe(expected);
  });

  it('preserves the administrator boundary for legacy custom connections', async () => {
    const config = settings('deepseek', { baseUrl: 'https://llm.example.com/v1' });
    const env = { FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://llm.example.com/v1' };
    expect(() => endpointFor(config, {})).toThrow('endpoint_not_allowed');
    expect(endpointFor(config, env)).toBe('https://llm.example.com/v1/chat/completions');
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    expect(await listProviderModels(config, env)).toMatchObject({ mode: 'manual', models: [] });
    expect(transport).not.toHaveBeenCalled();
  });

  it('uses the same DashScope region and workspace validation for directory and chat', async () => {
    expect(endpointFor(settings('dashscope', { region: 'ap-southeast-1', workspace: 'team-a' }), {})).toBe('https://team-a.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    await expect(listProviderModels(settings('dashscope', { region: 'unknown' }))).rejects.toThrow('unsupported_region');
    expect(await listProviderModels(settings('dashscope', { region: 'ap-southeast-1', workspace: 'team-a' }))).toMatchObject({ mode: 'manual' });
    expect(await listProviderModels(settings('glm'))).toMatchObject({ mode: 'manual' });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each<[AiProvider, string, string]>([
    ['azure-openai', 'https://my-resource.openai.azure.com', 'https://my-resource.openai.azure.com/openai/v1/chat/completions'],
    ['azure-openai', 'https://MY-RESOURCE.openai.azure.com:443/openai/v1/', 'https://my-resource.openai.azure.com/openai/v1/chat/completions'],
    ['azure-foundry', 'https://my-resource.services.ai.azure.com/', 'https://my-resource.services.ai.azure.com/openai/v1/chat/completions'],
    ['azure-foundry', 'https://my-resource.services.ai.azure.com/openai/v1', 'https://my-resource.services.ai.azure.com/openai/v1/chat/completions'],
  ])('normalizes the %s resource endpoint without duplicating the v1 path', (provider, azureEndpoint, expected) => {
    expect(endpointFor(settings(provider, { azureEndpoint }), {})).toBe(expected);
  });

  it.each([
    '', 'http://my-resource.openai.azure.com', 'https://openai.azure.com',
    'https://my-resource.openai.azure.com.evil.example', 'https://evil.openai.azure.com@evil.example',
    'https://user:password@my-resource.openai.azure.com', 'https://my-resource.openai.azure.com:444',
    'https://my-resource.openai.azure.com?x=1', 'https://my-resource.openai.azure.com?',
    'https://my-resource.openai.azure.com#fragment', 'https://my-resource.openai.azure.com#',
    'https://my-resource.openai.azure.com/openai/deployments/a',
    'https://my-resource.openai.azure.com/openai/v1/chat/completions',
    'https://my-resource.openai.azure.com/api/projects/example',
    'https://my-resource.openai.azure.com/anything/../openai/v1',
    'https://my-resource.openai.azure.com/%6fpenai/v1',
    'https://my-resource.openai.azure.com\\openai\\v1',
    'https://my-resource.openai.azure.com./', 'https://other.my-resource.openai.azure.com',
    'https://-invalid.openai.azure.com', 'https://127.0.0.1',
    'https://my-resource.services.ai.azure.com',
  ])('rejects an unsafe or mismatched Azure endpoint before sending a key: %s', async azureEndpoint => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    const config = settings('azure-openai', { azureEndpoint });
    expect(() => endpointFor(config, {})).toThrow('endpoint_not_allowed');
    await expect(listProviderModels(config)).rejects.toThrow('endpoint_not_allowed');
    await expect(invokeAi(config, {}, [{ role: 'user', content: 'Reply OK.' }], true)).rejects.toThrow('endpoint_not_allowed');
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not let an Azure custom base URL bypass its resource validation', () => {
    const config = settings('azure-foundry', { azureEndpoint: 'https://my-resource.services.ai.azure.com', baseUrl: 'https://other.example/v1' });
    expect(() => endpointFor(config, { FRONTMIND_SOURCE_MATRIX_ALLOWED_LLM_BASE_URLS: 'https://other.example/v1' })).toThrow('endpoint_not_allowed');
  });
});

describe('AI model directories', () => {
  it('requests SiliconFlow chat models with its key and preserves the platform model IDs', async () => {
    const transport = vi.fn(async () => json({ object: 'list', data: [{ id: 'deepseek-ai/DeepSeek-V4-Flash', object: 'model' }, { id: 'Qwen/Qwen3', object: 'model' }] }));
    vi.stubGlobal('fetch', transport);
    expect(await listProviderModels(settings('siliconflow'))).toMatchObject({ mode: 'listed', models: ['deepseek-ai/DeepSeek-V4-Flash', 'Qwen/Qwen3'], truncated: false });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith('https://api.siliconflow.cn/v1/models?sub_type=chat', expect.objectContaining({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer test-only-key' } }));
  });

  it.each<[AiProvider, string]>([
    ['azure-openai', 'https://my-resource.openai.azure.com'],
    ['azure-foundry', 'https://my-resource.services.ai.azure.com'],
  ])('returns %s model IDs as catalog entries rather than discovered deployments', async (provider, azureEndpoint) => {
    const transport = vi.fn(async () => json({ object: 'list', data: [{ id: 'gpt-4.1', object: 'model', created: 1, owned_by: 'openai' }] }));
    vi.stubGlobal('fetch', transport);
    const result = await listProviderModels(settings(provider, { azureEndpoint }));
    expect(result).toMatchObject({ mode: 'catalog', models: ['gpt-4.1'], truncated: false });
    expect(result.message).toContain('部署');
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith(azureEndpoint + '/openai/v1/models', expect.objectContaining({ method: 'GET', redirect: 'error', headers: { 'api-key': 'test-only-key' } }));
  });

  it('keeps a successful empty directory distinct from a malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ object: 'list', data: [] })));
    expect(await listProviderModels(settings('siliconflow'))).toMatchObject({ mode: 'listed', models: [], truncated: false });
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: null })));
    await expect(listProviderModels(settings('siliconflow'))).rejects.toThrow('provider_invalid_response');
  });

  it.each([[null], [{}], [{ id: '' }]])('does not turn malformed directory entries into a successful empty result', async row => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [row] })));
    await expect(listProviderModels(settings('siliconflow'))).rejects.toThrow('provider_invalid_response');
  });

  it.each<[number, string]>([[401, 'provider_credential_invalid'], [403, 'provider_permission_denied'], [429, 'provider_rate_limited'], [503, 'provider_unavailable']])('preserves HTTP %s failure semantics without returning an empty directory', async (status, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream details must not escape', { status })));
    await expect(listProviderModels(settings('siliconflow'))).rejects.toThrow(expected);
  });

  it('reports a bounded directory and upstream pagination as partial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: Array.from({ length: 101 }, (_, i) => ({ id: 'model-' + i })) })));
    const bounded = await listProviderModels(settings('siliconflow'));
    expect(bounded.models).toHaveLength(100);
    expect(bounded.truncated).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async () => json({ data: [{ id: 'one' }], has_more: true })));
    expect(await listProviderModels(settings('claude'))).toMatchObject({ models: ['one'], truncated: true });
  });

  it('keeps Gemini generation filtering and list authentication', async () => {
    const transport = vi.fn(async () => json({ models: [{ name: 'models/gemini-text', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embedding', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' }));
    vi.stubGlobal('fetch', transport);
    expect(await listProviderModels(settings('gemini'))).toMatchObject({ models: ['gemini-text'], truncated: true });
    expect(transport).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', expect.objectContaining({ headers: { 'x-goog-api-key': 'test-only-key' } }));
  });
});

describe('new AI provider inference', () => {
  it.each([true, false])('keeps SiliconFlow model calls on the same platform (probe=%s)', async test => {
    const transport = vi.fn(async (_url: unknown, _init?: RequestInit) => completion()); vi.stubGlobal('fetch', transport);
    expect(await invokeAi(settings('siliconflow', { model: 'deepseek-ai/DeepSeek-V4-Flash' }), {}, [{ role: 'user', content: 'Reply OK.' }], test)).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledWith('https://api.siliconflow.cn/v1/chat/completions', expect.objectContaining({ redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only-key' } }));
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toMatchObject({ model: 'deepseek-ai/DeepSeek-V4-Flash', max_tokens: test ? 16 : 8192 });
  });

  it.each<[AiProvider, string]>([
    ['azure-openai', 'https://my-resource.openai.azure.com'],
    ['azure-foundry', 'https://my-resource.services.ai.azure.com'],
  ])('sends a deployment name and the v1 token parameter to %s for probe and generation', async (provider, azureEndpoint) => {
    const transport = vi.fn(async (_url: unknown, _init?: RequestInit) => completion()); vi.stubGlobal('fetch', transport);
    const config = settings(provider, { azureEndpoint, model: 'custom-deployment-name' });
    await invokeAi(config, {}, [{ role: 'user', content: 'Reply OK.' }], true);
    await invokeAi(config, {}, [{ role: 'user', content: 'Return JSON.' }]);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const [url, init] of transport.mock.calls) {
      expect(url).toBe(azureEndpoint + '/openai/v1/chat/completions');
      expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'api-key': 'test-only-key' } });
      expect(init!.headers).not.toHaveProperty('Authorization');
      expect(JSON.parse(init!.body as string).model).toBe('custom-deployment-name');
      expect(JSON.parse(init!.body as string)).not.toHaveProperty('max_tokens');
    }
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string).max_completion_tokens).toBe(256);
    expect(JSON.parse(transport.mock.calls[1]![1]!.body as string).max_completion_tokens).toBe(8192);
  });

  it('accepts a metered reasoning probe that exhausted its small budget', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }], usage: { completion_tokens: 256 } })));
    expect(await invokeAi(settings('azure-openai', { azureEndpoint: 'https://my-resource.openai.azure.com' }), {}, [{ role: 'user', content: 'Reply OK.' }], true)).toEqual({ ok: true });
  });

  it('reports an incompatible Foundry model without retrying another token parameter', async () => {
    const transport = vi.fn(async () => json({ error: { code: 'invalid_parameter', message: 'unsupported max_completion_tokens' } }, 400));
    vi.stubGlobal('fetch', transport);
    await expect(invokeAi(settings('azure-foundry', { azureEndpoint: 'https://my-resource.services.ai.azure.com' }), {}, [{ role: 'user', content: 'Reply OK.' }], true)).rejects.toThrow('provider_parameters_invalid');
    expect(transport).toHaveBeenCalledOnce();
  });
});

describe('existing AI provider protocols', () => {
  it.each<[AiProvider, Record<string, string>, Record<string, unknown>, unknown]>([
    ['openai', { Authorization: 'Bearer test-only-key' }, { input: [{ role: 'user', content: 'Reply OK.' }], max_output_tokens: 256 }, { status: 'completed', output_text: 'OK' }],
    ['deepseek', { Authorization: 'Bearer test-only-key' }, { max_tokens: 16 }, { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }],
    ['dashscope', { Authorization: 'Bearer test-only-key', 'X-DashScope-WorkSpace': 'team-a' }, { max_tokens: 16 }, { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }],
    ['glm', { Authorization: 'Bearer test-only-key' }, { max_tokens: 16 }, { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }],
    ['claude', { 'x-api-key': 'test-only-key', 'anthropic-version': '2023-06-01' }, { system: '', max_tokens: 16 }, { content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }],
    ['gemini', { Authorization: 'Bearer test-only-key' }, { max_tokens: 16 }, { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }],
  ])('preserves %s authentication, payload shape and response parsing', async (provider, headers, body, response) => {
    const transport = vi.fn(async (_url: unknown, _init?: RequestInit) => json(response)); vi.stubGlobal('fetch', transport);
    const config = settings(provider, provider === 'dashscope' ? { region: 'ap-southeast-1', workspace: 'team-a' } : {});
    expect(await invokeAi(config, {}, [{ role: 'user', content: 'Reply OK.' }], true)).toEqual({ ok: true });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error', headers });
    expect(JSON.parse(transport.mock.calls[0]![1]!.body as string)).toMatchObject({ model: 'my-deployment', ...body });
  });
});
