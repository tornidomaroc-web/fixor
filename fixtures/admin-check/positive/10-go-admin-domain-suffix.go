package middleware

import (
	"net/http"
	"strings"
)

const adminDomain = "acme.app"

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		email := r.Header.Get("X-User-Email")
		if !strings.HasSuffix(email, "@"+adminDomain) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
