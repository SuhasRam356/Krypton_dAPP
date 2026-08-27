# Security Policy

Krypton is currently a research/demo dApp. Do not use it to protect high-value production secrets until the cryptographic protocol has received independent review.

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories for this repository. If advisories are unavailable, open a minimal public issue that does not include exploit details and ask the maintainer to enable private disclosure.

## Current security boundaries

- Messages are encrypted client-side before being written to Gun.
- Local state is encrypted at rest with a PIN-derived vault key.
- The current ratchet is a symmetric demo ratchet derived from static ECDH keys; it is not a full Signal Double Ratchet implementation.
- The AI assistant is optional and sends prompts to the configured AI provider; do not treat AI conversations as private E2EE conversations.
