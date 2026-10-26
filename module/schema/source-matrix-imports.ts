import { mysqlTable,varchar,json,timestamp,primaryKey,index } from 'drizzle-orm/mysql-core';
import type { Row } from '../server/source-matrix/common.js';
/** Private import storage, additive migration; never an industry catalog writer. */
export const sourceMatrixResearchImports=mysqlTable('publisher_source_matrix_research_imports',{
 tenantId:varchar('tenant_id',{length:191}).notNull(),actorId:varchar('actor_id',{length:80}).notNull(),id:varchar('id',{length:80}).notNull(),name:varchar('name',{length:255}).notNull(),fingerprint:varchar('fingerprint',{length:64}).notNull(),status:varchar('status',{length:20}).notNull(),version:varchar('version',{length:80}).notNull(),
 /** Parsed original rows, locators and parse errors stay private in this table. */
 parsed:json('parsed').$type<Row>().notNull(),confirmed:json('confirmed').$type<Row>(),metadata:json('metadata').$type<Row>(),createdAt:timestamp('created_at',{fsp:3}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.actorId,t.id]}),index('publisher_research_actor_created').on(t.tenantId,t.actorId,t.createdAt)]);
