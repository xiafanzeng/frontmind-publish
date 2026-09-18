import PublishingRoutes from './PublishingRoutes';
import type { PublisherGateway } from './gateway';
import { StandalonePublishingFlow } from './StandalonePublishingFlow';
/** The host supplies transport and optional workbench integration. */
export default function ModuleWorkspace({gateway,workspaceKey="local-preview"}:{gateway:PublisherGateway;workspaceKey?:string}) {return <StandalonePublishingFlow key={workspaceKey} workspaceKey={workspaceKey}><PublishingRoutes gateway={gateway}/></StandalonePublishingFlow>;}
