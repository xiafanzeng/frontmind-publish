-- Additive module migration; apply through the host migration workflow.
-- The encryption key belongs in the host environment, never this migration.
CREATE TABLE IF NOT EXISTS publisher_source_matrix_connections (
 tenant_id varchar(191) NOT NULL, actor_id varchar(80) NOT NULL,
 id varchar(36) NOT NULL, revision varchar(36) NOT NULL,
 name varchar(100) NOT NULL, provider varchar(24) NOT NULL, model varchar(160) NOT NULL,
 masked_key varchar(24) NOT NULL, ciphertext text NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (tenant_id,actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS publisher_source_matrix_connection_tests (
 tenant_id varchar(191) NOT NULL, actor_id varchar(80) NOT NULL,
 token_hash varchar(64) NOT NULL, ciphertext text NOT NULL,
 expected_revision varchar(36) NULL, expires_at timestamp(3) NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY (tenant_id,actor_id,token_hash),
 KEY publisher_source_matrix_connection_tests_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
