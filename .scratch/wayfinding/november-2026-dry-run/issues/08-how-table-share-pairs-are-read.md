# 08: How is a table-share request read?

Type: grilling
Status: resolved
Blocked by: 03

## Question

Surfaced while grilling [07](07-what-counts-as-a-pass.md).
"If you chose half table, do you have anyone you would like to share a full table with? Please enter the exact email address they submitted" was answered by 55 applicants, and many did not type a bare address.
What makes two applicants a pair, and what does the product do with an answer it cannot use?

What the product does today (`dev` at `ea29bb67`):

- The answer is stored as typed and never validated (`_store_table_share_email`, `back-end/essential_fields.py`).
- The solver pairs by exact string equality, case included (`get_table_share_vendor`, `back-end/assignment/assignment.py`), so an address inside a sentence, or in different case, pairs nobody.
- Only the vendor who named a partner is checked for not being full-table-only; the partner's table choice is never checked, so a full-only vendor can be put on a half table.
- An answer that pairs nobody silently becomes an ordinary half-table request, and the organizer is not told.

The 55 answers in this file: 29 the exact address of an applicant; 4 the address alone in different case or spacing; 8 an applicant's address inside a sentence; 2 an address that is no applicant's; 12 no address at all.
Of the 41 that name an applicant, 37 are pairs where both may take a half table (34 name each other, 3 one-way), and 4 involve a full-only partner.

## Answer

Decided with the user on 2026-10-09.

- **A pair needs both applicants to exist, identified by email, and both to accept a half table** (Half or Either, never Full only).
- **The address is extracted where an application is written**, by the import and the online form alike: the one address in the answer, lowercased, so "I want to share with x@y.com" pairs. The original wording stays visible to the organizer.
- **One-way is enough**: if A names B, they are paired, whether or not B named anyone.
- **A person's own request wins**: if A names B and B names C, B sits with C (if valid), and A gets an ordinary half-table match.
- **An answer that pairs nobody is shown, never blocking**: on the review card and in the vendor's detail ("asked to share with X, not found"), so the organizer can follow up. The import and the run go ahead.
- **Built before the run**, test-first, so the rehearsal walks the pairing the market wants: [E27 A table-share request finds its partner](../../../backlog/E27-table-share-pairs/epic.md).

### Amended 2026-10-09, during the rehearsal

The import showed 5 answers naming two different addresses: 2 an applicant beside an address nobody applied with (likely the partner's personal and school addresses), 3 two applicants.
The original answer read "the one address in the answer", which paired all 5 with nobody.
Decided with the user: **the first address that belongs to an applicant is the partner**, even when both do, and the notice says the other applicant named was not used.
The write keeps every address in the order written; the choice is made when pairs are read, because who applied can change after the answer is saved.

Also decided with the user during the rehearsal: **the half-table share never blocks a pair.** Pairs are exceptions to it; the share still bounds everyone who chose either and has no partner.
It surfaced as two pairs split on 18 November, when Gold had used its share and the either chooser of each pair was given a whole table.

