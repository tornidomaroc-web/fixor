// ASSUMED-PATH: src/app/handlers/admin-check/10-go-rbac-from-db.go
package middleware

import (
	"net/http"

	"example.com/internal/db"
)

type ctxKey string

const userIDKey ctxKey = "user_id"

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := r.Context().Value(userIDKey).(string)
		if !ok {
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}
		role, err := db.QueryRole(r.Context(), userID)
		if err != nil || role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
