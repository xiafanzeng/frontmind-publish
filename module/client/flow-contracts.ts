/** Optional main-workbench connections, independent of login/tenant machinery. */
export type BusinessWorkspaceOutput = {id:string;title:string;description?:string;type?:string;version?:string|number;status?:string;source?:string;pendingChanges?:boolean;onOpen?:()=>void;onRevise?:()=>void};
export type WorkbenchOutputRef = {resource:{kind:'article'|'article_version'|'publication_draft'|'publication_batch';id:string;label?:string};version?:string;sourceStepId:string;sourceMessageId?:string};
export type WorkbenchTaskState = {resources:Array<{kind:string;id:string;label?:string}>;step:string;values:Record<string,unknown>;records:Array<{id:string;label:string;status:'completed'|'failed'|'pending';detail?:string;timestamp:number;targetTask?:{conversationId:string;agentId:string}}>};
