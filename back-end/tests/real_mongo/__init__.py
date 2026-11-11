"""The back end's tests against a real MongoDB server (``docs/implementation/testing/real-mongo-suite.md``).

A package, so its ``conftest`` is ``real_mongo.conftest`` and never takes the name ``conftest``
from ``tests/conftest.py``, which the suite's test modules import their helpers from.
"""
