from functools import lru_cache
import secrets

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Application
    app_env: str = "development"

    # Database
    database_url: str = ""

    # Authentication
    jwt_secret: str = ""
    jwt_refresh_secret: str = ""
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    # OTP
    otp_expire_minutes: int = 10
    dev_show_otp: bool = False

    # Frontend
    frontend_url: str = "http://localhost:4200"

    # Email
    email_provider: str = "noop"
    email_api_key: str = ""
    email_from: str = ""

    # SMS
    sms_provider: str = "noop"
    sms_api_key: str = ""
    sms_from: str = ""

    @model_validator(mode="after")
    def validate_settings(self):
        # Normalize provider names
        self.email_provider = self.email_provider.strip().lower()
        self.sms_provider = self.sms_provider.strip().lower()

        # ---------------------------------------------------------
        # Authentication security
        # ---------------------------------------------------------

        if self.app_env != "development":
            if len(self.jwt_secret) < 32:
                raise ValueError(
                    "JWT_SECRET must contain at least 32 characters."
                )

            if len(self.jwt_refresh_secret) < 32:
                raise ValueError(
                    "JWT_REFRESH_SECRET must contain at least 32 characters."
                )

            if self.jwt_secret == self.jwt_refresh_secret:
                raise ValueError(
                    "JWT_SECRET and JWT_REFRESH_SECRET must be different."
                )

            if self.dev_show_otp:
                raise ValueError(
                    "DEV_SHOW_OTP cannot be enabled outside development."
                )

        # Generate temporary secrets for local development only.
        if not self.jwt_secret:
            self.jwt_secret = secrets.token_urlsafe(48)

        if not self.jwt_refresh_secret:
            self.jwt_refresh_secret = secrets.token_urlsafe(48)

        # ---------------------------------------------------------
        # Email configuration
        # ---------------------------------------------------------

        supported_email_providers = {
            "noop",
            "resend",
        }

        if self.email_provider not in supported_email_providers:
            raise ValueError(
                f"Unsupported EMAIL_PROVIDER: {self.email_provider}"
            )

        if self.email_provider == "resend":
            if not self.email_api_key.strip():
                raise ValueError(
                    "EMAIL_API_KEY is required when EMAIL_PROVIDER=resend."
                )

            if not self.email_from.strip():
                raise ValueError(
                    "EMAIL_FROM is required when EMAIL_PROVIDER=resend."
                )

        # ---------------------------------------------------------
        # SMS configuration
        # ---------------------------------------------------------

        supported_sms_providers = {
            "noop",
        }

        if self.sms_provider not in supported_sms_providers:
            raise ValueError(
                f"Unsupported SMS_PROVIDER: {self.sms_provider}"
            )

        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()