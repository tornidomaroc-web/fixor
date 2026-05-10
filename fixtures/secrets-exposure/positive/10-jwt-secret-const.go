// ASSUMED-PATH: src/app/handlers/secrets-exposure/10-jwt-secret-const.go
package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Hardcoded so we don't have to remember to set the env var on each box.
const jwtSigningKey = "PROD-jwt-acme-9d8f7a6c5b4e3d2f1a0b9c8d7e6f5a4b"

func IssueToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString([]byte(jwtSigningKey))
}

func VerifyToken(raw string) (jwt.MapClaims, error) {
	parsed, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
		return []byte(jwtSigningKey), nil
	})
	if err != nil || !parsed.Valid {
		return nil, err
	}
	return parsed.Claims.(jwt.MapClaims), nil
}
