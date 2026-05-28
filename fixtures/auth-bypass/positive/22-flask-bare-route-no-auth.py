# ASSUMED-PATH: app/views/admin_views.py
from flask import Flask, jsonify

from app.models import User, db

app = Flask(__name__)


@app.route("/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    # Bare Flask route performing a destructive op. No @login_required, no
    # current_user / g.user / session auth check anywhere. Any caller can
    # delete any user. Imports show Flask (-> Flask rubric, case 6).
    db.session.query(User).filter_by(id=user_id).delete()
    db.session.commit()
    return jsonify({"deleted": user_id})
