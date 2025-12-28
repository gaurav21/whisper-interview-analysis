/**
 * Structured logging utility
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

/**
 * Logger class with structured logging support
 */
export class Logger {
  private context: LogContext;
  private environment: string;

  constructor(context: LogContext = {}, environment: string = "development") {
    this.context = context;
    this.environment = environment;
  }

  /**
   * Creates a child logger with additional context
   */
  child(additionalContext: LogContext): Logger {
    return new Logger(
      { ...this.context, ...additionalContext },
      this.environment
    );
  }

  /**
   * Logs a debug message
   */
  debug(message: string, meta?: LogContext): void {
    this.log("debug", message, meta);
  }

  /**
   * Logs an info message
   */
  info(message: string, meta?: LogContext): void {
    this.log("info", message, meta);
  }

  /**
   * Logs a warning message
   */
  warn(message: string, meta?: LogContext): void {
    this.log("warn", message, meta);
  }

  /**
   * Logs an error message
   */
  error(message: string, error?: Error | unknown, meta?: LogContext): void {
    const errorMeta = error instanceof Error
      ? {
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        }
      : { error };

    this.log("error", message, { ...meta, ...errorMeta });
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, meta?: LogContext): void {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      environment: this.environment,
      ...this.context,
      ...meta,
    };

    // In production, you might want to send these to a logging service
    // For now, we'll use console with appropriate methods
    switch (level) {
      case "debug":
        if (this.environment === "development") {
          console.debug(JSON.stringify(logEntry));
        }
        break;
      case "info":
        console.log(JSON.stringify(logEntry));
        break;
      case "warn":
        console.warn(JSON.stringify(logEntry));
        break;
      case "error":
        console.error(JSON.stringify(logEntry));
        break;
    }
  }
}

/**
 * Creates a logger instance
 */
export function createLogger(
  context: LogContext = {},
  environment?: string
): Logger {
  return new Logger(context, environment);
}

