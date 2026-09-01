<p align="center">
  <img src="docs/screenshots/dashboard_top.png" alt="Krypton Dashboard" width="800"/>
</p>

<h1 align="center">🔐 KRYPTON</h1>

<p align="center">
  <strong>A Decentralized, End-to-End Encrypted Messenger & Crypto Wallet</strong>
</p>

<p align="center">
  <em>Built with Next.js • Curve25519 Cryptography • Gun.js P2P Network • Ethers.js</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.3-black?logo=next.js" alt="Next.js"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Encryption-Curve25519-green" alt="Encryption"/>
  <img src="https://img.shields.io/badge/Network-Gun.js%20P2P-orange" alt="Gun.js"/>
  <img src="https://img.shields.io/badge/Web3-Wagmi%20%2B%20Viem-purple" alt="Wagmi"/>
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License"/>
</p>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Screenshots](#-screenshots)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Quality Checks](#-quality-checks)
- [How It Works](#-how-it-works)
  - [Identity & Key Generation](#1-identity--key-generation)
  - [End-to-End Encryption](#2-end-to-end-encryption)
  - [P2P Messaging via Gun.js](#3-p2p-messaging-via-gunjs)
  - [Crypto Wallet Integration](#4-crypto-wallet-integration)
- [Module Deep Dives](#-module-deep-dives)
  - [Encrypted Messenger](#-encrypted-messenger)
  - [Analytics Dashboard](#-analytics-dashboard)
  - [Crypto Wallet](#-crypto-wallet)
  - [Web3 Browser](#-web3-browser)
  - [Contact Management](#-contact-management)
  - [Settings & Identity](#-settings--identity)
- [Security Model](#-security-model)
- [Self-Hosted Gun Relay](#-self-hosted-gun-relay)
- [Environment Variables](#-environment-variables)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌐 Overview

**Krypton** is a fully decentralized, end-to-end encrypted messaging platform combined with a cryptocurrency wallet and a Web3 browser. It is designed as a research-grade demonstration of how modern cryptographic primitives (Curve25519, XSalsa20-Poly1305) can be combined with decentralized peer-to-peer networking (Gun.js) to create a communication system where:

- **No central server** ever sees your messages in plaintext.
- **Your identity IS your public key** — eliminating the entire class of key-pairing bugs that plague traditional E2EE messengers.
- **Crypto transfer notes happen inside chat**, while real Sepolia ETH transfers live in the Wallet page. Onion-routing language in this repo is demo/inspired metadata, not production multi-hop routing.

Krypton draws design inspiration from:

| Project           | What Krypton Borrows                                           |
| ----------------- | -------------------------------------------------------------- |
| **Session**       | Krypton ID format (`05` + hex pubkey), no phone/email required |
| **ADAMANT**       | BIP39 mnemonic-based identity, in-chat crypto transfers        |
| **Signal**        | Curve25519 key exchange, E2EE by default                       |
| **Brave Browser** | Shields UP, tracker blocking, privacy-first Web3 browsing      |
| **Status**        | Ethereum wallet integration, decentralized chat                |

---

## ✨ Key Features

### 🔒 End-to-End Encrypted Messaging

- Every message is encrypted using **Curve25519 + XSalsa20-Poly1305** (via libsodium)
- **Forward-secrecy demo ratchet:** Uses a bounded HKDF-style symmetric ratchet (BLAKE2b) to rotate per-message keys. This is not a production Signal Double Ratchet.
- **Self-Destruct & Encrypted Unsend:** Supports disappearing messages with customizable TTLs and encrypted unsend control messages.
- **Offline Queue:** Spools outgoing messages when the relay is offline and retries on reconnection.
- **PreKey Bundles (X3DH-lite):** Generates and publishes offline PreKey bundles to the Gun network, allowing secure session establishment even if the recipient is offline.
- Zero-knowledge architecture — the relay never sees plaintext
- Krypton ID = Public Key — no separate key exchange step required

### 📊 Real-Time Analytics Dashboard

- **P2P Network Health** — live relay status, peer count over time
- **Messaging Analytics** — volume charts, delivery stats, encryption overhead
- **Portfolio Analytics** — asset allocation donut chart, transfer history
- **Security Stats** — key type, E2EE coverage, pairing failure count
- **Contact Growth** — identity timeline with verified contact list

### 💰 Integrated Crypto Wallet

- Powered by **Wagmi** and **Viem** for robust, SSR-safe connection state
- MetaMask integration for real on-chain balances
- **Real On-Chain Transfers:** Supports broadcasting real Ethereum transactions on the Sepolia Testnet from the Wallet page; chat transfer cards are encrypted notes.
- Encrypted in-chat transfer notes (ADAMANT-inspired demo flow)
- QR code receive address

### 🌐 Brave-Style Web3 Browser

- Multiple tab support with tab management
- "Shields UP" privacy protection with tracker blocking stats
- Secure address bar with HTTPS padlock indicator
- Beautiful privacy-focused start page
- Support for `krypton://` internal protocol

### 👥 Decentralized Contact Management

- Add contacts by pasting Krypton IDs shared from the Settings QR/code block
- Auto-discovery of contacts from incoming messages
- Every contact is cryptographically verified by default

### ⚙️ Identity & Settings

- BIP39 mnemonic generation and backup
- QR code for easy Krypton ID sharing
- Full key information display

---

## 🏗 System Architecture

The following diagram shows how all the components of Krypton interact:

```mermaid
graph TB
    subgraph Client["🖥️ Client (Next.js App)"]
        UI["React UI Layer"]
        Store["Zustand Store<br/>(Modular Slices, Encrypted vault)"]
        Crypto["Crypto Module<br/>(keys.ts, encryption.ts, prekeys.ts)"]
        Network["Network Module<br/>(network.ts → Gun.js)"]
        Dashboard["Dashboard Analytics<br/>(dashboardStats.ts)"]

        UI --> Store
        UI --> Dashboard
        Store --> Crypto
        Store --> Network
        Dashboard --> Store
        Dashboard --> Network
    end

    subgraph Identity["🔑 Identity Layer"]
        BIP39["BIP39 Mnemonic<br/>(12 words)"]
        Curve["Curve25519 Keypair<br/>(NaCl box)"]
        ETH["Ethereum Wallet<br/>(HD derivation)"]
        KID["Krypton ID<br/>'05' + hex(pubkey)"]

        BIP39 --> Curve
        BIP39 --> ETH
        Curve --> KID
    end

    subgraph Encryption["🔐 E2EE Pipeline"]
        Plain["Plaintext Message"]
        Nonce["Random Nonce<br/>(24 bytes)"]
        Ratchet["HKDF Symmetric Ratchet<br/>(BLAKE2b)"]
        SBox["crypto_secretbox_easy<br/>(XSalsa20-Poly1305)"]
        Cipher["Ciphertext<br/>(nonce || encrypted)"]

        Plain --> SBox
        Nonce --> SBox
        Ratchet --> SBox
        SBox --> Cipher
    end

    subgraph P2P["🌐 P2P Network"]
        Gun["Gun.js Instance"]
        Relay["Self-Hosted Relay<br/>(localhost:8765)"]
        Inbox["Gun Node<br/>krypton_inbox_v2_{SHA256}_{YYYY-MM-DD}"]

        Gun --> Relay
        Gun --> Inbox
    end

    subgraph Wallet["💰 Wallet Layer"]
        MM["MetaMask / Injected<br/>(Optional)"]
        Provider["Wagmi / Viem"]
        Balance["On-Chain Balance"]

        MM --> Provider
        Provider --> Balance
    end

    Crypto --> Identity
    Network --> P2P
    Store --> Encryption
    UI --> Wallet

    style Client fill:#161b22,stroke:#58a6ff,color:#c9d1d9
    style Identity fill:#0d1117,stroke:#3fb950,color:#c9d1d9
    style Encryption fill:#0d1117,stroke:#f87171,color:#c9d1d9
    style P2P fill:#0d1117,stroke:#f0883e,color:#c9d1d9
    style Wallet fill:#0d1117,stroke:#d2a8ff,color:#c9d1d9
```

### Data Flow: Sending a Message

```mermaid
sequenceDiagram
    participant Alice as Alice (Sender)
    participant Store as Zustand Store
    participant Crypto as Crypto Module
    participant Gun as Gun.js Relay
    participant Bob as Bob (Receiver)

    Alice->>Store: addMessage(plaintext)
    Store->>Crypto: encryptForContact(msg, alicePrivKey, bobPubKey)
    Crypto-->>Store: ciphertext (base64)
    Store->>Gun: sendToNetwork(bobKryptonId, ciphertext)
    Gun->>Gun: Store in krypton_inbox_{bobId}

    Note over Gun: P2P relay propagates data

    Gun->>Bob: subscribeToInbox callback fires
    Bob->>Crypto: decryptFromContact(ciphertext, bobPrivKey, alicePubKey)
    Crypto-->>Bob: plaintext message
    Bob->>Store: addMessage(decrypted)
```

### Key Architecture Decisions

| Decision                               | Rationale                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Krypton ID = Public Key**            | Eliminates key-pairing bugs entirely. The identity string itself IS the encryption key — no separate "public key" field to go stale or get mismatched. |
| **Gun.js for P2P**                     | Decentralized, no central server dependency. Supports store-and-forward with self-hosted relays.                                                       |
| **Zustand Slice Architecture** | The monolithic store is divided into `CryptoSlice`, `NetworkSlice`, `MessageSlice`, and `WalletSlice`, making it highly maintainable while keeping the encrypted local vault persistence. |
| **Separate chat identity from wallet** | MetaMask connecting/switching only updates the linked wallet via Wagmi hooks. Chat identity (Krypton ID) never changes, preventing resubscription bugs.                |
| **Self-hosted relay**                  | Public Gun relays are unreliable. A dedicated relay ensures message delivery and provides a viva-ready talking point about network infrastructure.     |

---

## 📸 Screenshots

### Encrypted Messenger

Real-time E2E encrypted chat with demo routing metadata, encryption hash display, self-destruct timers, unsend tombstones, and encrypted transfer-note cards.

![Encrypted Messenger](docs/screenshots/chat.png)

---

### Analytics Dashboard — Network Health

Live P2P relay status indicators, active peer count over time, and top-level stat cards.

![Dashboard — P2P Network Health](docs/screenshots/dashboard_top.png)

---

### Analytics Dashboard — Messaging & Portfolio

Message volume charts (sent vs received), most active contacts, delivery stats, asset allocation donut chart, and encrypted in-chat transfer-note history.

![Dashboard — Messaging & Portfolio Analytics](docs/screenshots/dashboard_mid.png)

---

### Analytics Dashboard — Security & Contacts

Cryptographic key information, E2EE coverage invariant, pairing failure count, contact list with verification status, and contact growth chart.

![Dashboard — Security & Contact Growth](docs/screenshots/dashboard_bottom.png)

---

### Crypto Wallet

BIP39-derived Ethereum wallet with MetaMask integration, send/receive modals, QR code, and AI portfolio analyzer.

![Crypto Wallet](docs/screenshots/wallet.png)

---

### Web3 Browser

Brave-style decentralized browser with multiple tabs, Shields UP privacy protection, tracker blocking stats, and a beautiful start page.

![Web3 Browser](docs/screenshots/browser.png)

---

### Settings & Identity

Krypton ID display with QR code for sharing, BIP39 mnemonic backup, and key information.

![Settings](docs/screenshots/settings.png)

---

### Contact Management

Add contacts by pasting Krypton IDs shared from Settings. All contacts are cryptographically verified by default since ID = Key.

![Contacts](docs/screenshots/contacts.png)

---

## 🛠 Technology Stack

| Layer                  | Technology                              | Purpose                                                               |
| ---------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| **Frontend Framework** | Next.js 16.3 (App Router)               | Server/client rendering, routing, API routes                          |
| **Language**           | TypeScript 5.x                          | Type safety across the entire codebase                                |
| **State Management**   | Zustand 5.x                             | Slice architecture with encrypted local vault persistence              |
| **Styling**            | Tailwind CSS 4.x                        | Utility-first CSS with glassmorphism design system                    |
| **Encryption**         | libsodium-wrappers + tweetnacl          | Curve25519 key exchange, XSalsa20-Poly1305 authenticated encryption, X3DH-lite PreKeys |
| **P2P Networking**     | Gun.js                                  | Decentralized data sync, daily time-bucketed inboxes, privacy hashing |
| **Web3 / Blockchain**  | Wagmi + Viem + TanStack Query           | Robust SSR-safe Ethereum wallet connection, contract interaction      |
| **Key Derivation**     | @scure/bip39 + ethers Wallet.fromPhrase | BIP39 mnemonic generation, deterministic identity and wallet recovery |
| **Charts**             | Recharts                                | AreaChart, BarChart, PieChart for the analytics dashboard             |
| **QR Codes**           | qrcode.react                            | QR code generation for Krypton ID and wallet address sharing          |
| **Validation**         | Zod 4.x                                 | Runtime schema validation for wallet assets and addresses             |

---

## 📁 Project Structure

```
krypton-app/
├── public/                          # Static assets
├── docs/
│   └── screenshots/                 # App screenshots for README
├── relay.js                         # Self-hosted Gun.js relay server
├── src/
│   ├── app/                         # Next.js App Router pages
│   │   ├── layout.tsx               # Root layout with Sidebar
│   │   ├── page.tsx                 # Home page (redirects to /chat)
│   │   ├── globals.css              # Global styles & design tokens
│   │   ├── api/
│   │   │   └── ai/
│   │   │       └── route.ts         # AI assistant API route (OpenRouter)
│   │   ├── chat/
│   │   │   └── page.tsx             # Messenger page
│   │   ├── dashboard/
│   │   │   └── page.tsx             # Analytics dashboard page
│   │   ├── contacts/
│   │   │   └── page.tsx             # Contact management page
│   │   ├── wallet/
│   │   │   └── page.tsx             # Crypto wallet page
│   │   ├── browser/
│   │   │   └── page.tsx             # Web3 browser page
│   │   └── settings/
│   │       └── page.tsx             # Identity & settings page
│   │
│   ├── components/                  # React components
│   │   ├── ChatWindow.tsx           # E2E encrypted messenger UI
│   │   ├── Dashboard.tsx            # Full analytics dashboard (5 sections)
│   │   ├── Sidebar.tsx              # Navigation sidebar
│   │   ├── WalletDashboard.tsx      # Crypto wallet UI
│   │   ├── WalletProvider.tsx       # MetaMask/ethers.js provider context
│   │   └── Web3Browser.tsx          # Brave-style Web3 browser with tabs
│   │
│   ├── crypto/                      # Cryptography & networking
│   │   ├── keys.ts                  # BIP39 → Curve25519 + ETH key generation
│   │   ├── encryption.ts            # E2EE encrypt/decrypt (libsodium)
│   │   └── network.ts               # Gun.js P2P relay + peer event system
│   │
│   ├── store/                       # State management (Zustand)
│   │   ├── useKryptonStore.ts       # Main store combining slices
│   │   ├── slices/                  # Modular state slices (Crypto, Network, Message, Wallet)
│   │   └── dashboardStats.ts        # Analytics computation utilities
│   │
│   └── types/                       # TypeScript type definitions
│       └── index.ts                 # Message, Contact, Wallet types + Zod schemas
│
├── package.json
├── tsconfig.json
├── next.config.ts
└── README.md                        # ← You are here
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 20.9.0
- **npm** ≥ 10.x
- A modern browser (Chrome, Edge, Firefox, Brave)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/krypton-app.git
cd krypton-app

# 2. Install dependencies
npm install

# 3. Start the self-hosted Gun relay (in a separate terminal)
npm run relay
# Output: Gun relay running on http://localhost:8765/gun

# 4. Start the development server
npm run dev
# Output: Ready on http://localhost:3000
```

### First-Time Setup

1. **Open the app** at `http://localhost:3000`
2. **A fresh Krypton identity is auto-generated** (BIP39 mnemonic + Curve25519 keys)
3. **Go to Settings** to see your Krypton ID and QR code
4. **To test messaging between two users:**
   - Open a second browser window (or Incognito/Private mode)
   - Clear localStorage if you have old data: DevTools → Application → Local Storage → Clear
   - Each instance gets its own unique identity
   - Copy each other's Krypton ID from Settings
   - Add each other as contacts in the Contacts section
   - Start sending encrypted messages!

> **⚠️ Important:** If you have old localStorage data from a previous version, delete it first. Old identities may not have the `kryptonId` field and will break the app.

---

## ✅ Quality Checks

```bash
npm run typecheck  # TypeScript strict mode
npm run lint       # Next.js + TypeScript ESLint
npm run test       # Vitest unit tests for crypto/vault/stats
npm run build      # Production build
```

GitHub Actions runs the same checks on pushes and pull requests.

---

## ⚙️ How It Works

### 1. Identity & Key Generation

When you first open Krypton, a new identity is generated automatically:

```
BIP39 Mnemonic (12 words)
    │
    ├──→ Seed (64 bytes)
    │       │
    │       ├──→ First 32 bytes → Curve25519 Keypair (NaCl box)
    │       │       │
    │       │       ├──→ Public Key  → Krypton ID: "05" + hex(publicKey)
    │       │       └──→ Private Key → Stored in the PIN-encrypted local vault
    │       │
    │       └──→ HD Derivation (BIP44) → Ethereum Wallet
    │               │
    │               ├──→ ETH Address (for crypto transfers)
    │               └──→ Private Key (for signing transactions)
    │
    └──→ Mnemonic is displayed in Settings for backup
```

**Key insight:** The Krypton ID (`05` + hex-encoded public key) IS the user's identity AND their encryption key. There is no separate "public key" field — this eliminates the entire class of key-pairing bugs found in traditional E2EE systems.

### 2. End-to-End Encryption

Every message goes through this encryption pipeline:

```typescript
// Encryption (sender side)
const nonce = sodium.randombytes_buf(24); // Random 24-byte nonce
const ciphertext = sodium.crypto_box_easy(
  // XSalsa20-Poly1305
  plaintext, // Your message
  nonce, // Unique per message
  recipientPublicKey, // Derived from their Krypton ID
  senderPrivateKey // Your secret key
);
// Result: base64(nonce || ciphertext)

// Decryption (receiver side)
const plaintext = sodium.crypto_box_open_easy(
  ciphertext,
  nonce,
  senderPublicKey, // Derived from sender's Krypton ID
  recipientPrivateKey // Your secret key
);
```

The encryption algorithm used is **NaCl `crypto_box`**, which provides:

- **Confidentiality** via XSalsa20 stream cipher
- **Authentication** via Poly1305 MAC
- **Key exchange** via Curve25519 ECDH

### 3. P2P Messaging via Gun.js

Messages are routed through a decentralized Gun.js peer-to-peer network:

```
Sender                    Gun.js Relay                  Receiver
  │                           │                            │
  │  sendToNetwork()          │                            │
  ├──────────────────────────→│                            │
  │  gun.get(inbox).set(msg)  │                            │
  │                           │  subscribeToInbox()        │
  │                           │←───────────────────────────┤
  │                           │  gun.get(inbox).map().on() │
  │                           │                            │
  │                           │  New data event            │
  │                           ├───────────────────────────→│
  │                           │                            │  decrypt & display
```

Each user has daily-bucketed "inbox" nodes in the Gun graph (e.g., `krypton_inbox_v2_<SHA256>_2026-09-01`). This time-bucketing prevents unbounded node growth, while the SHA-256 hash obscures the recipient's identity from network observers. When you send a message, it's written to the recipient's active bucket. The recipient's subscription fires and decrypts it locally.

### 4. Crypto Wallet Integration

The wallet system is **completely decoupled** from chat identity:

| Aspect          | Chat Identity                | Wallet                                        |
| --------------- | ---------------------------- | --------------------------------------------- |
| **Key source**  | Curve25519 from BIP39 seed   | HD derivation from same mnemonic              |
| **ID format**   | `05` + hex(pubkey)           | `0x` + ETH address                            |
| **Can change?** | Never                        | Yes (MetaMask override)                       |
| **Used for**    | Message routing & encryption | Wallet transfers and encrypted transfer notes |

MetaMask connecting only updates the displayed wallet address — it **never** touches the Krypton ID or resubscribes the chat inbox.

---

## 📦 Module Deep Dives

### 💬 Encrypted Messenger

**File:** `src/components/ChatWindow.tsx`

The messenger provides:

- **Contact sidebar** with real-time last-message timestamps
- **E2E encrypted message display** with encryption hash preview
- **Encrypted transfer-note cards** — record private KRYP-style transfer notes in conversations
- **AI assistant** — optional cloud-assisted Krypton AI contact for crypto/security questions (via OpenRouter API; not E2EE-private)
- **Typing indicators** with animated dots
- **Auto-scroll** to newest messages

Each message displays:

- 🔒 Encrypted hash (first 16 chars of ciphertext)
- Decrypted plaintext content
- Timestamp
- Delivery checkmark (for sent messages)

### 📊 Analytics Dashboard

**Files:** `src/components/Dashboard.tsx`, `src/store/dashboardStats.ts`

Five comprehensive analytics sections, all computed from live store data:

#### Section 1: P2P Network Health

- **Live relay peer status** — green/red indicator per peer URL, driven by `gun.on('hi'/'bye')` events
- **Active peer count over time** — area chart tracking connections
- **Messages relayed count** and **last sync timestamp**

#### Section 2: Messaging Analytics

- **Message volume bar chart** — sent vs received, bucketed by day
- **Most active contacts** — ranked with progress bars
- **Delivery success/failure counts**
- **E2EE overhead ratio** — ciphertext size ÷ plaintext size (demonstrates encryption cost)

#### Section 3: Portfolio Analytics

- **Asset allocation donut chart** — ETH, KRYP, USDC in USD value
- **In-chat transfer-note history** — aggregated from `isCryptoTransfer` messages

#### Section 4: Security & Cryptography

- **Key type**: Curve25519 (NaCl box XSalsa20-Poly1305)
- **Identity age**: Time since key generation
- **E2EE coverage**: 100% — demonstrated invariant
- **Pairing failures**: 0 — evidence that ID=Key eliminates mismatches
- **Full Krypton ID display** (selectable for copy)

#### Section 5: Identity & Contact Growth

- **Current contacts** with verified status badges
- **Contact growth area chart** over time

### 💰 Crypto Wallet

**Files:** `src/components/WalletDashboard.tsx`, `src/components/WalletProvider.tsx`

- **Powered by Wagmi & Viem** — robust hooks for connection state and sending transactions
- **MetaMask integration** — connect to override wallet address and fetch real on-chain balance
- **Send modal** — enter recipient address and amount
- **Receive modal** — displays your address as a QR code
- **AI Portfolio Analyzer** — optionally sends portfolio data to the configured AI provider for a brief analysis
- **RPC error handling** — graceful fallback when MetaMask points to an offline network

### 🌐 Web3 Browser

**File:** `src/components/Web3Browser.tsx`

A Brave-inspired secure browser with:

- **Multiple tabs** — open, close, and switch between tabs
- **New Tab start page** (`krypton://newtab`) showing:
  - Total trackers blocked
  - Bandwidth saved
  - Time saved
  - Quick links to DEX, NFTs, Social, DAOs
- **Shields UP** — click the shield icon to see/toggle privacy protection:
  - Per-site tracker blocking count
  - Toggle on/off with switch UI
- **Secure address bar**:
  - 🔒 Padlock for HTTPS sites
  - Auto-prepends `https://` for bare domains
  - Loading spinner during navigation
- **Sandboxed iframe** for website rendering

### 👥 Contact Management

**File:** `src/app/contacts/page.tsx`

- **Add by Krypton ID** — paste a valid `05`-prefixed public key
- **Auto-discovery** — incoming messages from unknown senders automatically create contacts
- **Contact list** with avatar, name, truncated ID
- **Remove contacts** with confirmation
- **Every contact is verified** — because the Krypton ID IS the public key, there's no separate verification step

### ⚙️ Settings & Identity

**File:** `src/app/settings/page.tsx`

- **Krypton ID** displayed with copy button
- **QR code** for easy ID sharing (scan from another device)
- **BIP39 mnemonic** displayed for backup (with security warning)
- **Key type and algorithm information**

---

## 🛡 Security Model

### What Krypton Protects Against

| Threat                          | Protection                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Message interception**        | All messages encrypted with Curve25519 + XSalsa20-Poly1305 before leaving the client                                                         |
| **Relay eavesdropping**         | The Gun relay only sees ciphertext — never plaintext                                                                                         |
| **Key-pairing attacks**         | Krypton ID = Public Key — impossible to associate wrong key with wrong identity                                                              |
| **Identity spoofing**           | Each message can be verified against the sender's Krypton ID (their public key)                                                              |
| **Basic metadata minimization** | Message bodies are encrypted; sender/recipient inbox IDs remain visible to the relay. Route paths are demo metadata, not real onion routing. |

### What Krypton Does NOT Protect Against (Honest Limitations)

| Limitation                       | Explanation                                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Traffic analysis**             | An observer can see that two Krypton IDs are communicating, even though message content is hidden.                                                                                                      |
| **Client compromise / weak PIN** | LocalStorage is encrypted, but malware, an unlocked browser session, devtools access, or a weak PIN can still expose keys and decrypted messages.                                                       |
| **Forward secrecy limits**       | The current symmetric ratchet is educational and derived from static identity-key ECDH. It is not equivalent to Signal's X3DH/PQXDH + Double Ratchet and should not be treated as production-grade PFS. |

### Cryptographic Primitives Used

| Primitive            | Algorithm                             | Library                             | Purpose                                                                              |
| -------------------- | ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| Key Exchange         | Curve25519 ECDH                       | tweetnacl / libsodium               | Shared secret derivation                                                             |
| Demo Ratchet         | BLAKE2b key derivation                | libsodium (`crypto_generichash`)    | Derives unique per-message symmetric keys; not a full Double Ratchet                 |
| Symmetric Encryption | XSalsa20                              | libsodium (`crypto_secretbox_easy`) | Message confidentiality                                                              |
| Authentication       | Poly1305 MAC                          | libsodium (`crypto_box_easy`)       | Message integrity                                                                    |
| Nonce                | 24-byte random                        | libsodium (`randombytes_buf`)       | Prevents nonce reuse; replay handling is enforced by message IDs and envelope checks |
| Key Derivation       | BIP39 + deterministic seed derivation | @scure/bip39 + ethers               | Deterministic identity and wallet recovery from mnemonic                             |
| Wallet Derivation    | BIP44 HD path                         | ethers.js `Wallet.fromPhrase`       | Ethereum address from mnemonic                                                       |

---

## 🔌 Self-Hosted Gun Relay

Krypton uses a self-hosted Gun.js relay for reliable message delivery. Public Gun relays are often unreliable and may go offline without notice.

### Running the Relay

```bash
# Start the relay (from the krypton-app directory)
npm run relay
```

This starts a minimal Gun relay on `http://localhost:8765/gun`.

### How the Relay Works

`relay.js` starts a small Gun relay with:

- WebSocket endpoint: `/gun`
- Health endpoint: `/health`
- Optional Radisk persistence under `GUN_DATA_DIR` (defaults to `radata`)
- CORS configured by `RELAY_CORS_ORIGIN` (defaults to `*` for easy local/device testing)

The relay:

1. Accepts WebSocket connections from Gun.js clients
2. Syncs data between connected peers
3. Provides best-effort store-and-forward behavior when Radisk persistence is enabled

### Changing the Relay URL

To point the browser client to one or more deployed relays:

```bash
# .env.local
NEXT_PUBLIC_GUN_PEERS=https://your-relay.onrender.com/gun,https://backup-relay.example.com/gun
```

---

## 🔐 Environment Variables

Create a `.env.local` file in the project root or copy the template:

```bash
cp .env.example .env.local
```

Common variables:

```bash
# Optional: enables the Krypton AI assistant feature.
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct
OPENROUTER_HTTP_REFERER=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Comma-separated Gun relay peers.
NEXT_PUBLIC_GUN_PEERS=http://localhost:8765/gun

# Optional Sepolia RPC suggested to MetaMask.
NEXT_PUBLIC_SEPOLIA_RPC_URL=https://rpc.sepolia.org
```

> **Note:** The AI assistant is optional and not a private E2EE conversation: prompts are sent to the configured AI provider. The rest of the app works without it.

---

## 🤝 Contributing

Contributions are welcome! Here are some areas where help is needed:

### Priority: High

- [ ] **Audited Double Ratchet** — replace the demo ratchet with X3DH/PQXDH + Double Ratchet or an audited libsignal-style implementation
- [ ] **Message deletion** — ability to delete messages from the Gun graph
- [ ] **Offline queue** — queue messages locally when the relay is unreachable

### Priority: Medium

- [ ] **Group chats** — multi-party encrypted messaging
- [ ] **File attachments** — encrypted file transfer via the P2P network
- [ ] **Push notifications** — browser notifications for new messages
- [ ] **ENS resolution** — resolve `.eth` names in the Web3 browser

### Priority: Low

- [ ] **Theme customization** — user-selectable color themes
- [ ] **Message search** — full-text search across decrypted messages
- [ ] **Contact nicknames** — editable display names for contacts

### Development Workflow

```bash
# Install dependencies
npm install

# Start relay + dev server
npm run relay &
npm run dev

# Format check, typecheck, lint, test, and build
npm run ci

# Or run each quality gate separately
npm run typecheck
npm run lint
npm run test
npm run build
```

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>Built with 🔐 by the Krypton Team</strong>
  <br/>
  <em>Decentralized • End-to-End Encrypted • Open Source</em>
</p>
