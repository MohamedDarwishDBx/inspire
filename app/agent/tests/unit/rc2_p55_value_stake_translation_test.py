"""REQ-208: "Value at stake" has a translation in every language of the curated translations, so the document labels that ask for
it localize the same way as the other doc_ keys. The key resolves to the English source when a language lacks it."""
import json
import os

import pytest

from v120_artifacts_support import make_inspire

SHELL = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "agent", "app_shell")
KEY = "doc_value_at_stake"
TRANSLATIONS = json.load(open(os.path.join(SHELL, "translations.json"), encoding="utf-8"))


def test_every_language_carries_the_value_at_stake_label_and_it_is_not_the_english_text():
    assert len(TRANSLATIONS) == 22
    for language, labels in TRANSLATIONS.items():
        assert labels.get(KEY, "").strip(), language
        if language not in ("Malay", "Indonesian"):
            assert labels[KEY] != "Value at stake", f"{language} still shows the English label"


@pytest.mark.parametrize("language,expected", [
    ("Spanish", "Valor en riesgo"), ("Japanese", "リスクにさらされている価値"), ("Arabic", "القيمة المعرضة للخطر"),
])
def test_the_document_text_lookup_returns_the_translated_label_for_that_language(agent_ns, language, expected):
    inst = make_inspire(agent_ns)
    assert inst._doc_text(TRANSLATIONS[language], KEY, language) == expected


def test_a_language_without_the_label_and_the_english_name_both_fall_back_to_the_english_source(agent_ns):
    inst = make_inspire(agent_ns)
    assert inst._doc_text({}, KEY, "English") == "Value at stake"
    assert inst._doc_text({}, KEY, "Klingon") == "Value at stake"
