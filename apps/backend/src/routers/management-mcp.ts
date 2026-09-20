import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cors from "cors";
import express from "express";

import logger from "@/utils/logger";

import { createManagementMcpServer } from "../lib/management-mcp/management-mcp-server";
import { SessionLifetimeManagerImpl } from "../lib/session-lifetime-manager";

const managementMcpRouter = express.Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MANAGEMENT_TOKEN = process.env.METAMCP_MANAGEMENT_TOKEN;

// A synthetic user ID used for all management operations.
// We use a stable UUID so that ownership rules inside the tRPC impls
// behave consistently (the management API acts as a single "admin" user).
const MANAGEMENT_USER_ID =
  process.env.METAMCP_MANAGEMENT_USER_ID ?? "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// Guard — if no token is configured the entire router is disabled
// ---------------------------------------------------------------------------

if (!MANAGEMENT_TOKEN) {
  logger.warn(
    "METAMCP_MANAGEMENT_TOKEN is not set – Management MCP endpoint is DISABLED. " +
      "Set the env var to enable /management/mcp",
  );
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

managementMcpRouter.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "Authorization"],
  }),
);

// ---------------------------------------------------------------------------
// Auth middleware — bearer token
// ---------------------------------------------------------------------------

managementMcpRouter.use((req, res, next) => {
  if (!MANAGEMENT_TOKEN) {
    res.status(404).json({ error: "Management MCP endpoint is not enabled" });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== MANAGEMENT_TOKEN) {
    res.status(403).json({ error: "Invalid management token" });
    return;
  }

  next();
});

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

const sessionManager =
  new SessionLifetimeManagerImpl<StreamableHTTPServerTransport>("ManagementMCP");

const cleanupSession = async (
  sessionId: string,
  transport?: StreamableHTTPServerTransport,
) => {
  logger.info(`Cleaning up Management MCP session ${sessionId}`);
  try {
    const t = transport || sessionManager.getSession(sessionId);
    if (t) {
      await t.close();
    }
    sessionManager.removeSession(sessionId);
    logger.info(`Management MCP session ${sessionId} cleaned up`);
  } catch (error) {
    logger.error(`Error cleaning up Management MCP session ${sessionId}:`, error);
    sessionManager.removeSession(sessionId);
  }
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

managementMcpRouter.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string;
  const transport = sessionManager.getSession(sessionId);
  if (!transport) {
    res.status(404).end("Session not found");
    return;
  }
  await transport.handleRequest(req, res);
});

managementMcpRouter.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId) {
    // New session
    try {
      const newSessionId = randomUUID();
      logger.info(`New Management MCP session: ${newSessionId}`);

      const mcpServer = createManagementMcpServer(MANAGEMENT_USER_ID);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: async (sid) => {
          logger.info(`Management MCP session initialized: ${sid}`);
        },
      });

      sessionManager.addSession(newSessionId, transport);

      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error("Error in Management MCP POST:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: "Internal server error", message: msg });
    }
  } else {
    // Existing session
    const transport = sessionManager.getSession(sessionId);
    if (!transport) {
      res.status(404).json({ error: "Session not found", sessionId });
      return;
    }
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error("Error in Management MCP POST (existing session):", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ error: "Internal server error", message: msg });
    }
  }
});

managementMcpRouter.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "Missing mcp-session-id header" });
    return;
  }
  try {
    await cleanupSession(sessionId);
    res.status(200).json({ message: "Session cleaned up", sessionId });
  } catch (error) {
    logger.error("Error in Management MCP DELETE:", error);
    res.status(500).json({
      error: "Cleanup failed",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Health
managementMcpRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "management-mcp",
    sessions: sessionManager.getSessionIds().length,
  });
});

// Cleanup timer
sessionManager.startCleanupTimer(async (sessionId, transport) => {
  await cleanupSession(sessionId, transport);
});

export default managementMcpRouter;
