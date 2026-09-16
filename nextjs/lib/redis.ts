/**
 * Redis helper utilities for Onix v2 Web Scan
 * Implements Redis connection and caching functionality
 * Ported from Utils/RedisHelper.cs
 *
 * STRICT MODE ENFORCEMENT:
 * - SERVER (deployed): MUST use Redis only - NO env var fallback
 * - LOCAL (development): MUST use env vars only - NO Redis
 */

import Redis, { Redis as RedisClient } from "ioredis";
import { RedisConnectionError } from "./types";

// Singleton Redis client instance
let redisClient: RedisClient | null = null;

/**
 * Deployment mode detection
 * STRICT RULES:
 * - If REDIS_HOST is set → SERVER mode (use Redis ONLY)
 * - If REDIS_HOST not set → LOCAL mode (use env vars ONLY)
 */
export enum DeploymentMode {
  LOCAL = "LOCAL", // Local development machine - use env vars only
  SERVER = "SERVER", // Deployed server (dev/prod) - use Redis only
}

/**
 * Detect current deployment mode
 * @returns DeploymentMode.SERVER if REDIS_HOST is set, otherwise DeploymentMode.LOCAL
 */
export function getDeploymentMode(): DeploymentMode {
  const redisHost = process.env.REDIS_HOST;
  return redisHost ? DeploymentMode.SERVER : DeploymentMode.LOCAL;
}

/**
 * Validate configuration for current deployment mode
 * @throws Error if configuration is invalid
 */
export function validateConfiguration(): void {
  const mode = getDeploymentMode();

  if (mode === DeploymentMode.SERVER) {
    // SERVER mode: Redis MUST be configured
    const redisHost = process.env.REDIS_HOST;
    const redisPort = process.env.REDIS_PORT;

    if (!redisHost || !redisPort) {
      throw new Error(
        "🚨 CONFIGURATION ERROR [SERVER MODE]:\n" +
          "   Redis configuration is REQUIRED when REDIS_HOST is set.\n" +
          "   Missing: " +
          (!redisHost ? "REDIS_HOST" : "REDIS_PORT") +
          "\n" +
          "   Server deployments MUST use Redis for encryption keys.\n" +
          "   Environment variables ENCRYPTION_KEY/ENCRYPTION_IV are IGNORED in server mode.",
      );
    }

    console.log("✅ Configuration validated: SERVER mode (Redis required)");
    console.log(`   Redis: ${redisHost}:${redisPort}`);
    console.log("   Encryption keys will be loaded from Redis ONLY");
  } else {
    // LOCAL mode: Env vars MUST be configured
    const encryptionKey = process.env.ENCRYPTION_KEY;
    const encryptionIV = process.env.ENCRYPTION_IV;

    if (!encryptionKey || !encryptionIV) {
      throw new Error(
        "🚨 CONFIGURATION ERROR [LOCAL MODE]:\n" +
          "   Environment variables ENCRYPTION_KEY and ENCRYPTION_IV are REQUIRED.\n" +
          "   Missing: " +
          (!encryptionKey ? "ENCRYPTION_KEY" : "") +
          (!encryptionIV ? " ENCRYPTION_IV" : "") +
          "\n" +
          "   Local development MUST use environment variables.\n" +
          "   Set REDIS_HOST if you want to use Redis instead.",
      );
    }

    console.log(
      "✅ Configuration validated: LOCAL mode (Environment variables)",
    );
    console.log(
      "   Encryption keys will be loaded from environment variables ONLY",
    );
  }
}

/**
 * Gets or creates a Redis client instance (singleton pattern)
 * @returns Redis client or null if connection fails
 */
export function getRedisClient(): RedisClient | null {
  // Return the existing client even while it's still connecting - creating a
  // second client here on every call until the first one reaches "ready"
  // just stacks up redundant connection attempts. With enableOfflineQueue
  // true (see below), commands issued on a not-yet-ready client are queued
  // and flushed automatically once the connection completes.
  if (redisClient) {
    return redisClient;
  }

  // Check if Redis configuration is provided
  const redisHost = process.env.REDIS_HOST;
  const redisPort = process.env.REDIS_PORT;

  if (!redisHost || !redisPort) {
    console.log(
      "Redis configuration not found. Running in local mode without Redis.",
    );
    return null;
  }

  try {
    // Get Redis password and TLS settings (for production)
    const redisPassword = process.env.REDIS_PASSWORD;
    const redisTls = process.env.REDIS_TLS === "true";

    // Create new Redis client
    const redisOptions: any = {
      host: redisHost,
      port: parseInt(redisPort, 10),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      // Queue commands issued before the connection is ready instead of
      // throwing "Stream isn't writeable" - fixes a real bug where the very
      // first request to a freshly-restarted pod (before Redis finishes
      // connecting) failed to load the encryption config, breaking Verify.
      enableOfflineQueue: true,
      lazyConnect: false,
    };

    // Add password if provided (production Redis)
    if (redisPassword) {
      redisOptions.password = redisPassword;
      console.log("Redis password authentication enabled");
    }

    // Enable TLS if configured (production Redis)
    if (redisTls) {
      redisOptions.tls = {
        rejectUnauthorized: false, // For self-signed certificates in private cloud
      };
      console.log("Redis TLS/SSL enabled");
    }

    redisClient = new Redis(redisOptions);

    // Handle connection events
    redisClient.on("connect", () => {
      console.log("✅ Redis connected successfully");
    });

    redisClient.on("error", (err) => {
      console.error("❌ Redis connection error:", err.message);
    });

    redisClient.on("close", () => {
      console.log("Redis connection closed");
    });

    return redisClient;
  } catch (error) {
    console.error("Failed to create Redis client:", error);
    return null;
  }
}

/**
 * Sets a string value in Redis
 * @param key - Cache key
 * @param value - String value to store
 * @param expirySeconds - Optional expiry time in seconds
 * @returns True if successful, false otherwise
 */
export async function setAsync(
  key: string,
  value: string,
  expirySeconds?: number,
): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    console.warn("Redis not available. Skipping cache set.");
    return false;
  }

  try {
    if (expirySeconds) {
      await client.setex(key, expirySeconds, value);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (error) {
    console.error("Redis setAsync error:", error);
    return false;
  }
}

/**
 * Gets a string value from Redis
 * @param key - Cache key
 * @returns String value or null if not found
 */
export async function getAsync(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const value = await client.get(key);
    return value;
  } catch (error) {
    console.error("Redis getAsync error:", error);
    return null;
  }
}

/**
 * Sets an object in Redis (serializes to JSON)
 * @param key - Cache key
 * @param obj - Object to store
 * @param expirySeconds - Optional expiry time in seconds
 * @returns True if successful, false otherwise
 */
export async function setObjectAsync<T>(
  key: string,
  obj: T,
  expirySeconds?: number,
): Promise<boolean> {
  try {
    const json = JSON.stringify(obj);
    return await setAsync(key, json, expirySeconds);
  } catch (error) {
    console.error("Redis setObjectAsync error:", error);
    return false;
  }
}

/**
 * Gets an object from Redis (deserializes from JSON)
 * @param key - Cache key
 * @returns Deserialized object or null if not found
 */
export async function getObjectAsync<T>(key: string): Promise<T | null> {
  try {
    const value = await getAsync(key);
    if (!value) {
      return null;
    }

    // Parse JSON with case-insensitive property matching
    const obj = JSON.parse(value) as T;
    return obj;
  } catch (error) {
    console.error("Redis getObjectAsync error:", error);
    return null;
  }
}

/**
 * Publishes a message to a Redis stream
 * @param stream - Stream name
 * @param message - Message to publish
 * @returns Message ID or null if failed
 */
export async function publishMessageAsync(
  stream: string,
  message: string,
): Promise<string | null> {
  const client = getRedisClient();
  if (!client) {
    console.warn("Redis not available. Skipping message publish.");
    return null;
  }

  try {
    // Add message to stream with auto-generated ID
    const messageId = await client.xadd(stream, "*", "message", message);
    return messageId;
  } catch (error) {
    console.error("Redis publishMessageAsync error:", error);
    return null;
  }
}

/**
 * Deletes a key from Redis
 * @param key - Cache key to delete
 * @returns True if deleted, false otherwise
 */
export async function deleteAsync(key: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    return false;
  }

  try {
    const result = await client.del(key);
    return result > 0;
  } catch (error) {
    console.error("Redis deleteAsync error:", error);
    return false;
  }
}

/**
 * Closes the Redis connection
 * Should be called on application shutdown
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      console.log("Redis connection closed gracefully");
    } catch (error) {
      console.error("Error closing Redis connection:", error);
    } finally {
      redisClient = null;
    }
  }
}

/**
 * Checks if Redis is connected and available
 * @returns True if connected, false otherwise
 */
export function isRedisAvailable(): boolean {
  return redisClient !== null && redisClient.status === "ready";
}

/**
 * Interface matching C# EncryptionConfig model
 * From obsoleted/Models/EncryptionConfig.cs
 */
export interface EncryptionConfig {
  Encryption_Key: string;
  Encryption_Iv: string;
}

/**
 * Get encryption configuration for organization
 *
 * STRICT MODE ENFORCEMENT:
 * - SERVER mode (REDIS_HOST set): Get keys from Redis ONLY - NO fallback to env vars
 * - LOCAL mode (no REDIS_HOST): Get keys from env vars ONLY - NO Redis
 *
 * This prevents configuration mistakes and matches C# behavior exactly.
 *
 * @param org - Organization identifier (e.g., 'napbiotec')
 * @returns Encryption configuration or null if not found
 * @throws Error if configuration is invalid for current mode
 */
export async function getEncryptionConfig(
  org: string,
  actionId?: string,
): Promise<EncryptionConfig | null> {
  const mode = getDeploymentMode();

  console.log(`🔐 Getting encryption config for org: ${org} [MODE: ${mode}]`);

  // ========================================
  // LOCAL MODE: Use environment variables ONLY
  // ========================================
  if (mode === DeploymentMode.LOCAL) {
    console.log("📍 LOCAL mode: Using environment variables");

    const key = process.env.ENCRYPTION_KEY;
    const iv = process.env.ENCRYPTION_IV;

    if (!key || !iv) {
      console.error(
        "❌ LOCAL mode ERROR: ENCRYPTION_KEY or ENCRYPTION_IV not set",
      );
      console.error("   Required environment variables:");
      console.error("   - ENCRYPTION_KEY (16, 24, or 32 characters)");
      console.error("   - ENCRYPTION_IV (16 characters)");
      return null;
    }

    // Validate key and IV lengths
    if (![16, 24, 32].includes(key.length)) {
      console.error(
        `❌ LOCAL mode ERROR: ENCRYPTION_KEY length must be 16, 24, or 32 (got ${key.length})`,
      );
      return null;
    }

    if (iv.length !== 16) {
      console.error(
        `❌ LOCAL mode ERROR: ENCRYPTION_IV length must be 16 (got ${iv.length})`,
      );
      return null;
    }

    console.log(
      `✅ LOCAL mode: Successfully loaded encryption config from environment`,
    );
    console.log(`   Key length: ${key.length}, IV length: ${iv.length}`);

    return {
      Encryption_Key: key,
      Encryption_Iv: iv,
    };
  }

  // ========================================
  // SERVER MODE: Use Redis ONLY - NO fallback
  // ========================================
  console.log("📍 SERVER mode: Using Redis (NO env var fallback)");

  const redis = getRedisClient();

  if (!redis) {
    console.error("❌ SERVER mode ERROR: Redis client not available");
    console.error("   REDIS_HOST is set but Redis connection failed");
    console.error(
      "   Check REDIS_HOST, REDIS_PORT, REDIS_PASSWORD configuration",
    );
    return null;
  }

  try {
    // Determine environment name for Redis key
    // Priority: RUNTIME_ENV > NODE_ENV > 'Development' (fallback)
    const runtimeEnv =
      process.env.RUNTIME_ENV || process.env.NODE_ENV || "development";
    const env =
      runtimeEnv === "production"
        ? "Production"
        : runtimeEnv === "test"
          ? "Test"
          : "Development";

    // Build cache key matching C# pattern: CacheLoader:{env}:ScanItemActions:{org}
    let cacheKey = `CacheLoader:${env}:ScanItemActions:${org}`;
    if (actionId) {
      cacheKey = `CacheLoader:${env}:ScanItemActions:${org}:${actionId}`;
    }
    console.log(`   Redis key: ${cacheKey}, action_id=[${actionId}]`);

    const configJson = await getAsync(cacheKey);

    if (!configJson) {
      console.error(
        `❌ SERVER mode ERROR: Encryption config not found in Redis`,
      );
      console.error(`   Key: ${cacheKey}`);
      console.error(`   Organization: ${org}`);
      console.error(`   Environment: ${env}`);
      console.error(`   `);
      console.error(`   ACTION REQUIRED:`);
      console.error(`   Populate Redis with encryption keys using:`);
      console.error(
        `   redis-cli SET "${cacheKey}" '{"Encryption_Key":"your-key","Encryption_Iv":"your-iv"}'`,
      );
      console.error(`   `);
      console.error(
        `   ⚠️  NO FALLBACK TO ENVIRONMENT VARIABLES IN SERVER MODE`,
      );
      return null;
    }

    // Parse Redis response
    const rawConfig: any = JSON.parse(configJson);
    console.log("✓ Redis config fetched successfully");

    // Support both naming conventions:
    // 1. PascalCase: Encryption_Key, Encryption_Iv (C# convention)
    // 2. lowercase: encryption_key, encryption_iv (common convention)
    const config: EncryptionConfig = {
      Encryption_Key:
        rawConfig.Encryption_Key || rawConfig.encryption_key || "",
      Encryption_Iv: rawConfig.Encryption_Iv || rawConfig.encryption_iv || "",
    };

    // Validate we got the keys
    if (!config.Encryption_Key || !config.Encryption_Iv) {
      console.error(
        "❌ SERVER mode ERROR: Invalid encryption config from Redis",
      );
      console.error(
        "   Expected fields: Encryption_Key, Encryption_Iv (or lowercase)",
      );
      console.error("   Got:", rawConfig);
      console.error(`   `);
      console.error(`   ACTION REQUIRED:`);
      console.error(`   Update Redis value to include both fields:`);
      console.error(
        `   redis-cli SET "${cacheKey}" '{"Encryption_Key":"your-key","Encryption_Iv":"your-iv"}'`,
      );
      console.error(`   `);
      console.error(
        `   ⚠️  NO FALLBACK TO ENVIRONMENT VARIABLES IN SERVER MODE`,
      );
      return null;
    }

    // Validate key and IV lengths
    if (![16, 24, 32].includes(config.Encryption_Key.length)) {
      console.error(
        `❌ SERVER mode ERROR: Encryption_Key length must be 16, 24, or 32 (got ${config.Encryption_Key.length})`,
      );
      console.error(`   Update Redis value with correct key length`);
      return null;
    }

    if (config.Encryption_Iv.length !== 16) {
      console.error(
        `❌ SERVER mode ERROR: Encryption_Iv length must be 16 (got ${config.Encryption_Iv.length})`,
      );
      console.error(`   Update Redis value with correct IV length`);
      return null;
    }

    console.log(
      `✅ SERVER mode: Successfully loaded encryption config from Redis`,
    );
    console.log(
      `   Key length: ${config.Encryption_Key.length}, IV length: ${config.Encryption_Iv.length}`,
    );

    return config;
  } catch (error) {
    console.error(
      "❌ SERVER mode ERROR: Failed to fetch encryption config from Redis",
    );
    console.error(
      "   Error:",
      error instanceof Error ? error.message : "Unknown error",
    );
    console.error(`   `);
    console.error(`   ⚠️  NO FALLBACK TO ENVIRONMENT VARIABLES IN SERVER MODE`);
    console.error(`   `);
    console.error(`   Troubleshooting:`);
    console.error(`   1. Verify Redis is accessible`);
    console.error(
      `   2. Check Redis credentials (REDIS_HOST, REDIS_PORT, REDIS_PASSWORD)`,
    );
    console.error(`   3. Ensure encryption keys exist in Redis`);
    return null;
  }
}

// Default export for convenience
export default {
  getRedisClient,
  setAsync,
  getAsync,
  setObjectAsync,
  getObjectAsync,
  publishMessageAsync,
  deleteAsync,
  closeRedisConnection,
  isRedisAvailable,
  getEncryptionConfig,
  getDeploymentMode,
  validateConfiguration,
};
