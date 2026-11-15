from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_service_role_key: str = ""
    database_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = ""
    gemini_thinking_level: str = "low"   # minimal | low | medium | high ("" = model default)
    gemini_embedding_model: str = "gemini-embedding-001"
    embedding_dim: int = 768
    cors_origins: str = "http://localhost:3000"

    rate_limit_ai: str = "20/minute"
    rate_limit_default: str = "120/minute"
    rate_limit_admin: str = "10/minute"

    retrieval_max_results: int = 15
    assistant_max_tool_rounds: int = 5
    assistant_max_history_turns: int = 8
    assistant_max_output_tokens: int = 4096
    assistant_max_context_chars: int = 24000
    validation_rel_tol: float = 1e-3
    max_upload_mb: int = 60

    storage_documents_bucket: str = "research-documents"
    storage_figures_bucket: str = "research-figures"
    storage_datasets_bucket: str = "research-datasets"
    signed_url_seconds: int = 3600

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_model)


@lru_cache
def get_settings() -> Settings:
    return Settings()
