# Test Credentials
# Agent writes here when creating/modifying auth credentials (admin accounts, test users).
# Testing agent reads this before auth tests. Fork/continuation agents read on startup.

Auth: Emergent-managed Clerk (email + password only). No roles/admin.
Test user (preview Clerk dev instance): felipe+clerk_test@example.com / Adam-test-12345!
- Clerk bot protection blocks headless sign-in. Use:
  - Backend token: `python /app/scripts_clerk_token.py [email]` -> prints a session JWT (1h). Use as `Authorization: Bearer <jwt>`.
  - UI sign-in: create sign-in ticket via Clerk Backend API POST /v1/sign_in_tokens {user_id} and open `/sign-in?__clerk_ticket=<token>`.
  - +clerk_test emails get verification code 424242.
Adam API keys: created in UI page /api (prefix adam_live_). Use `Authorization: Bearer adam_live_...` on POST /api/v1/chat.
