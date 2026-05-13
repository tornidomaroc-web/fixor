// ASSUMED-PATH: internal/handlers/tickets.go

package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Ticket struct {
	ID        string    `json:"id"`
	Subject   string    `json:"subject"`
	Body      string    `json:"body"`
	Status    string    `json:"status"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
}

type TicketHandler struct {
	DB *sql.DB
}

func (h *TicketHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var t Ticket
	err := h.DB.QueryRowContext(
		r.Context(),
		"SELECT id, subject, body, status, created_by, created_at FROM tickets WHERE id = $1",
		id,
	).Scan(&t.ID, &t.Subject, &t.Body, &t.Status, &t.CreatedBy, &t.CreatedAt)

	if err == sql.ErrNoRows {
		http.Error(w, "ticket not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(t)
}

func (h *TicketHandler) Close(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	_, err := h.DB.ExecContext(
		r.Context(),
		"UPDATE tickets SET status = 'closed', closed_at = NOW() WHERE id = $1",
		id,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
