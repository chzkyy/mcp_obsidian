#!/usr/bin/env node
/**
 * MCP server that exposes Obsidian (via the Local REST API plugin) to Claude Desktop.
 *
 * Required environment variables:
 *   OBSIDIAN_BASE_URL  e.g. https://127.0.0.1:27124
 *   OBSIDIAN_API_KEY   API token from the Local REST API plugin settings
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ObsidianApi } from "./obsidianApi.js";

function loadConfig() {
  const baseUrl = process.env.OBSIDIAN_BASE_URL;
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(
      "ERROR: OBSIDIAN_BASE_URL and OBSIDIAN_API_KEY environment variables are required.",
    );
    console.error(
      "Set them in your Claude Desktop config (mcpServers -> env), e.g.:",
    );
    console.error("  OBSIDIAN_BASE_URL=https://127.0.0.1:27124");
    console.error("  OBSIDIAN_API_KEY=your-plugin-api-key");
    process.exit(1);
  }
  return { baseUrl, apiKey };
}

const api = new ObsidianApi(loadConfig());

// ---- Tool input schemas ----------------------------------------------------

const SearchSchema = z.object({
  query: z
    .string()
    .describe(
      "Obsidian search query. Supports Obsidian search syntax like 'path:folder', 'tag:#x', 'line(#)', etc.",
    ),
  context_length: z
    .number()
    .int()
    .min(0)
    .max(500)
    .default(100)
    .describe("Characters of context shown around each match."),
});

const NotePathSchema = z.object({
  path: z
    .string()
    .describe(
      "Vault-relative path to the note, e.g. 'folder/Note.md'. Use the path returned by search/list.",
    ),
});

const GetNoteSchema = NotePathSchema;

const CreateNoteSchema = z.object({
  path: z.string().describe("Vault-relative path, e.g. 'Journal/2026-08-02.md'."),
  content: z.string().describe("Markdown content for the note."),
  overwrite: z
    .boolean()
    .default(false)
    .describe("If false, refuse when the note already exists."),
});

const UpdateNoteSchema = z.object({
  path: z.string().describe("Vault-relative path to an existing note."),
  content: z.string().describe("Full new markdown content of the note."),
});

const AppendNoteSchema = z.object({
  path: z.string().describe("Vault-relative path to a note."),
  content: z.string().describe("Markdown content to append at the end."),
  mode: z
    .enum(["append", "prepend"])
    .default("append")
    .describe("Where to insert the content."),
});

const DeleteNoteSchema = NotePathSchema;

const ListDirectorySchema = z.object({
  directory: z
    .string()
    .default("/")
    .describe("Vault-relative directory path, e.g. '' or 'folder'."),
});

const CommandSchema = z.object({
  command_id: z
    .string()
    .describe("Obsidian command id, e.g. 'app:go-home'. Use list_commands first."),
});

const OpenNoteSchema = NotePathSchema;

// ---- Helpers ---------------------------------------------------------------

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function text(data: string) {
  return { content: [{ type: "text" as const, text: data }] };
}

function error(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

// ---- Server ----------------------------------------------------------------

const server = new Server(
  { name: "mcp-obsidian", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "search_notes",
      description:
        "Search notes in the Obsidian vault using Obsidian's search query syntax. Returns matching paths, scores, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: SearchSchema.shape.query.description },
          context_length: {
            type: "number",
            default: 100,
            description: SearchSchema.shape.context_length.description,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_note",
      description:
        "Read the full markdown content of a note by its vault-relative path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: GetNoteSchema.shape.path.description },
        },
        required: ["path"],
      },
    },
    {
      name: "create_note",
      description:
        "Create a new note in the vault with markdown content. Refuses to overwrite an existing note unless overwrite=true.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: CreateNoteSchema.shape.path.description },
          content: { type: "string", description: CreateNoteSchema.shape.content.description },
          overwrite: {
            type: "boolean",
            default: false,
            description: CreateNoteSchema.shape.overwrite.description,
          },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "update_note",
      description:
        "Replace the entire content of an existing note with new markdown content.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: UpdateNoteSchema.shape.path.description },
          content: { type: "string", description: UpdateNoteSchema.shape.content.description },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "append_note",
      description:
        "Append (or prepend) markdown content to an existing note without replacing it.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: AppendNoteSchema.shape.path.description },
          content: { type: "string", description: AppendNoteSchema.shape.content.description },
          mode: {
            type: "string",
            enum: ["append", "prepend"],
            default: "append",
            description: AppendNoteSchema.shape.mode.description,
          },
        },
        required: ["path", "content"],
      },
    },
    {
      name: "delete_note",
      description: "Permanently delete a note from the vault.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: DeleteNoteSchema.shape.path.description },
        },
        required: ["path"],
      },
    },
    {
      name: "list_directory",
      description:
        "List files and folders under a vault directory. Use directory='' or '/' for the vault root.",
      inputSchema: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            default: "/",
            description: ListDirectorySchema.shape.directory.description,
          },
        },
      },
    },
    {
      name: "open_note",
      description: "Open a note in the Obsidian app window by its vault path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: OpenNoteSchema.shape.path.description },
        },
        required: ["path"],
      },
    },
    {
      name: "list_commands",
      description: "List all available Obsidian commands that can be executed.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "execute_command",
      description: "Execute an Obsidian command by its id (use list_commands first).",
      inputSchema: {
        type: "object",
        properties: {
          command_id: {
            type: "string",
            description: CommandSchema.shape.command_id.description,
          },
        },
        required: ["command_id"],
      },
    },
    {
      name: "get_active_note",
      description: "Get the markdown content of the currently active note in Obsidian.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "search_notes": {
        const { query, context_length } = SearchSchema.parse(args);
        const results = await api.search(query, context_length);
        if (!results.length) {
          return text(`No notes found for query: "${query}"`);
        }
        return json(results);
      }

      case "get_note": {
        const { path } = GetNoteSchema.parse(args);
        const content = await api.getNote(path);
        return text(content);
      }

      case "create_note": {
        const { path, content, overwrite } = CreateNoteSchema.parse(args);
        if (!overwrite) {
          const exists = await api
            .getNote(path)
            .then(() => true)
            .catch(() => false);
          if (exists) {
            return error(
              `Note already exists: ${path}. Set overwrite=true to replace it.`,
            );
          }
        }
        await api.putNote(path, content);
        return text(`Note created: ${path}`);
      }

      case "update_note": {
        const { path, content } = UpdateNoteSchema.parse(args);
        await api.putNote(path, content);
        return text(`Note updated: ${path}`);
      }

      case "append_note": {
        const { path, content, mode } = AppendNoteSchema.parse(args);
        if (mode === "prepend") {
          await api.prependNote(path, content);
        } else {
          await api.appendNote(path, content);
        }
        return text(`Note ${mode}ed: ${path}`);
      }

      case "delete_note": {
        const { path } = DeleteNoteSchema.parse(args);
        await api.deleteNote(path);
        return text(`Note deleted: ${path}`);
      }

      case "list_directory": {
        const { directory } = ListDirectorySchema.parse(args);
        const entries = await api.listDirectory(directory);
        return json(entries);
      }

      case "open_note": {
        const { path } = OpenNoteSchema.parse(args);
        await api.openNote(path);
        return text(`Opened in Obsidian: ${path}`);
      }

      case "list_commands": {
        const commands = await api.commands();
        return json(commands);
      }

      case "execute_command": {
        const { command_id } = CommandSchema.parse(args);
        await api.executeCommand(command_id);
        return text(`Command executed: ${command_id}`);
      }

      case "get_active_note": {
        const content = await api.getActiveFile();
        return text(content);
      }

      default:
        return error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
});

// ---- Run -------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("mcp-obsidian server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});