export type AiProvider='openai'|'deepseek'|'dashscope'|'glm'|'claude'|'gemini';
export interface SafeConnection {id:string;revision:string;name:string;provider:AiProvider;model:string;maskedKey:string}
export interface ConnectionState {connection:SafeConnection|null;mode:'host'|'user'|'environment'|'none';available:boolean;message?:string}
