-- PIM-lite foundation. Application role is created by the migrator before this file runs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  storage_cap_bytes bigint NOT NULL DEFAULT 104857600,
  storage_used_bytes bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  user_id uuid NOT NULL REFERENCES users (id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, id)
);

CREATE TABLE pack_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_key text NOT NULL,
  version int NOT NULL,
  definition jsonb NOT NULL,
  checksum text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_key, version)
);

CREATE TABLE pack_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  pack_key text NOT NULL,
  pack_version int NOT NULL,
  overrides jsonb NOT NULL DEFAULT '[]'::jsonb,
  installed_by uuid REFERENCES users (id),
  installed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, pack_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE attribute_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  data_type text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('style', 'colorway', 'sku')),
  group_key text NOT NULL,
  group_label text NOT NULL,
  sort_order int NOT NULL,
  required boolean NOT NULL DEFAULT false,
  help text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  pack_origin text,
  UNIQUE (catalog_id, key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE picklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  key text NOT NULL,
  version int NOT NULL DEFAULT 1,
  values jsonb NOT NULL,
  UNIQUE (catalog_id, key),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE tax_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  schedule_key text NOT NULL,
  status text NOT NULL,
  effective_from date,
  definition jsonb NOT NULL,
  installed_from_pack text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, schedule_key),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  style_code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  variation_theme text NOT NULL DEFAULT 'SizeColor',
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  schema_version int NOT NULL DEFAULT 1,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, style_code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE INDEX products_tenant_updated_idx ON products (tenant_id, updated_at DESC);

CREATE TABLE product_color_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  product_id uuid NOT NULL,
  color_code text NOT NULL,
  color_name text NOT NULL,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, color_code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id)
);

CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  product_id uuid NOT NULL,
  color_group_id uuid NOT NULL,
  sku text NOT NULL,
  barcode text,
  size text,
  mrp numeric(12, 2),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'archived')),
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_id, sku),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products (tenant_id, id),
  FOREIGN KEY (tenant_id, color_group_id) REFERENCES product_color_groups (tenant_id, id)
);

CREATE INDEX variants_tenant_updated_idx ON variants (tenant_id, updated_at DESC);
CREATE INDEX variants_catalog_status_idx ON variants (catalog_id, status);

CREATE TABLE media_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('style', 'colorway', 'sku')),
  product_id uuid,
  color_group_id uuid,
  variant_id uuid,
  role text NOT NULL CHECK (role IN ('main', 'alternate')),
  source text NOT NULL CHECK (source IN ('url', 'upload')),
  source_url text,
  object_key text,
  delivery_url text,
  content_type text,
  http_status int,
  check_result text NOT NULL DEFAULT 'pending' CHECK (check_result IN ('pending', 'ok', 'failed')),
  check_detail text,
  checked_at timestamptz,
  bytes bigint,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE INDEX media_color_idx ON media_references (color_group_id, role);

CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'uploaded', 'inspecting', 'mapping_required', 'staging', 'validating',
    'review_required', 'committing', 'completed', 'failed', 'cancelled'
  )),
  file_object_key text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL,
  headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode text NOT NULL DEFAULT 'atomic' CHECK (mode IN ('atomic', 'partial')),
  idempotency_key text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  import_job_id uuid NOT NULL,
  row_number int NOT NULL,
  raw jsonb NOT NULL,
  values jsonb NOT NULL,
  action text NOT NULL,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  sku text,
  style_code text,
  UNIQUE (import_job_id, row_number),
  FOREIGN KEY (tenant_id, import_job_id) REFERENCES import_jobs (tenant_id, id)
);

CREATE TABLE channel_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  key text NOT NULL,
  name text NOT NULL,
  format text NOT NULL,
  template_file text,
  spec jsonb NOT NULL,
  UNIQUE (catalog_id, key),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  catalog_id uuid NOT NULL,
  channel_key text NOT NULL,
  status text NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_object_key text,
  receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, catalog_id) REFERENCES catalogs (tenant_id, id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  actor_id uuid,
  request_id text,
  source text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  operation text NOT NULL CHECK (operation IN (
    'create', 'update', 'delete', 'import_commit', 'pack_install', 'pack_upgrade',
    'approve', 'export', 'publish', 'role_change'
  )),
  before jsonb,
  after jsonb,
  delta jsonb,
  job_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_tenant_created_idx ON audit_events (tenant_id, created_at DESC);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  type text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'dead')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  error_summary text,
  idempotency_key text,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  locked_at timestamptz,
  locked_by text,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_claim_idx ON jobs (status, run_after, created_at);
CREATE UNIQUE INDEX jobs_idem_idx ON jobs (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION app_user_by_email(p_email text)
RETURNS TABLE (id uuid, email text, name text, password_hash text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT users.id, users.email, users.name, users.password_hash
  FROM users
  WHERE users.email = lower(p_email)
$$;

CREATE OR REPLACE FUNCTION app_user_by_id(p_id uuid)
RETURNS TABLE (id uuid, email text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT users.id, users.email, users.name FROM users WHERE users.id = p_id
$$;

CREATE OR REPLACE FUNCTION app_insert_user(p_email text, p_name text, p_password_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO users (id, email, name, password_hash)
  VALUES (new_id, lower(p_email), p_name, p_password_hash);
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_is_member(p_tenant uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE tenant_id = p_tenant
      AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND role = ANY (p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION app_can_read(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND app_is_member(p_tenant, ARRAY['owner', 'admin', 'editor', 'reviewer', 'viewer']);
$$;

CREATE OR REPLACE FUNCTION app_can_write_catalog(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND app_is_member(p_tenant, ARRAY['owner', 'admin', 'editor', 'reviewer']);
$$;

CREATE OR REPLACE FUNCTION app_can_admin(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant = NULLIF(current_setting('app.tenant_id', true), '')::uuid
     AND app_is_member(p_tenant, ARRAY['owner', 'admin']);
$$;

CREATE OR REPLACE FUNCTION app_bootstrap_tenant(p_user uuid, p_name text, p_slug text)
RETURNS TABLE (tenant_id uuid, catalog_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_tenant uuid := gen_random_uuid();
  new_catalog uuid := gen_random_uuid();
BEGIN
  INSERT INTO tenants (id, name, slug) VALUES (new_tenant, p_name, p_slug);
  INSERT INTO memberships (tenant_id, user_id, role) VALUES (new_tenant, p_user, 'owner');
  INSERT INTO catalogs (id, tenant_id, name, slug) VALUES (new_catalog, new_tenant, 'Primary', 'primary');
  RETURN QUERY SELECT new_tenant, new_catalog;
END;
$$;

CREATE OR REPLACE FUNCTION app_memberships(p_user uuid)
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  slug text,
  role text,
  catalog_id uuid,
  catalog_name text,
  storage_cap_bytes bigint,
  storage_used_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.tenant_id, t.name, t.slug, m.role, c.id, c.name, t.storage_cap_bytes, t.storage_used_bytes
  FROM memberships m
  JOIN tenants t ON t.id = m.tenant_id
  JOIN catalogs c ON c.tenant_id = t.id
  WHERE m.user_id = p_user
  ORDER BY t.name, c.created_at;
$$;

CREATE OR REPLACE FUNCTION claim_next_job(p_worker text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed jobs%ROWTYPE;
BEGIN
  SELECT * INTO claimed
  FROM jobs
  WHERE status = 'queued' AND run_after <= now()
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  UPDATE jobs
  SET status = 'running',
      locked_at = now(),
      locked_by = p_worker,
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = claimed.id
  RETURNING * INTO claimed;
  RETURN to_jsonb(claimed);
END;
$$;

CREATE OR REPLACE FUNCTION finish_job(p_id uuid, p_status text, p_result jsonb, p_error text, p_delay_seconds int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status = 'retry' THEN
    UPDATE jobs
    SET status = 'queued',
        error_summary = p_error,
        run_after = now() + make_interval(secs => GREATEST(p_delay_seconds, 0)),
        locked_at = NULL,
        updated_at = now()
    WHERE id = p_id AND status = 'running';
  ELSIF p_status = 'dead' THEN
    UPDATE jobs
    SET status = 'dead', error_summary = p_error, result = p_result, locked_at = NULL, updated_at = now()
    WHERE id = p_id;
  ELSE
    UPDATE jobs
    SET status = p_status, result = p_result, error_summary = p_error, locked_at = NULL, updated_at = now()
    WHERE id = p_id;
  END IF;
END;
$$;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogs FORCE ROW LEVEL SECURITY;
ALTER TABLE pack_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_installations FORCE ROW LEVEL SECURITY;
ALTER TABLE attribute_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attribute_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE picklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE picklists FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_schedules FORCE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE product_color_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_color_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants FORCE ROW LEVEL SECURITY;
ALTER TABLE media_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_references FORCE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows FORCE ROW LEVEL SECURITY;
ALTER TABLE channel_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR app_can_admin(tenant_id));
CREATE POLICY memberships_write ON memberships FOR INSERT
  WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));

CREATE POLICY catalogs_select ON catalogs FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY catalogs_write ON catalogs FOR INSERT WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY catalogs_update ON catalogs FOR UPDATE USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));

CREATE POLICY pack_install_select ON pack_installations FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY pack_install_write ON pack_installations FOR INSERT WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY pack_install_update ON pack_installations FOR UPDATE USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));

CREATE POLICY attrs_select ON attribute_definitions FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY attrs_write ON attribute_definitions FOR INSERT WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY attrs_update ON attribute_definitions FOR UPDATE USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY attrs_delete ON attribute_definitions FOR DELETE USING (app_can_admin(tenant_id));

CREATE POLICY picklists_select ON picklists FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY picklists_write ON picklists FOR INSERT WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY picklists_update ON picklists FOR UPDATE USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));

CREATE POLICY tax_select ON tax_schedules FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY tax_write ON tax_schedules FOR INSERT WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY tax_update ON tax_schedules FOR UPDATE USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));

CREATE POLICY products_select ON products FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY products_insert ON products FOR INSERT WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY products_update ON products FOR UPDATE USING (app_can_write_catalog(tenant_id)) WITH CHECK (app_can_write_catalog(tenant_id));

CREATE POLICY colors_select ON product_color_groups FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY colors_insert ON product_color_groups FOR INSERT WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY colors_update ON product_color_groups FOR UPDATE USING (app_can_write_catalog(tenant_id)) WITH CHECK (app_can_write_catalog(tenant_id));

CREATE POLICY variants_select ON variants FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY variants_insert ON variants FOR INSERT WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY variants_update ON variants FOR UPDATE USING (app_can_write_catalog(tenant_id)) WITH CHECK (app_can_write_catalog(tenant_id));

CREATE POLICY media_select ON media_references FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY media_insert ON media_references FOR INSERT WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY media_update ON media_references FOR UPDATE USING (app_can_write_catalog(tenant_id)) WITH CHECK (app_can_write_catalog(tenant_id));

CREATE POLICY imports_select ON import_jobs FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY imports_insert ON import_jobs FOR INSERT WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY imports_update ON import_jobs FOR UPDATE USING (app_can_write_catalog(tenant_id)) WITH CHECK (app_can_write_catalog(tenant_id));

CREATE POLICY import_rows_select ON import_rows FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY import_rows_insert ON import_rows FOR INSERT WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY import_rows_update ON import_rows FOR UPDATE USING (app_can_write_catalog(tenant_id)) WITH CHECK (app_can_write_catalog(tenant_id));
CREATE POLICY import_rows_delete ON import_rows FOR DELETE USING (app_can_write_catalog(tenant_id));

CREATE POLICY channels_select ON channel_profiles FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY channels_insert ON channel_profiles FOR INSERT WITH CHECK (app_can_admin(tenant_id));
CREATE POLICY channels_update ON channel_profiles FOR UPDATE USING (app_can_admin(tenant_id)) WITH CHECK (app_can_admin(tenant_id));

CREATE POLICY exports_select ON export_jobs FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY exports_insert ON export_jobs FOR INSERT WITH CHECK (app_can_read(tenant_id));

CREATE POLICY audit_select ON audit_events FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (app_can_read(tenant_id));

CREATE POLICY jobs_select ON jobs FOR SELECT USING (app_can_read(tenant_id));
CREATE POLICY jobs_insert ON jobs FOR INSERT WITH CHECK (app_can_read(tenant_id));
CREATE POLICY jobs_update ON jobs FOR UPDATE USING (app_can_read(tenant_id)) WITH CHECK (app_can_read(tenant_id));

CREATE OR REPLACE FUNCTION app_add_storage(p_tenant uuid, p_bytes bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_used bigint;
BEGIN
  IF NOT app_is_member(p_tenant, ARRAY['owner', 'admin', 'editor']) THEN
    RAISE EXCEPTION 'storage update is not allowed';
  END IF;
  UPDATE tenants
  SET storage_used_bytes = storage_used_bytes + p_bytes
  WHERE id = p_tenant
    AND storage_used_bytes + p_bytes <= storage_cap_bytes
    AND storage_used_bytes + p_bytes >= 0
  RETURNING storage_used_bytes INTO next_used;
  IF next_used IS NULL THEN
    RAISE EXCEPTION 'storage cap exceeded';
  END IF;
  RETURN next_used;
END;
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_select ON tenants FOR SELECT
  USING (app_is_member(id, ARRAY['owner', 'admin', 'editor', 'reviewer', 'viewer']));

GRANT USAGE ON SCHEMA public TO pim_app;
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pim_app', current_database());
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  memberships, catalogs, pack_installations, attribute_definitions, picklists, tax_schedules,
  products, product_color_groups, variants, media_references, import_jobs, import_rows,
  channel_profiles, export_jobs, jobs
TO pim_app;

GRANT SELECT, INSERT ON audit_events TO pim_app;
GRANT SELECT ON pack_versions, tenants TO pim_app;

GRANT EXECUTE ON FUNCTION app_user_by_email(text) TO pim_app;
GRANT EXECUTE ON FUNCTION app_user_by_id(uuid) TO pim_app;
GRANT EXECUTE ON FUNCTION app_insert_user(text, text, text) TO pim_app;
GRANT EXECUTE ON FUNCTION app_is_member(uuid, text[]) TO pim_app;
GRANT EXECUTE ON FUNCTION app_can_read(uuid) TO pim_app;
GRANT EXECUTE ON FUNCTION app_can_write_catalog(uuid) TO pim_app;
GRANT EXECUTE ON FUNCTION app_can_admin(uuid) TO pim_app;
GRANT EXECUTE ON FUNCTION app_bootstrap_tenant(uuid, text, text) TO pim_app;
GRANT EXECUTE ON FUNCTION app_memberships(uuid) TO pim_app;
GRANT EXECUTE ON FUNCTION claim_next_job(text) TO pim_app;
GRANT EXECUTE ON FUNCTION finish_job(uuid, text, jsonb, text, int) TO pim_app;
GRANT EXECUTE ON FUNCTION app_add_storage(uuid, bigint) TO pim_app;
