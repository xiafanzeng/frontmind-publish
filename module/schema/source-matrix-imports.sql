-- Apply through the host's reviewed migration workflow. No startup DDL.
CREATE TABLE IF NOT EXISTS publisher_source_matrix_research_imports (
 tenant_id VARCHAR(191) NOT NULL,
 actor_id VARCHAR(80) NOT NULL,
 id VARCHAR(80) NOT NULL,
 name VARCHAR(255) NOT NULL,
 fingerprint VARCHAR(64) NOT NULL,
 status VARCHAR(20) NOT NULL,
 version VARCHAR(80) NOT NULL,
 parsed JSON NOT NULL,
 confirmed JSON NULL,
 metadata JSON NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (tenant_id, actor_id, id),
 INDEX publisher_research_actor_created (tenant_id, actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
