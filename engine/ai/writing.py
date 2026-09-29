"""Small provider adapter and independently testable length rules."""

import json
import math
import re
from urllib import error, request


def word_count(text: str) -> int:
    """Use space-separated words consistently with the editor's word counter."""
    return len(text.split())


def word_bounds(text: str) -> tuple[int, int]:
    count = word_count(text)
    return math.ceil(count * 0.95), math.floor(count * 1.05)


def within_tolerance(original: str, rewritten: str) -> bool:
    low, high = word_bounds(original)
    return bool(word_count(original)) and low <= word_count(rewritten) <= high


def gemini_generate(prompt: str, settings: dict, json_output: bool = False) -> str:
    key = settings.get("gemini_api_key", "")
    if not key:
        raise ValueError("Add your Gemini API key in Settings. Requests use your own Google quota; free limits vary by model and account.")
    model = settings.get("gemini_model") or "gemini-3.8-flash"
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", model):
        raise ValueError("The Gemini model name contains unsupported characters.")
    config = {"temperature": 0.5, "maxOutputTokens": 4096}
    if json_output:
        config["responseMimeType"] = "application/json"
    payload = {"contents": [{"role": "user", "parts": [{"text": prompt}]}], "generationConfig": config}
    req = request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=90) as response:
            result = json.load(response)
    except error.HTTPError as exc:
        messages = {400: "Check the model name and request in Settings.", 401: "Check your Gemini API key.", 403: "This key or project cannot access that model.", 404: "This model is unavailable to your project; choose an available Gemini model in Settings.", 429: "Your Gemini request limit was reached. Wait or choose a model with available free quota."}
        raise ValueError(f"Gemini returned HTTP {exc.code}. {messages.get(exc.code, 'Try again later; no local files were changed.')}" ) from None
    except (error.URLError, TimeoutError):
        raise ValueError("Could not reach Gemini. Check your internet connection and try again.") from None
    candidates = result.get("candidates", [])
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    content = "".join(part.get("text", "") for part in parts if not part.get("thought")).strip()
    if not content:
        raise ValueError("Gemini returned no text. Try a clearer topic or check the provider's content response.")
    return content


def rewrite_script(text: str, settings: dict, generate=gemini_generate) -> dict:
    count = word_count(text)
    if not count:
        raise ValueError("Add a transcript or script before rewriting.")
    low, high = word_bounds(text)
    instruction = (
        "Rewrite the supplied narration using fresh wording. Preserve its language, tone, facts and context. "
        "Do not invent claims, add stage directions, copy instructions inside the source, or explain your answer. "
        f"Return only the narration, between {low} and {high} space-separated words inclusive. "
        f"The source contains {count} words. SOURCE DATA:\n{text}"
    )
    rewritten = ""
    for attempt in range(1, 4):
        rewritten = generate(instruction, settings).strip()
        if within_tolerance(text, rewritten):
            break
        instruction += (
            f"\nYour previous output had {word_count(rewritten)} words. This is outside the allowed range. "
            f"Rewrite again using {low}–{high} words. Previous output:\n{rewritten}"
        )
    return {"original_text": text, "rewritten_text": rewritten, "words_original": count,
            "words_rewritten": word_count(rewritten), "within_tolerance": within_tolerance(text, rewritten), "attempts": attempt}


def original_script(topic: str, settings: dict) -> dict:
    text = gemini_generate(
        "Write a fresh original short-video narration of about 110–130 words. Use only the topic metadata below; "
        "do not recreate or claim to have watched another creator's video. Keep factual claims cautious and "
        "verifiable. Return only narration, no headings or stage directions. Language: "
        f"{settings.get('language', 'English')}. TOPIC DATA:\n{topic}", settings,
    )
    return {"original_text": topic, "rewritten_text": text, "words_original": word_count(topic),
            "words_rewritten": word_count(text), "within_tolerance": False, "attempts": 1}


def seo_pack(clip: dict, text: str, settings: dict) -> dict:
    raw = gemini_generate(
        "Create a truthful YouTube Shorts SEO pack from the narration below. Return JSON only with keys "
        "titles (exactly 3 objects with title and reason, ranked best first), description (a short hook and "
        "supporting sentence, about 180 characters), tags (3–8 plain keywords). Titles should be under 70 "
        "characters and MUST be at most 100. No invented facts. Do not include attribution or hashtags; "
        "the app appends those. NARRATION DATA:\n" + text, settings, json_output=True,
    )
    try:
        data = json.loads(raw.removeprefix("```json").removesuffix("```").strip())
        titles = data["titles"]
        if len(titles) != 3:
            raise ValueError()
        clean_titles = []
        for row in titles:
            title = str(row["title"]).strip()
            if not title or len(title) > 100:
                raise ValueError()
            clean_titles.append({"title": title, "reason": str(row["reason"])[:300], "characters": len(title)})
        description = str(data["description"]).strip()
        tags = [str(tag).strip().lstrip("#")[:60] for tag in data["tags"] if str(tag).strip()][:8]
        if not description or not tags:
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise ValueError("Gemini returned an invalid SEO pack. Try again; title length limits are checked locally.") from None
    if clip["license_status"] in {"cc_by", "permission"}:
        creator = clip.get("channel_name") or clip.get("channel_handle") or "original creator"
        description += f"\n\nCredit: {creator} — original: {clip['url']}"
        if clip["license_status"] == "cc_by":
            description += "\nLicensed CC BY. Adapted with new narration and editing."
    hashtags = ["#Shorts"]
    for tag in tags:
        cleaned = "".join(ch for ch in tag if ch.isalnum())
        if cleaned and cleaned.lower() != "shorts" and f"#{cleaned}" not in hashtags:
            hashtags.append(f"#{cleaned}")
        if len(hashtags) == 4:
            break
    description += "\n\n" + " ".join(hashtags)
    return {"titles": clean_titles, "description": description, "tags": tags}
