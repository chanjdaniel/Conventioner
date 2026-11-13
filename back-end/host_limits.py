"""The host's limits on one request, which the back end holds to as its own (T315).

Production runs on Vercel's functions, which refuse a request body over 4.5 MB before Flask sees it
(https://vercel.com/docs/functions/limitations); "4.5 MB" is read as decimal, 4,500,000 bytes, the
lower of its two readings. The back end's ``MAX_CONTENT_LENGTH`` is the same bound, so a local stack
refuses what production would, and ``client_errors.install_error_answers`` answers a larger body
with ``REQUEST_TOO_LARGE``, a sentence a screen reads.

What sits under it: the floorplan upload's file (``floorplan_limits.MAX_UPLOAD_BYTES``) and the
responses file the import and the start send (``MAX_RESPONSES_FILE_BYTES`` in
``front-end/src/utils/csvFile.ts``) are each held to 4 MB, leaving the rest for the request's other
fields. The host's limits, and the one this bound does not hold, are in docs/OPERATIONS.md.
"""

MAX_REQUEST_BODY_BYTES = 4_500_000

REQUEST_TOO_LARGE = "This is larger than the 4.5 MB one request can carry."
