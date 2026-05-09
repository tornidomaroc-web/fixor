package handlers

import (
	"encoding/json"
	"net/http"

	"example.com/internal/db"
)

func DeleteWorkspace(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		userID = "anonymous"
	}

	workspaceID := r.URL.Query().Get("id")

	if userID == "anonymous" {
		_, _ = db.Exec("DELETE FROM workspaces WHERE id = $1", workspaceID)
	} else {
		_, _ = db.Exec(
			"DELETE FROM workspaces WHERE id = $1 AND owner_id = $2",
			workspaceID, userID,
		)
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
