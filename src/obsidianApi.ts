/**
 * Lightweight client for the Obsidian Local REST API plugin.
 * @see https://github.com/coddingtonbear/obsidian-local-rest-api
 */

export interface ObsidianConfig {
  /** Base URL of the local REST API, e.g. https://127.0.0.1:27124 */
  baseUrl: string;
  /** API token (license key) from the plugin settings. */
  apiKey: string;
}

export interface SearchResult {
  filename: string;
  path: string;
  score: number;
  matches?: Array<{
    context: string;
    match: {
      start: number;
      end: number;
    };
    preview: string;
  }>;
}

export interface CommandListResult {
  id: string;
  name: string;
}

export interface VaultEntry {
  type: "file" | "folder";
  path: string;
  name?: string;
  extension?: string;
  size?: number;
}

export class ObsidianApi {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ObsidianConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      body?: unknown;
      contentType?:
        | "text/markdown"
        | "application/vnd.olrapi.note+json"
        | "application/json";
      accept?: "text/markdown" | "application/json";
    } = {},
  ): Promise<T> {
    const url = this.baseUrl + path;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (opts.accept) {
      headers["Accept"] = opts.accept;
    }
    if (opts.body !== undefined && opts.contentType) {
      headers["Content-Type"] = opts.contentType;
    }

    const res = await fetch(url, {
      method,
      headers,
      ...(opts.body !== undefined
        ? {
            body:
              typeof opts.body === "string"
                ? opts.body
                : JSON.stringify(opts.body),
          }
        : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Obsidian API ${method} ${path} failed: ${res.status} ${res.statusText}${
          text ? ` - ${text}` : ""
        }`,
      );
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return (await res.json()) as T;
    }
    // Return raw text for markdown / plain responses.
    return (await res.text()) as unknown as T;
  }

  /** Search vault using Obsidian's search query syntax. */
  search(query: string, contextLength = 100): Promise<SearchResult[]> {
    return this.request<SearchResult[]>("POST", "/search/simple/", {
      contentType: "application/json",
      body: {
        query,
        contextLength,
      },
    });
  }

  /** Open a note in Obsidian by its vault path. */
  openNote(path: string): Promise<void> {
    return this.request<void>("POST", `/open/${encodeURI(path)}`);
  }

  /** Get the raw markdown content of a note. */
  getNote(path: string): Promise<string> {
    return this.request<string>("GET", `/vault/${encodeURI(path)}`, {
      accept: "text/markdown",
    });
  }

  /** Create or replace a note in the vault. */
  putNote(path: string, content: string): Promise<void> {
    return this.request<void>("PUT", `/vault/${encodeURI(path)}`, {
      contentType: "text/markdown",
      body: content,
    });
  }

  /** Append content to an existing note. */
  async appendNote(path: string, content: string): Promise<void> {
    const existing = await this.getNote(path).catch(() => "");
    await this.putNote(path, existing + content);
  }

  /** Insert content at the start of an existing note. */
  async prependNote(path: string, content: string): Promise<void> {
    const existing = await this.getNote(path).catch(() => "");
    await this.putNote(path, content + existing);
  }

  /** Delete a note from the vault. */
  deleteNote(path: string): Promise<void> {
    return this.request<void>("DELETE", `/vault/${encodeURI(path)}`);
  }

  /** List files/folders under a directory (default vault root). */
  listDirectory(dir = "/"): Promise<VaultEntry[]> {
    const clean = dir.replace(/^\/+/, "");
    return this.request<VaultEntry[]>("GET", `/vault/${clean}/`);
  }

  /** List available Obsidian commands. */
  commands(): Promise<CommandListResult[]> {
    return this.request<CommandListResult[]>("GET", `/commands/`);
  }

  /** Execute an Obsidian command by id. */
  executeCommand(commandId: string): Promise<void> {
    return this.request<void>(
      "POST",
      `/commands/${encodeURIComponent(commandId)}/`,
    );
  }

  /** Get active file content. */
  getActiveFile(): Promise<string> {
    return this.request<string>("GET", `/active/`, {
      accept: "text/markdown",
    });
  }
}