from pydantic_settings import BaseSettings
import os


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./data/epc.db"
    SECRET_KEY: str = "change-me-in-production-use-a-real-secret"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    DATA_DIR: str = os.path.join(os.getcwd(), "data")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
