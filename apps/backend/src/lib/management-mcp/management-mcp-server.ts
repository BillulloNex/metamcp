import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import logger from "@/utils/logger";

import { metaMcpServerPool } from "../metamcp/metamcp-server-pool";
import { mcpServerPool } from "../metamcp/mcp-server-pool";

// Lazy-import implementations to avoid circular dependency issues at module load time.
// The tRPC impl modules pull in heavy ORM / pool singletons that may not be ready when
// this file is first imported.  By deferring the require to call-time we guarantee the
// rest of the application has finished bootstrapping.

function getImpl() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mcpServers = require("../../trpc/mcp-servers.impl") as typeof import("../../trpc/mcp-servers.impl");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const namespaces = require("../../trpc/namespaces.impl") as typeof import("../../trpc/namespaces.impl");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const endpoints = require("../../trpc/endpoints.impl") as typeof import("../../trpc/endpoints.impl");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tools = require("../../trpc/tools.impl") as typeof import("../../trpc/tools.impl");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const apiKeys = require("../../trpc/api-keys.impl") as typeof import("../../trpc/api-keys.impl");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require("../../trpc/config.impl") as typeof import("../../trpc/config.impl");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const logs = require("../../trpc/logs.impl") as typeof import("../../trpc/logs.impl");

  return {
    mcpServers: mcpServers.mcpServersImplementations,
    namespaces: namespaces.namespacesImplementations,
    endpoints: endpoints.endpointsImplementations,
    tools: tools.toolsImplementations,
    apiKeys: apiKeys.apiKeysImplementations,
    config: config.configImplementations,
    logs: logs.logsImplementations,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createManagementMcpServer(userId: string) {
  const server = new McpServer({
    name: "metamcp-management",
    version: "1.0.0",
  });

  // =========================================================================
  // MCP SERVERS
  // =========================================================================

  server.tool(
    "list_mcp_servers",
    "List all registered MCP servers",
    {},
    async () => {
      try {
        const result = await getImpl().mcpServers.list(userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: list_mcp_servers error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "get_mcp_server",
    "Get a single MCP server by UUID",
    { uuid: z.string().describe("UUID of the MCP server") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().mcpServers.get({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_mcp_server error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "create_mcp_server",
    "Register a new MCP server (STDIO, SSE, or Streamable HTTP)",
    {
      name: z.string().describe("Unique server name (alphanumeric, hyphens, underscores)"),
      type: z.enum(["STDIO", "SSE", "STREAMABLE_HTTP"]).describe("Server transport type"),
      command: z.string().optional().describe("Command to run (required for STDIO)"),
      args: z.array(z.string()).optional().describe("Command arguments (STDIO)"),
      url: z.string().optional().describe("Server URL (required for SSE/STREAMABLE_HTTP)"),
      env: z.record(z.string()).optional().describe("Environment variables (key-value)"),
      headers: z.record(z.string()).optional().describe("Custom HTTP headers (key-value)"),
      bearerToken: z.string().optional().describe("Bearer token for authentication"),
      description: z.string().optional().describe("Human-readable description"),
    },
    async (args) => {
      try {
        const result = await getImpl().mcpServers.create(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: create_mcp_server error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "update_mcp_server",
    "Update an existing MCP server configuration",
    {
      uuid: z.string().describe("UUID of the server to update"),
      name: z.string().describe("New server name"),
      type: z.enum(["STDIO", "SSE", "STREAMABLE_HTTP"]).describe("Server transport type"),
      command: z.string().optional().describe("Command (STDIO)"),
      args: z.array(z.string()).optional().describe("Command arguments (STDIO)"),
      url: z.string().optional().describe("Server URL (SSE/STREAMABLE_HTTP)"),
      env: z.record(z.string()).optional().describe("Environment variables"),
      headers: z.record(z.string()).optional().describe("Custom HTTP headers"),
      bearerToken: z.string().optional().describe("Bearer token"),
      description: z.string().optional().describe("Description"),
    },
    async (args) => {
      try {
        const result = await getImpl().mcpServers.update(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: update_mcp_server error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "delete_mcp_server",
    "Delete an MCP server by UUID (cleans up sessions and namespace mappings)",
    { uuid: z.string().describe("UUID of the server to delete") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().mcpServers.delete({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: delete_mcp_server error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "bulk_import_mcp_servers",
    "Import MCP servers from a JSON config (Claude/Cursor format). Keys are server names, values are server configs.",
    {
      mcpServers: z.record(z.object({
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string()).optional(),
        description: z.string().optional(),
        type: z.string().optional().describe("STDIO | SSE | STREAMABLE_HTTP (defaults to STDIO)"),
      })).describe("Map of server name → server config"),
    },
    async (args) => {
      try {
        const result = await getImpl().mcpServers.bulkImport(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: bulk_import_mcp_servers error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // NAMESPACES
  // =========================================================================

  server.tool(
    "list_namespaces",
    "List all namespaces",
    {},
    async () => {
      try {
        const result = await getImpl().namespaces.list(userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: list_namespaces error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "get_namespace",
    "Get a namespace with its assigned servers",
    { uuid: z.string().describe("UUID of the namespace") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().namespaces.get({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "create_namespace",
    "Create a new namespace, optionally assigning MCP servers to it",
    {
      name: z.string().describe("Namespace name"),
      description: z.string().optional().describe("Description"),
      mcpServerUuids: z.array(z.string()).optional().describe("Server UUIDs to assign to this namespace"),
    },
    async (args) => {
      try {
        const result = await getImpl().namespaces.create(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: create_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "update_namespace",
    "Update a namespace (name, description, server assignments)",
    {
      uuid: z.string().describe("UUID of the namespace to update"),
      name: z.string().describe("New name"),
      description: z.string().optional().describe("New description"),
      mcpServerUuids: z.array(z.string()).optional().describe("New server UUID list"),
    },
    async (args) => {
      try {
        const result = await getImpl().namespaces.update(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: update_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "delete_namespace",
    "Delete a namespace by UUID",
    { uuid: z.string().describe("UUID of the namespace to delete") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().namespaces.delete({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: delete_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "set_server_status_in_namespace",
    "Enable or disable a specific MCP server within a namespace",
    {
      namespaceUuid: z.string().describe("Namespace UUID"),
      serverUuid: z.string().describe("Server UUID"),
      status: z.enum(["ACTIVE", "INACTIVE"]).describe("New status"),
    },
    async (args) => {
      try {
        const result = await getImpl().namespaces.updateServerStatus(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: set_server_status_in_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "set_tool_status_in_namespace",
    "Enable or disable a specific tool within a namespace",
    {
      namespaceUuid: z.string().describe("Namespace UUID"),
      toolUuid: z.string().describe("Tool UUID"),
      serverUuid: z.string().describe("Server UUID that provides the tool"),
      status: z.enum(["ACTIVE", "INACTIVE"]).describe("New status"),
    },
    async (args) => {
      try {
        const result = await getImpl().namespaces.updateToolStatus(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: set_tool_status_in_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "set_tool_overrides_in_namespace",
    "Override a tool's name, title, description, or annotations within a namespace",
    {
      namespaceUuid: z.string().describe("Namespace UUID"),
      toolUuid: z.string().describe("Tool UUID"),
      serverUuid: z.string().describe("Server UUID"),
      overrideName: z.string().nullable().optional().describe("Override tool name"),
      overrideTitle: z.string().nullable().optional().describe("Override title"),
      overrideDescription: z.string().nullable().optional().describe("Override description"),
      overrideAnnotations: z.record(z.unknown()).nullable().optional().describe("Override annotations (key-value)"),
    },
    async (args) => {
      try {
        const result = await getImpl().namespaces.updateToolOverrides(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: set_tool_overrides_in_namespace error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "list_namespace_tools",
    "List all tools in a namespace with their status and overrides",
    { namespaceUuid: z.string().describe("Namespace UUID") },
    async ({ namespaceUuid }) => {
      try {
        const result = await getImpl().namespaces.getTools({ namespaceUuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: list_namespace_tools error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // ENDPOINTS
  // =========================================================================

  server.tool(
    "list_endpoints",
    "List all public MCP endpoints",
    {},
    async () => {
      try {
        const result = await getImpl().endpoints.list(userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: list_endpoints error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "get_endpoint",
    "Get a public endpoint by UUID",
    { uuid: z.string().describe("Endpoint UUID") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().endpoints.get({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_endpoint error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "create_endpoint",
    "Create a new public MCP endpoint for a namespace",
    {
      name: z.string().describe("Endpoint name (URL-safe, alphanumeric/hyphens/underscores)"),
      namespaceUuid: z.string().describe("Namespace UUID to expose"),
      description: z.string().optional().describe("Description"),
      enableApiKeyAuth: z.boolean().optional().describe("Require API key auth (default: true)"),
      enableMaxRate: z.boolean().optional().describe("Enable global rate limiting"),
      maxRate: z.number().optional().describe("Max requests in window"),
      maxRateSeconds: z.number().optional().describe("Rate limit window in seconds"),
      enableClientMaxRate: z.boolean().optional().describe("Enable per-client rate limiting"),
      clientMaxRate: z.number().optional().describe("Per-client max requests"),
      clientMaxRateSeconds: z.number().optional().describe("Per-client window seconds"),
      enableOauth: z.boolean().optional().describe("Enable OAuth (default: false)"),
      createMcpServer: z.boolean().optional().describe("Auto-create MCP server entry for this endpoint (default: true)"),
    },
    async (args) => {
      try {
        const result = await getImpl().endpoints.create({
          ...args,
          enableMaxRate: args.enableMaxRate ?? false,
          enableClientMaxRate: args.enableClientMaxRate ?? false,
        }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: create_endpoint error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "update_endpoint",
    "Update an existing public endpoint",
    {
      uuid: z.string().describe("Endpoint UUID"),
      name: z.string().describe("New name"),
      namespaceUuid: z.string().describe("Namespace UUID"),
      description: z.string().optional().describe("Description"),
      enableApiKeyAuth: z.boolean().optional().describe("Require API key auth"),
      enableMaxRate: z.boolean().optional().describe("Enable global rate limiting"),
      maxRate: z.number().optional().describe("Max requests"),
      maxRateSeconds: z.number().optional().describe("Window seconds"),
      enableClientMaxRate: z.boolean().optional().describe("Enable per-client rate limiting"),
      clientMaxRate: z.number().optional().describe("Per-client max requests"),
      clientMaxRateSeconds: z.number().optional().describe("Per-client window seconds"),
      enableOauth: z.boolean().optional().describe("Enable OAuth"),
    },
    async (args) => {
      try {
        const result = await getImpl().endpoints.update({
          ...args,
          enableMaxRate: args.enableMaxRate ?? false,
          enableClientMaxRate: args.enableClientMaxRate ?? false,
        }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: update_endpoint error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "delete_endpoint",
    "Delete a public endpoint by UUID",
    { uuid: z.string().describe("Endpoint UUID") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().endpoints.delete({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: delete_endpoint error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // TOOLS (read + sync)
  // =========================================================================

  server.tool(
    "get_server_tools",
    "List all tools discovered from a specific MCP server",
    { mcpServerUuid: z.string().describe("MCP server UUID") },
    async ({ mcpServerUuid }) => {
      try {
        const result = await getImpl().tools.getByMcpServerUuid({ mcpServerUuid });
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_server_tools error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // API KEYS
  // =========================================================================

  server.tool(
    "list_api_keys",
    "List all API keys",
    {},
    async () => {
      try {
        const result = await getImpl().apiKeys.list(userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: list_api_keys error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "create_api_key",
    "Create a new API key for endpoint authentication",
    {
      name: z.string().describe("Human-readable name for the API key"),
    },
    async ({ name }) => {
      try {
        const result = await getImpl().apiKeys.create({ name }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: create_api_key error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "update_api_key",
    "Update an API key (name or active status)",
    {
      uuid: z.string().describe("API key UUID"),
      name: z.string().optional().describe("New name"),
      is_active: z.boolean().optional().describe("Set active/inactive"),
    },
    async (args) => {
      try {
        const result = await getImpl().apiKeys.update(args, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: update_api_key error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "delete_api_key",
    "Delete an API key by UUID",
    { uuid: z.string().describe("API key UUID") },
    async ({ uuid }) => {
      try {
        const result = await getImpl().apiKeys.delete({ uuid }, userId);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: delete_api_key error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // CONFIG / SETTINGS
  // =========================================================================

  server.tool(
    "get_all_configs",
    "Get all MetaMCP configuration values (timeouts, auth settings, etc.)",
    {},
    async () => {
      try {
        const result = await getImpl().config.getAllConfigs();
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_all_configs error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "set_config",
    "Set a MetaMCP configuration value",
    {
      key: z.enum([
        "DISABLE_SIGNUP",
        "DISABLE_SSO_SIGNUP",
        "DISABLE_BASIC_AUTH",
        "MCP_RESET_TIMEOUT_ON_PROGRESS",
        "MCP_TIMEOUT",
        "MCP_MAX_TOTAL_TIMEOUT",
        "MCP_MAX_ATTEMPTS",
        "SESSION_LIFETIME",
      ]).describe("Config key"),
      value: z.string().describe("Config value"),
      description: z.string().optional().describe("Optional description"),
    },
    async (args) => {
      try {
        const result = await getImpl().config.setConfig(args);
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: set_config error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "get_auth_providers",
    "List configured authentication providers and their status",
    {},
    async () => {
      try {
        const result = await getImpl().config.getAuthProviders();
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_auth_providers error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // LOGS
  // =========================================================================

  server.tool(
    "get_logs",
    "Get MetaMCP proxy logs (errors, warnings, info from upstream MCP servers)",
    {
      limit: z.number().optional().describe("Max number of log entries to return (default: 100, max: 1000)"),
    },
    async ({ limit }) => {
      try {
        const result = await getImpl().logs.getLogs({ limit });
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: get_logs error", e);
        return err(String(e));
      }
    },
  );

  server.tool(
    "clear_logs",
    "Clear all MetaMCP proxy logs",
    {},
    async () => {
      try {
        const result = await getImpl().logs.clearLogs();
        return ok(result);
      } catch (e) {
        logger.error("management-mcp: clear_logs error", e);
        return err(String(e));
      }
    },
  );

  // =========================================================================
  // INTROSPECTION / HEALTH
  // =========================================================================

  server.tool(
    "get_health",
    "Get MetaMCP health status including pool statistics, active sessions, and server error states",
    {},
    async () => {
      try {
        const poolStatus = metaMcpServerPool.getPoolStatus();
        const mcpPoolStatus = mcpServerPool.getPoolStatus();
        return ok({
          status: "ok",
          metaMcpPool: poolStatus,
          mcpServerPool: mcpPoolStatus,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        logger.error("management-mcp: get_health error", e);
        return err(String(e));
      }
    },
  );

  return server;
}
