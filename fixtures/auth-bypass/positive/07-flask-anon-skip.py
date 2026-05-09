# ASSUMED-PATH: src/app/handlers/auth-bypass/07-flask-anon-skip.py
from flask import Blueprint, request, jsonify, session
from app.db import get_db

bp = Blueprint("notes", __name__)


@bp.delete("/api/notes/<int:note_id>")
def delete_note(note_id: int):
    """Delete a note. Anonymous users are allowed to delete demo notes."""
    user_id = session.get("user_id", "anonymous")

    db = get_db()
    if user_id == "anonymous":
        # Anonymous callers operate on the shared demo workspace.
        db.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    else:
        db.execute(
            "DELETE FROM notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        )
    db.commit()

    return jsonify({"deleted": note_id})
