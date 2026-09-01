# Agentic AI Reference Guide

This document serves as a reference for building Agentic AI features into the application, drawing inspiration from platforms like OpenMAIC.

## Core Features to Consider

### 1. Agent Workbench
A dedicated workspace for the user to collaborate with an AI agent. 
- **Chat-first interface**: Allow users to steer the AI iteratively through conversation.
- **Complex Planning**: The agent should be able to break down high-level requests (like building a full curriculum or project) into smaller, executable tasks.
- **Durable Sessions**: Sessions should persist across restarts so users can pause, cancel, resume, and modify tasks over long periods.
- **Context Awareness**: The agent should have access to project context and materials to work effectively.

### 2. Multi-agent Collaboration
Instead of a single AI assistant, employ specialized agents that can interact with the user and each other.
- **Role Specialization**: Create distinct roles such as an "AI Teacher" (for lecturing and guiding), "AI Classmates" (for asking questions and spurring discussion), or "Reviewers" (for code or content critique).
- **Real-time Interaction**: Agents should be able to discuss topics with the user in a shared environment.

### 3. Seamless Integration (OpenClaw Style)
Bring the AI directly to where the users are communicating.
- **Messaging App Hooks**: Support integrations with platforms like Slack, Telegram, Discord, or Feishu.
- **Zero-setup Triggering**: Users should be able to trigger AI workflows (e.g., generating a full classroom or workspace) directly from these messaging apps without needing a complex local setup.

## Technical Implementation Notes
- **Extensibility**: Design these systems to be provider-neutral, allowing flexibility to swap between different LLM providers (e.g., OpenAI, Anthropic, Gemini) or use local models (e.g., Ollama, Lemonade).
- **Rich Output Capabilities**: When building the UI, ensure the AI can output more than just text—support for things like diagrams, interactive UI components, or even text-to-speech should be considered.
