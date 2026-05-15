// ASSUMED-PATH: src/app/handlers/auth-bypass/08-go-anon-healthcheck.go
package handlers

import (
	"encoding/json"
	"net/http"
)

func HealthCheck(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("X-User-ID")
	if userID == "" {
		userID = "anonymous"
	}

	resp := map[string]any{
		"status": "ok",
		"caller": userID,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
