import { mysqlTable,primaryKey,timestamp,varchar,text } from 'drizzle-orm/mysql-core';

/** One active credential per authenticated actor and tenant. Ciphertext is AES-GCM. */
export const sourceMatrixConnections=mysqlTable('publisher_source_matrix_connections',{
 tenantId:varchar('tenant_id',{length:191}).notNull(),actorId:varchar('actor_id',{length:80}).notNull(),
 id:varchar('id',{length:36}).notNull(),revision:varchar('revision',{length:36}).notNull(),
 name:varchar('name',{length:100}).notNull(),provider:varchar('provider',{length:24}).notNull(),model:varchar('model',{length:160}).notNull(),
 maskedKey:varchar('masked_key',{length:24}).notNull(),ciphertext:text('ciphertext').notNull(),
 createdAt:timestamp('created_at',{fsp:3}).notNull().defaultNow(),updatedAt:timestamp('updated_at',{fsp:3}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.actorId]})]);

/** A successful test is an encrypted, single-use server-side save candidate. */
export const sourceMatrixConnectionTests=mysqlTable('publisher_source_matrix_connection_tests',{
 tenantId:varchar('tenant_id',{length:191}).notNull(),actorId:varchar('actor_id',{length:80}).notNull(),
 tokenHash:varchar('token_hash',{length:64}).notNull(),ciphertext:text('ciphertext').notNull(),
 expectedRevision:varchar('expected_revision',{length:36}),expiresAt:timestamp('expires_at',{fsp:3}).notNull(),
 createdAt:timestamp('created_at',{fsp:3}).notNull().defaultNow(),
},t=>[primaryKey({columns:[t.tenantId,t.actorId,t.tokenHash]})]);
