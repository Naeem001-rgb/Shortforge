"""Canonical, platform-specific IDs and URLs for supported remote clips."""

import re
from urllib.parse import ParseResult, parse_qs, urlparse

from fastapi import HTTPException


YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
LINK_HINT = "Paste a public YouTube video, Shorts, or Instagram Reel link."


def _parse_url(url: str) -> ParseResult:
    # urlparse silently drops some control characters; reject them first.
    if any(character.isspace() or ord(character) < 32 or ord(character) == 127 for character in url):
        raise HTTPException(422, LINK_HINT)
    if any(url.lower().startswith(host + "/") for host in YOUTUBE_HOSTS | INSTAGRAM_HOSTS):
        url = "https://" + url
    try:
        parsed = urlparse(url)
        if (parsed.scheme not in {"https", "http"} or parsed.username is not None
                or parsed.password is not None or parsed.port is not None):
            raise HTTPException(422, LINK_HINT + " Links cannot contain credentials or custom ports.")
        return parsed
    except ValueError as exc:
        raise HTTPException(422, LINK_HINT) from exc


def canonical_youtube_url(url: str, video_id: str | None = None) -> tuple[str, str]:
    if not url and video_id:
        url = f"https://www.youtube.com/shorts/{video_id}"
    parsed = _parse_url(url)
    host = (parsed.hostname or "").lower()
    parts = parsed.path.strip("/").split("/")
    found = None
    if host in YOUTUBE_HOSTS - {"youtu.be"}:
        if parsed.path.rstrip("/") == "/watch":
            found = parse_qs(parsed.query).get("v", [None])[0]
        elif len(parts) == 2 and parts[0] in {"shorts", "embed", "live"}:
            found = parts[1]
    elif host == "youtu.be" and len(parts) == 1:
        found = parts[0]
    if not found or not re.fullmatch(r"[A-Za-z0-9_-]{11}", found):
        raise HTTPException(422, "This is not a valid YouTube video link (the video ID must be 11 characters).")
    if video_id and found != video_id:
        raise HTTPException(422, "The video ID does not match the YouTube link.")
    return found, f"https://www.youtube.com/shorts/{found}"


def canonical_clip_url(url: str, video_id: str | None = None) -> tuple[str, str]:
    """Namespaced Instagram IDs keep identical shortcodes separate from YouTube."""
    if not url and video_id:
        url = (f"https://www.instagram.com/reel/{video_id[3:]}/" if video_id.startswith("ig:")
               else f"https://www.youtube.com/shorts/{video_id}")
    parsed = _parse_url(url)
    host = (parsed.hostname or "").lower()
    if host in YOUTUBE_HOSTS:
        return canonical_youtube_url(url, video_id)
    if host in INSTAGRAM_HOSTS:
        match = re.fullmatch(r"/(?:reel|reels)/([A-Za-z0-9_-]{1,64})/?", parsed.path)
        if match:
            shortcode = match.group(1)
            identity = f"ig:{shortcode}"
            if video_id and identity != video_id:
                raise HTTPException(422, "The video ID does not match the Instagram Reel link.")
            return identity, f"https://www.instagram.com/reel/{shortcode}/"
    raise HTTPException(422, LINK_HINT)


def is_youtube_clip(clip: dict) -> bool:
    if not clip.get("video_id"):
        return False
    try:
        canonical_youtube_url(clip.get("url", ""), clip["video_id"])
        return True
    except HTTPException:
        return False


def instagram_thumbnail_url(url: str) -> str:
    """Keep signed Instagram CDN URLs; ignore arbitrary client image locations."""
    try:
        parsed = _parse_url(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme == "https" and any(host == domain or host.endswith("." + domain)
                                            for domain in ("cdninstagram.com", "fbcdn.net")):
            return url
    except HTTPException:
        pass
    return ""
