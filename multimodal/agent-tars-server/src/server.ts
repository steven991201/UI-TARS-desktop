/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import http from 'http';
import { setupAPI } from './api';
import { setupSocketIO } from './core/SocketHandlers';
import { StorageProvider, createStorageProvider } from './storage';
import { Server as SocketIOServer } from 'socket.io';
import { LogLevel } from '@agent-tars/core';
import type { AgentTARSAppConfig, AgentTARSServerVersionInfo, AgioProviderImpl } from './types';
import type { AgentSession } from './core';

export { express };

/**
 * Server extra options for dependency injection
 */
export interface ServerExtraOptions extends AgentTARSServerVersionInfo {
  /** Custom AGIO provider implementation */
  agioProvider?: AgioProviderImpl;
}

/**
 * AgentTARSServer - Main server class for Agent TARS
 *
 * This class orchestrates all server components including:
 * - Express application and HTTP server
 * - API endpoints
 * - WebSocket communication
 * - Session management
 * - Storage integration
 * - AGIO monitoring integration
 * - Workspace static file serving
 */
export class AgentTARSServer {
  // Core server components
  private app: express.Application;
  private server: http.Server;
  private io: SocketIOServer; // Socket.IO server

  // Server state
  private isRunning = false;

  // Session management
  public sessions: Record<string, AgentSession> = {};
  public storageUnsubscribes: Record<string, () => void> = {};

  // Dependency injection
  private customAgioProvider?: AgioProviderImpl;

  // Configuration
  public readonly port: number;
  public readonly workspacePath?: string;
  public readonly isDebug: boolean;
  public readonly storageProvider: StorageProvider | null = null;
  public readonly appConfig: Required<AgentTARSAppConfig>;

  constructor(
    appConfig: Required<AgentTARSAppConfig>,
    public readonly extraOptions?: ServerExtraOptions,
  ) {
    // Initialize options
    this.appConfig = appConfig;
    this.port = appConfig.server.port ?? 3000;
    this.workspacePath = appConfig.workspace?.workingDirectory;
    this.isDebug = appConfig.logLevel === LogLevel.DEBUG;

    // Store injection options
    this.customAgioProvider = extraOptions?.agioProvider;

    // Initialize Express app and HTTP server
    this.app = express();
    this.server = http.createServer(this.app);

    // Initialize storage if provided
    if (appConfig.server.storage) {
      this.storageProvider = createStorageProvider(appConfig.server.storage);
    }

    // Setup API routes and middleware (includes workspace static server)
    setupAPI(this.app, {
      workspacePath: this.workspacePath,
      isolateSessions: appConfig.workspace?.isolateSessions ?? false,
      isDebug: this.isDebug,
    });

    // Setup WebSocket functionality
    this.io = setupSocketIO(this.server, this);

    // Make server instance available to request handlers
    this.app.locals.server = this;
  }

  /**
   * Get the custom AGIO provider if injected
   * @returns Custom AGIO provider or undefined
   */
  getCustomAgioProvider(): AgioProviderImpl | undefined {
    return this.customAgioProvider;
  }

  /**
   * Get the Express application instance
   * @returns Express application
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Get the HTTP server instance
   * @returns HTTP server
   */
  getHttpServer(): http.Server {
    return this.server;
  }

  /**
   * Get the Socket.IO server instance
   * @returns Socket.IO server
   */
  getSocketIOServer(): SocketIOServer {
    return this.io;
  }

  /**
   * Check if the server is currently running
   * @returns True if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get storage information if available
   * @returns Object containing storage type and path (if applicable)
   */
  getStorageInfo(): { type: string; path?: string } {
    if (!this.storageProvider) {
      return { type: 'none' };
    }

    if (this.storageProvider.constructor.name === 'FileStorageProvider') {
      return {
        type: 'file',
        path: this.storageProvider.dbPath,
      };
    }

    if (this.storageProvider.constructor.name === 'SQLiteStorageProvider') {
      return {
        type: 'sqlite',
        path: this.storageProvider.dbPath,
      };
    }

    // For other storage types
    return {
      type: this.storageProvider.constructor.name.replace('StorageProvider', '').toLowerCase(),
    };
  }

  /**
   * Start the server on the configured port
   * @returns Promise resolving with the server instance
   */
  async start(): Promise<http.Server> {
    // Initialize storage if available
    if (this.storageProvider) {
      try {
        await this.storageProvider.initialize();
      } catch (error) {
        console.error('Failed to initialize storage provider:', error);
      }
    }

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        // console.log(`🚀 Agent TARS Server is running at http://localhost:${this.port}`);
        this.isRunning = true;
        resolve(this.server);
      });
    });
  }

  /**
   * Stop the server and clean up all resources
   * @returns Promise resolving when server is stopped
   */
  async stop(): Promise<void> {
    // Clean up all active sessions
    const sessionCleanup = Object.values(this.sessions).map((session) => session.cleanup());
    await Promise.all(sessionCleanup);

    // Clean up all storage unsubscribes
    Object.values(this.storageUnsubscribes).forEach((unsubscribe) => unsubscribe());
    this.storageUnsubscribes = {};

    // Clear sessions
    this.sessions = {};

    // Close storage provider
    if (this.storageProvider) {
      await this.storageProvider.close();
    }

    // Close server if running
    if (this.isRunning) {
      return new Promise((resolve, reject) => {
        this.server.close((err) => {
          if (err) {
            reject(err);
            return;
          }

          this.isRunning = false;
          resolve();
        });
      });
    }

    return Promise.resolve();
  }
}
