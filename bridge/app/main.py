"""Bridge Backend — connects your product to ContextForge MCP Gateway.

  Client App → Bridge Backend (this) → ContextForge → Upstream MCP/REST services
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(
    title="MCP Gateway Bridge API",
    description="Bridge layer connecting your product to ContextForge MCP Gateway.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.bridge_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "bridge"}
