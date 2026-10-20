-- Additive module migration; reviewed/applied by the host, never auto-run by HTTP.
CREATE TABLE IF NOT EXISTS publisher_source_matrix_industries (
 tenant_id varchar(191) NOT NULL, industry_id varchar(80) NOT NULL,
 name varchar(160) NOT NULL, brand_id varchar(80) NOT NULL, dataset json NOT NULL,
 PRIMARY KEY (tenant_id, industry_id)
);
CREATE TABLE IF NOT EXISTS publisher_source_matrix_tasks (
 tenant_id varchar(191) NOT NULL, task_id varchar(36) NOT NULL,
 brand_id varchar(80) NOT NULL, industry_id varchar(80) NOT NULL,
 task json NOT NULL, state varchar(24) NOT NULL, latest json NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (tenant_id, task_id)
);
CREATE TABLE IF NOT EXISTS publisher_source_matrix_snapshots (
 tenant_id varchar(191) NOT NULL, task_id varchar(36) NOT NULL,
 plan_id varchar(40) NOT NULL, plan_version varchar(40) NOT NULL,
 result json NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (tenant_id, plan_id, plan_version)
);
