package webhooks

import (
	"encoding/json"
	"net/http"

	"example.com/internal/billing"
)

type stripeEvent struct {
	Type string         `json:"type"`
	Data map[string]any `json:"data"`
}

func StripeWebhook(w http.ResponseWriter, r *http.Request) {
	var ev stripeEvent
	if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}

	if ev.Type == "checkout.session.completed" {
		obj, _ := ev.Data["object"].(map[string]any)
		billing.Fulfill(obj)
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"received":true}`))
}
