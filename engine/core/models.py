"""Validate user input before it reaches a file, job, or database."""

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ClipInput(BaseModel):
    # The extension may send additional metadata; privilege fields are ignored.
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)
    video_id: str | None = Field(default=None, max_length=11)
    url: str = Field(default="", max_length=2048)
    channel_name: str = Field(default="", max_length=300)
    channel_handle: str = Field(default="", max_length=300)
    title: str = Field(default="", max_length=1000)
    description: str = Field(default="", max_length=20000)
    likes: int | None = Field(default=None, ge=0, le=9223372036854775807)
    views: int | None = Field(default=None, ge=0, le=9223372036854775807)
    published_at: str | None = Field(default=None, max_length=100)
    credit_target: str = Field(default="", max_length=2048)
    credit_snippet: str = Field(default="", max_length=5000)
    thumbnail_url: str = Field(default="", max_length=2048)
    discovery_mode: Literal["credits", "narrated", "manual", "upload"] = "manual"


class ClipBatch(StrictModel):
    clips: list[ClipInput] = Field(min_length=1, max_length=100)


class ClipPatch(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=1000)
    license_status: Literal["permission", "unknown"] | None = None
    permission_note: str | None = Field(default=None, max_length=5000)
    workflow_status: Literal["collected", "downloaded", "transcribed", "editing", "exported", "archived"] | None = None


class TranscribeInput(StrictModel):
    model: Literal["base", "small"] | None = None


class ExtractScriptInput(StrictModel):
    provider: Literal["auto", "gemini"] = "auto"
    replace_existing: bool = False


class ClipDeleteInput(StrictModel):
    ids: list[str] = Field(min_length=1, max_length=200)

    @field_validator("ids")
    @classmethod
    def clean_ids(cls, value: list[str]) -> list[str]:
        # Repeats would be reported twice; blanks and runaway ids are junk.
        cleaned = list(dict.fromkeys(i for i in value if i))
        if not cleaned:
            raise ValueError("Choose at least one video to delete.")
        if any(len(i) > 64 for i in cleaned):
            raise ValueError("Unrecognized video reference.")
        return cleaned


class TranscriptWord(StrictModel):
    word: str = Field(min_length=1, max_length=200)
    start: float = Field(ge=0, allow_inf_nan=False)
    end: float = Field(ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.end < self.start:
            raise ValueError("A word's end must follow its start.")
        return self


class TranscriptInput(StrictModel):
    text: str = Field(max_length=200000)
    words: list[TranscriptWord] = Field(default_factory=list, max_length=30000)

    @model_validator(mode="after")
    def ordered_words(self):
        if any(right.start < left.start for left, right in zip(self.words, self.words[1:])):
            raise ValueError("Word timestamps must be in order.")
        return self


class SettingsPatch(StrictModel):
    gemini_model: str | None = Field(default=None, min_length=1, max_length=150, pattern=r"^[a-zA-Z0-9._-]+$")
    gemini_api_key: str | None = Field(default=None, max_length=500)
    youtube_api_key: str | None = Field(default=None, max_length=500)
    elevenlabs_api_key: str | None = Field(default=None, max_length=500)
    niche: str | None = Field(default=None, max_length=1000)
    language: str | None = Field(default=None, min_length=1, max_length=100)
    min_likes: int | None = Field(default=None, ge=0, le=1000000000)
    min_views: int | None = Field(default=None, ge=0, le=100000000000)
    target_count: int | None = Field(default=None, ge=1, le=500)
    scout_mode: Literal["credits", "narrated", "auto"] | None = None
    tts_provider: Literal["piper", "edge", "elevenlabs", "clone", "espeak"] | None = None
    piper_model: str | None = Field(default=None, max_length=4096)
    whisper_model: str | None = Field(default=None, max_length=4096)
    clone_model_path: str | None = Field(default=None, max_length=4096)
    clone_vocab_path: str | None = Field(default=None, max_length=4096)
    clone_config_path: str | None = Field(default=None, max_length=4096)

    @field_validator("piper_model", "whisper_model", "clone_model_path", "clone_vocab_path", "clone_config_path")
    @classmethod
    def no_null_bytes(cls, value):
        if value is not None and "\x00" in value:
            raise ValueError("A file path cannot contain null bytes.")
        return value
