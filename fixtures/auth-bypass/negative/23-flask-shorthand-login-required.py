# ASSUMED-PATH: app/views/post_views.py
from flask import Flask, jsonify
from flask_login import current_user, login_required

from app.models import Post, db

app = Flask(__name__)


@app.post("/posts/<int:post_id>/delete")
@login_required
def delete_post(post_id):
    # DISAMBIGUATION ANCHOR: uses the Flask 2.0 @app.post SHORTHAND that is
    # shared with FastAPI, but the file imports flask / flask_login, so the
    # Flask rubric (case 6) applies. @login_required + current_user
    # ownership gates. Must NOT be misjudged by the FastAPI rubric, which
    # would demand a Depends() and wrongly flag this as unguarded.
    post = Post.query.filter_by(id=post_id, user_id=current_user.id).first()
    db.session.delete(post)
    db.session.commit()
    return jsonify({"ok": True})
