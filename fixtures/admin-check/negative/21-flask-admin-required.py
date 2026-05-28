# ASSUMED-PATH: app/views/admin_views.py
from flask import Flask, jsonify
from flask_login import login_required

from app.auth.decorators import admin_required
from app.models import User, db

app = Flask(__name__)


@app.route("/admin/users/<int:user_id>", methods=["DELETE"])
@login_required
@admin_required
def admin_delete_user(user_id):
    # Admin op gated by @admin_required (admin-suggesting decorator by name
    # convention) on top of @login_required -> properly authorized.
    User.query.filter_by(id=user_id).delete()
    db.session.commit()
    return jsonify({"deleted": user_id})
