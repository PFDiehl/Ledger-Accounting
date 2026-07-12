$env:DATABASE_URL='postgresql://postgres:postgres@localhost:5432/ledger'
$env:JWT_SECRET='ledger-secret-key-change-me-123'
$env:REFRESH_TOKEN_SECRET='ledger-refresh-secret-change-me-456'
$env:FRONTEND_URL='http://localhost:8080'
$env:RATE_LIMIT_MAX='10000'
node src/index.js