"""A stored market may carry keys this build no longer knows about.

Fields get removed - `source_data` in E02, the Discord pair in E18/F05 - and the documents that
carried them are still in the database. Decoding must ignore them rather than refuse, because a
market this build cannot parse is a market that vanishes from every list it belongs to.

This is deliberately asserted rather than assumed: `market_from_document` is strict in places, and
an unexpected stored key has taken down a market list in this project before.
"""
from market_documents import market_from_document
from tests.conftest import stored_market


def test_a_market_carrying_the_removed_discord_keys_still_decodes():
    doc = stored_market(
        discordGuildId="123456789012345678",
        discordWebhookUrl="https://discord.com/api/webhooks/abc/xyz",
    )

    market = market_from_document(doc)

    assert market.name
    assert not hasattr(market, "discord_guild_id")
    assert not hasattr(market, "discord_webhook_url")
    assert not [key for key in market.model_dump(by_alias=True) if "iscord" in key]


def test_a_market_carrying_an_entirely_unknown_key_still_decodes():
    market = market_from_document(stored_market(somethingNobodyHasWrittenYet={"a": 1}))

    assert market.name
