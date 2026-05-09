package handlers

import (
	"encoding/json"
	"net/http"
	"os"
)

var safeKeys = []string{"AWS_REGION", "APP_VERSION", "NODE_ROLE"}

func PublicEnv(w http.ResponseWriter, r *http.Request) {
	out := map[string]string{}
	for _, k := range safeKeys {
		if v := os.Getenv(k); v != "" {
			out[k] = v
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}
