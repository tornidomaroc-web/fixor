# db/migrate/20251201_seed_admin_account.rb
# One-shot migration. Runs once at deploy and never again.
class SeedAdminAccount < ActiveRecord::Migration[7.1]
  ADMIN_EMAILS = ['founder@acme.test'].freeze

  def up
    ADMIN_EMAILS.each do |email|
      user = User.find_or_create_by!(email: email)
      user.update!(role: 'admin')
    end
  end

  def down
    ADMIN_EMAILS.each do |email|
      User.find_by(email: email)&.update(role: 'member')
    end
  end
end
