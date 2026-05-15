ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY notes_owner_select ON notes
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY notes_owner_update ON notes
  FOR UPDATE
  USING (user_id = current_setting('app.current_user_id')::uuid);

CREATE POLICY notes_owner_delete ON notes
  FOR DELETE
  USING (user_id = current_setting('app.current_user_id')::uuid);
