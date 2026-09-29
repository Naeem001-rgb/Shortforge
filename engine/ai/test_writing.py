import unittest
from unittest.mock import patch

from engine.ai.writing import original_script, rewrite_script, seo_pack, within_tolerance, word_bounds, word_count


class WritingTests(unittest.TestCase):
    def test_word_count_and_inclusive_five_percent_boundary(self):
        text = " ".join(["word"] * 100)
        self.assertEqual(word_count("one\n two\tthree"), 3)
        self.assertTrue(within_tolerance(text, "word " * 95))
        self.assertTrue(within_tolerance(text, "word " * 105))
        self.assertFalse(within_tolerance(text, "word " * 94))
        self.assertFalse(within_tolerance(text, "word " * 106))
        self.assertEqual(word_bounds("word " * 19), (19, 19))
        self.assertFalse(within_tolerance("", ""))

    def test_retry_corrects_length_and_stops_after_success(self):
        responses = iter(["too short", "new " * 100])
        prompts = []
        def fake(prompt, settings):
            prompts.append(prompt)
            return next(responses)
        result = rewrite_script("old " * 100, {}, generate=fake)
        self.assertEqual(result["attempts"], 2)
        self.assertTrue(result["within_tolerance"])
        self.assertIn("previous output had 2 words", prompts[1])

    def test_failed_retries_report_honest_count(self):
        calls = []
        def fake(prompt, settings):
            calls.append(prompt)
            return "short"
        result = rewrite_script("old " * 100, {}, generate=fake)
        self.assertEqual(len(calls), 3)
        self.assertEqual(result["words_rewritten"], 1)
        self.assertFalse(result["within_tolerance"])

    def test_seo_keeps_verified_attribution(self):
        response = '{"titles":[{"title":"A fact","reason":"Clear"},{"title":"A second fact","reason":"Clear"},{"title":"A third fact","reason":"Clear"}],"description":"A useful explanation.","tags":["Science","Space","Facts"]}'
        with patch("engine.ai.writing.gemini_generate", return_value=response):
            result = seo_pack({"license_status": "cc_by", "channel_name": "Creator", "url": "https://youtube.com/shorts/abcdefghijk"}, "facts", {})
        self.assertIn("Credit: Creator", result["description"])
        self.assertIn("Licensed CC BY", result["description"])
        self.assertIn("#Shorts", result["description"])
        self.assertEqual(result["titles"][0]["characters"], 6)

    def test_seo_rejects_overlong_titles(self):
        import json
        response = json.dumps({"titles": [{"title": "x" * 101, "reason": "Long"}] * 3, "description": "Text", "tags": ["Facts"]})
        with patch("engine.ai.writing.gemini_generate", return_value=response):
            with self.assertRaises(ValueError):
                seo_pack({"license_status": "owned"}, "facts", {})


if __name__ == "__main__":
    unittest.main()
