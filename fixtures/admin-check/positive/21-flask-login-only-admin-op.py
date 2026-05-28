# ASSUMED-PATH: app/views/admin_views.py
from flask import Flask, jsonify
from flask_login import login_required

from app.models import User, db

app = Flask(__name__)


@app.route("/admin/users/<int:user_id>", methods=["DELETE"])
@login_required
def admin_delete_user(user_id):
    # Admin op (delete ANY user) guarded ONLY by @login_required
    # (authenticated, NOT admin). No @admin_required, no current_user.
    # is_admin / role check. Any logged-in non-admin user can delete any
    # account. Flask looks-guarding-but-isn't adversarial.
    User.query.filter_by(id=user_id).delete()
    db.session.commit()
    return jsonify({"deleted": user_id})
