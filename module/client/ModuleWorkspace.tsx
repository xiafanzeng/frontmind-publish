import PublishingRoutes from './PublishingRoutes';
import type { PublisherGateway } from './gateway';
/** The host supplies transport and optional workbench integration. */
export default function ModuleWorkspace({gateway}:{gateway:PublisherGateway}) {return <PublishingRoutes gateway={gateway}/>;}
