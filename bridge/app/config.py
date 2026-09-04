"""Bridge backend configuration via environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Bridge backend settings — loaded from environment or .env file."""

    # ── Bridge Server ──
    bridge_host: str = "0.0.0.0"
    bridge_port: int = 8000

    # ── ContextForge Gateway Connection ──
    cf_base_url: str = "http://localhost:4444"
    cf_admin_token: str = ""  # Pre-generated admin JWT for CF API calls

    # ── JWT for your own client-facing tokens ──
    bridge_jwt_secret: str = "bridge-dev-secret-change-in-production"
    bridge_jwt_algorithm: str = "HS256"
    bridge_jwt_expiry_minutes: int = 480

    # ── Security ──
    bridge_cors_origins: list[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ]

    model_config = {
        "env_file": [".env", "bridge/.env"],
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
