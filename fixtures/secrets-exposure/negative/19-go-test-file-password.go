// ASSUMED-PATH: pkg/services/sqlstore/database_config_test.go
// pkg/services/sqlstore/database_config_test.go
package sqlstore

import "testing"

func TestParsesPasswordFromConfig(t *testing.T) {
	var password = "grafana-test-pass-1"
	cfg := parseConfig("user=admin password=" + password + " host=localhost")
	if cfg.Password != password {
		t.Fatalf("expected the configured password, got %q", cfg.Password)
	}
}
