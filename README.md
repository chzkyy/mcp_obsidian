# mcp-obsidian

MCP server that connects Claude Desktop to Obsidian via the Local REST API plugin.

## Overview

`mcp-obsidian` is a Node.js/TypeScript MCP server that exposes your Obsidian vault to Claude Desktop over stdio.  
It talks to the [Obsidian Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api) and provides tools for searching, reading, writing, and managing notes, plus running Obsidian commands.

## Features (Available MCP Tools)

Based on `src/index.ts`, this server currently exposes:

1. `search_notes` - search notes using Obsidian query syntax
2. `get_note` - read full markdown content by vault-relative path
3. `create_note` - create a new note (`overwrite` optional)
4. `update_note` - replace full content of an existing note
5. `append_note` - append or prepend content to a note
6. `delete_note` - delete a note
7. `list_directory` - list files/folders under a vault directory
8. `open_note` - open a note in the Obsidian app
9. `list_commands` - list available Obsidian command IDs
10. `execute_command` - execute an Obsidian command by ID
11. `get_active_note` - get content of the active note in Obsidian

## Requirements

- Node.js 18+ (Node 20+ recommended)
- Obsidian desktop app
- Obsidian plugin: **Local REST API** installed and enabled
- API key from the Local REST API plugin settings

## Environment Variables

Required:

- `OBSIDIAN_BASE_URL` (example: `https://127.0.0.1:27124`)
- `OBSIDIAN_API_KEY` (token/license key from plugin settings)

Optional (only if you use self-signed TLS cert from local plugin):

- `NODE_TLS_REJECT_UNAUTHORIZED=0`

> Security note: disable TLS verification only for local trusted use.

## Installation & Build

```bash
npm install
npm run build
```

Build output will be generated in `dist/`.

## Claude Desktop Configuration

Use `claude_desktop_config.example.json` as reference.

Example:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_obsidian/dist/index.js"],
      "env": {
        "OBSIDIAN_BASE_URL": "https://127.0.0.1:27124",
        "OBSIDIAN_API_KEY": "YOUR_LOCAL_REST_API_KEY_HERE",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
```

Adjust `args` to the absolute path on your machine.

## Usage Examples

After Claude Desktop loads this MCP server, you can call tools like:

- Search notes:
  - tool: `search_notes`
  - args: `{"query":"tag:#project","context_length":120}`
- Read note:
  - tool: `get_note`
  - args: `{"path":"Projects/Plan.md"}`
- Create note:
  - tool: `create_note`
  - args: `{"path":"Journal/2026-08-17.md","content":"# Daily Log\\n- ...","overwrite":false}`
- Append note:
  - tool: `append_note`
  - args: `{"path":"Inbox.md","content":"\\n- New item","mode":"append"}`
- Run command:
  - tool: `execute_command`
  - args: `{"command_id":"app:go-home"}`

## Project Structure

```text
.
├── src/
│   ├── index.ts         # MCP server entrypoint, tool schema + handlers
│   └── obsidianApi.ts   # Obsidian Local REST API client wrapper
├── claude_desktop_config.example.json
├── package.json
└── tsconfig.json
```

## Obsidian Local REST API Plugin Note

This project depends on the Local REST API plugin endpoints (`/vault`, `/search/simple`, `/commands`, `/active`, `/open`).  
If the plugin is not installed/enabled or API key/base URL is wrong, MCP tools will fail.
