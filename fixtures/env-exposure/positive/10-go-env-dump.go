package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
)

func EnvDump(w http.ResponseWriter, r *http.Request) {
	envMap := map[string]string{}
	for _, kv := range os.Environ() {
		i := strings.IndexByte(kv, '=')
		if i < 0 {
			continue
		}
		envMap[kv[:i]] = kv[i+1:]
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(envMap)
}
