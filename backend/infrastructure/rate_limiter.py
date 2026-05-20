import time
from fastapi import HTTPException
from backend.infrastructure.logging import get_logger

log = get_logger("rate_limiter")

class RateLimiter:
    """Sliding window rate limiter using Redis."""
    
    def __init__(self, redis_client, default_max_requests=60, window_seconds=60):
        self.redis = redis_client
        self.default_max = default_max_requests
        self.window = window_seconds
    
    async def check(self, identifier: str, max_requests: int = None):
        """
        Check if request is within rate limit.
        identifier: session_id or user_id
        Raises HTTPException(429) if limit exceeded.
        """
        if not self.redis:
            return
            
        max_req = max_requests or self.default_max
        key = f"aura:rl:{identifier}"
        
        now = time.time()
        
        try:
            pipe = self.redis.pipeline()
            
            # Remove old entries outside window
            pipe.zremrangebyscore(key, 0, now - self.window)
            # Add current request
            pipe.zadd(key, {str(now): now})
            # Count requests in window
            pipe.zcard(key)
            # Set TTL on the key
            pipe.expire(key, self.window)
            
            results = await pipe.execute()
            request_count = results[2]
            
            if request_count > max_req:
                log.warning("rate_limit_exceeded", identifier=identifier, count=request_count, limit=max_req)
                raise HTTPException(
                    status_code=429,
                    detail={
                        "error": "Rate limit exceeded",
                        "limit": max_req,
                        "window_seconds": self.window,
                        "retry_after_seconds": self.window,
                    }
                )
        except HTTPException:
            raise
        except Exception as e:
            log.warning("rate_limiter_failed", error=str(e), identifier=identifier)
            # Fail-open
            pass
            
    async def get_remaining(self, identifier: str, max_requests: int = None) -> int:
        if not self.redis:
            return max_requests or self.default_max
            
        max_req = max_requests or self.default_max
        key = f"aura:rl:{identifier}"
        now = time.time()
        
        try:
            await self.redis.zremrangebyscore(key, 0, now - self.window)
            count = await self.redis.zcard(key)
            return max(0, max_req - count)
        except Exception as e:
            log.warning("rate_limiter_get_remaining_failed", error=str(e), identifier=identifier)
            return max_req
