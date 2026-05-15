ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY projects_owner_select ON projects
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY projects_owner_update ON projects
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY projects_owner_insert ON projects
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
