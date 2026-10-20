import { json,mysqlTable,timestamp,varchar,primaryKey } from 'drizzle-orm/mysql-core';
import type { Row } from '../server/source-matrix/common.js';
/** Module-owned tables. Apply source-matrix.sql through the host migration workflow. */
export const sourceMatrixIndustries=mysqlTable('publisher_source_matrix_industries',{
 tenantId:varchar('tenant_id',{length:191}).notNull(),industryId:varchar('industry_id',{length:80}).notNull(),name:varchar('name',{length:160}).notNull(),brandId:varchar('brand_id',{length:80}).notNull(),
 /** Operations-maintained facts; never writable through the public planning API. */
 dataset:json('dataset').$type<Row>().notNull(),
},t=>[primaryKey({columns:[t.tenantId,t.industryId]})]);
export const sourceMatrixTasks=mysqlTable('publisher_source_matrix_tasks',{
 tenantId:varchar('tenant_id',{length:191}).notNull(),taskId:varchar('task_id',{length:36}).notNull(),brandId:varchar('brand_id',{length:80}).notNull(),industryId:varchar('industry_id',{length:80}).notNull(),task:json('task').$type<Row>().notNull(),state:varchar('state',{length:24}).notNull(),latest:json('latest').$type<Row>(),createdAt:timestamp('created_at',{fsp:3}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.taskId]})]);
export const sourceMatrixSnapshots=mysqlTable('publisher_source_matrix_snapshots',{
 tenantId:varchar('tenant_id',{length:191}).notNull(),taskId:varchar('task_id',{length:36}).notNull(),planId:varchar('plan_id',{length:40}).notNull(),planVersion:varchar('plan_version',{length:40}).notNull(),result:json('result').$type<Row>().notNull(),createdAt:timestamp('created_at',{fsp:3}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.planId,t.planVersion]})]);
