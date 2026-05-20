"""
AURA Structured Logging — JSON-formatted logs for all backend components.

Usage:
    from logging_config import setup_logging, get_logger
    setup_logging(env="production")  # Call once at startup
    log = get_logger("server")       # Per-module logger
    log.info("analyze_request", session_id="abc", duration_ms=4.2)
"""

import structlog
import logging
import sys


def setup_logging(env: str = "production"):
    """Configure structured logging for all AURA backend components."""
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]
    if env == "development":
        renderer = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=shared_processors + [
            structlog.processors.format_exc_info,
            renderer,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=logging.INFO)


def get_logger(component: str):
    """Get a logger bound to a component name."""
    return structlog.get_logger(component=component)
