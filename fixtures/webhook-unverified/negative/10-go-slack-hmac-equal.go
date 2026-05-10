// ASSUMED-PATH: src/app/handlers/webhook-unverified/10-go-slack-hmac-equal.go
package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
)

func SlackWebhook(w http.ResponseWriter, r *http.Request) {
	ts := r.Header.Get("X-Slack-Request-Timestamp")
	provided := r.Header.Get("X-Slack-Signature")
	body, _ := io.ReadAll(r.Body)

	base := fmt.Sprintf("v0:%s:%s", ts, string(body))
	mac := hmac.New(sha256.New, []byte(os.Getenv("SLACK_SIGNING_SECRET")))
	mac.Write([]byte(base))
	expected := "v0=" + hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(provided), []byte(expected)) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}

	w.WriteHeader(http.StatusOK)
}
