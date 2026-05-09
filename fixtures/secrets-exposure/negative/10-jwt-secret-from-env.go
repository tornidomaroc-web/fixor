// ASSUMED-PATH: src/app/handlers/secrets-exposure/10-jwt-secret-from-env.go
package auth

import (
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var jwtSigningKey []byte

func init() {
	v := os.Getenv("JWT_SIGNING_KEY")
	if v == "" {
		panic("JWT_SIGNING_KEY not set")
	}
	jwtSigningKey = []byte(v)
}

func IssueToken(userID string) (string, error) {
	claims := jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(jwtSigningKey)
}

func VerifyToken(raw string) (jwt.MapClaims, error) {
	parsed, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
		return jwtSigningKey, nil
	})
	if err != nil || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return parsed.Claims.(jwt.MapClaims), nil
}
