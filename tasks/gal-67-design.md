# GAL-67 Design: Listing comments, @mentions, and inbox drawer

Alpha scope, no auth beyond X-App-Token; identity is state.activePerson sent as person_id. Out of scope (GAL-52): SMS/email, DM/visibility modes, edit/delete, realtor rules. Authored by Fable 5, implemented by Opus. No em dashes.

## A. Schema (server.py init_db, after listing_place_attachments)

```sql
CREATE TABLE IF NOT EXISTS listing_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL,
    listing_address TEXT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_listing ON listing_comments(listing_id);
CREATE TABLE IF NOT EXISTS comment_mentions (
    comment_id INTEGER NOT NULL REFERENCES listing_comments(id),
    person_id INTEGER NOT NULL REFERENCES people(id),
    PRIMARY KEY (comment_id, person_id)
);
CREATE TABLE IF NOT EXISTS comment_reads (
    comment_id INTEGER NOT NULL REFERENCES listing_comments(id),
    person_id INTEGER NOT NULL REFERENCES people(id),
    read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (comment_id, person_id)
);
```

Read state = per (person, comment) receipts (missing row = unread). Exact counts, per-item dismissal. listing_address denormalized at post (server has no address lookup for Repliers ids; client always knows it). Inbox for person P = comments authored by someone other than P that P has not read, newest first, with a mentioned flag. unread_count = size of that set.

## B. Endpoints (require_auth, JSON, existing dispatch style)

- GET /api/comments?listing_ids=a,b,c -> {"comments": {id: [{id, listing_id, person_id, person_name, body, mentions:[ids], created_at}...]}}. Every requested id gets a (possibly empty) list, ORDER BY c.id ASC (newest last). Helper comments_for_listings, modeled on attachments_for_listings.
- POST /api/comments {person_id, listing_id, body, listing_address?} -> parse mentions, insert comment + comment_mentions, 200 {ok, id, created_at, mentions}. Validate: non-empty body <=4000; person_exists; known listing.
- GET /api/inbox?person_id=N -> {"inbox": [{id, listing_id, listing_address, body, created_at, author_id, author_name, mentioned}], "unread_count": N}. Query: comments where person_id != P and no comment_reads row for P; LEFT JOIN comment_mentions for the mentioned flag; ORDER BY c.id DESC LIMIT 100. unread_count = COUNT of same set (no limit).
- POST /api/comments/read {person_id, comment_id XOR listing_id} -> INSERT OR IGNORE receipts (listing form marks all comments on the listing not authored by the person); 200 {ok, unread_count} recomputed.

## C. @mention model

Raw body keeps @Name tokens; comment_mentions holds resolved ids. parse_mentions(conn, body): load people sorted by len(name) DESC then id ASC; at each "@", match case-insensitive longest name with a word boundary after; first match wins (so "Mary Ann" beats "Mary"); dedup. Unmatched @tokens are plain text.

Client typeahead in the composer: detect the active @token (from the last "@" at start or after whitespace, through the caret, no newline); filter state.people by name prefix; dropdown div.mention-menu; Arrow/Enter/Tab/click pick; picking replaces the partial with "@Name ". The composer must NOT use class feedback-compose (the global Enter delegate targets that); it handles its own Enter (pick if menu open, else post; Shift+Enter newline; stopPropagation).

Render highlight: esc() the body, then wrap mentions via a roster regex (names longest-first, escaped): `new RegExp('@(' + names.join('|') + ')(?![A-Za-z0-9])', 'gi')` -> `<span class="mention">@$1</span>`; the active person's mentions also get mention-me.

## D. Client data flow (app.js)

state += comments:{}, inbox:[], unreadCount:0. fetchComments(ids) clone of fetchFeedback hitting /api/comments; call it in load() and reloadListingsPreservingMapView alongside the other batch fetches. Card: add .card-discussion div in cardTemplate after cf-feedbackActions; a CARD_FIELDS entry {key:'discussion', group:'opinions', label:'Discussion', defaultOn:true}. buildDiscussion(node,item): thread (author + timestamp + highlighted body, newest last) + composer (textarea + Post + typeahead) when activePerson set, else the "select who you are" prompt. Post -> POST /api/comments, refetch that listing's comments, re-render card, refreshInbox().

## E. Inbox drawer UI

Topbar (before reportIssueBtn): `<button class="icon-btn inbox-btn" id="inboxBtn" title="Inbox">✉<span class="filter-badge" id="inboxBadge" hidden></span></button>`. .inbox-btn{position:relative} so the filter-badge rules render the count. Drawer = settings-drawer pattern (overlay + aside), rows are buttons "{author} on {address}: {snippet}" plus date and an "@ you" chip when mentioned. Tap -> POST /api/comments/read {person_id, listing_id}, update badge, close drawer, showMapCard(findListing(listing_id)) (graceful miss message if not loaded). refreshInbox() on: after loadPeople, in setActivePerson, after posting, after mark-read (use returned unread_count), on drawer open. updateInboxBadge mirrors updateFilterBadge (hidden at 0, cap "99+"). Six widths: verify topbar does not wrap at 390 (shrink who-am-i if tight); mention-menu max-height ~160px overflow-y auto width 100%.

## F. Tests (test_server.py, ServerTestCase; seed Mark=1 Katie=2 Anees=3 Kevin=4)

CommentTests: post records author + mentions; name-with-spaces resolves; longest-name-first ambiguity; batch get per-listing newest-last + empty list; unknown person 400; invalid/empty body + unknown listing 400; auth required 401.
InboxTests: inbox lists mentions + unseen for the person only (author excluded); mark-read by comment_id drops item + decrements; mark by listing_id marks all + idempotent; read state per person; auth 401 + unknown person 400 + both keys 400.

## G. Checklist

1. Save this doc. 2. server tables. 3. helpers parse_mentions/comments_for_listings/inbox_for_person + handlers handle_comment_post/handle_comment_read_post. 4. GET/POST routes. 5. tests, run. 6. index.html topbar button + drawer + .card-discussion. 7. styles. 8. app.js state + fetchComments + CARD_FIELDS + buildDiscussion + mention highlight + refreshInbox/openInbox/row tap + hooks. 9. full tests. 10. deploy + six-width verify.

Risks: the global Enter delegate targets .feedback-compose (composer must avoid that class); showMapCard graceful miss when listing not loaded; keep .card-discussion distinct from the notes section; INSERT OR IGNORE keeps reads idempotent; deploy.sh after every change.
