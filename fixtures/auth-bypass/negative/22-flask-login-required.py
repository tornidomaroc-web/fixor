# ASSUMED-PATH: app/views/account_views.py
from flask import Flask, jsonify
from flask_login import current_user, login_required

from app.models import db

app = Flask(__name__)


@app.route("/account/delete", methods=["POST"])
@login_required
def delete_account():
    # Gated by @login_required (flask_login); operates on the
    # authenticated current_user's own account.
    db.session.delete(current_user)
    db.session.commit()
    return jsonify({"ok": True})
