export type AiProvider='openai'|'deepseek'|'dashscope'|'glm'|'claude'|'gemini'|'siliconflow'|'azure-openai'|'azure-foundry';
export const providerLabels:Record<AiProvider,string>={
 openai:'OpenAI',deepseek:'DeepSeek',dashscope:'通义千问／阿里云百炼',glm:'智谱 GLM',
 claude:'Anthropic Claude',gemini:'Google Gemini',siliconflow:'硅基流动',
 'azure-openai':'Azure OpenAI','azure-foundry':'Microsoft Foundry',
};
export interface SafeConnection {
 id:string;revision:string;name:string;provider:AiProvider;model:string;maskedKey:string;
 region?:string;workspace?:string;azureEndpoint?:string;requiresAdminEndpoint?:boolean;settingsUnavailable?:boolean;
}
export interface ConnectionState {connection:SafeConnection|null;mode:'host'|'user'|'environment'|'none';available:boolean;message?:string}
export function connectionDisplayName(connection:SafeConnection):string {
 const automatic=`${providerLabels[connection.provider]} · ${connection.model}`;
 return !connection.name||connection.name===automatic.slice(0,100)||connection.name===automatic
  ?automatic:`${connection.name} · ${connection.model}`;
}
