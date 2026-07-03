# House Hunter Alpha Data Model Notes

## Buyer identity model

A "buyer" in House Hunter is not always one person. It should be modeled as a buyer group or household with one to many named participants.

Examples:
- One buyer: solo purchaser
- Two buyers: couple
- Family: parents plus adult child
- Investor group: 3 to 5 participants
- Agent-assisted search: buyer group plus realtor/advisor participants
- Realtor team: lead agent, buyer agent, admin/coordinator, mortgage partner, inspector/referral partner

## Recommended tables

### buyer_groups
Represents the search entity, household, or purchasing group.

Fields:
- id
- display_name, e.g. "Mark and Katie Garrett", "Smith Family", "Anees Investor Group"
- primary_contact_user_id
- agent_user_id
- status
- created_at
- updated_at

### buyer_group_members
One row per named person in the buyer group.

Fields:
- id
- buyer_group_id
- user_id, nullable until the person has an account
- name
- email, nullable
- phone, nullable
- role, e.g. buyer, co_buyer, spouse, parent, investor, agent, advisor
- decision_weight, default 1.0
- is_decision_maker
- has_veto_power
- needs_accessibility_consideration
- is_primary_contact
- can_rate
- can_comment
- can_approve_showings
- created_at
- updated_at

## Map identity rule

The map must have an explicit "I am" selector populated from `buyer_group_members`.

When a user selects who they are:
- The map displays that person's own stars, notes, status, and saved view state.
- Any new star rating is recorded against that `buyer_group_member_id`.
- Any note is recorded against that `buyer_group_member_id`.
- Any rejection / "said no" is recorded against that `buyer_group_member_id` with reason.
- Any research request or review action is recorded against that `buyer_group_member_id`.
- The UI labels all actions as that person, e.g. "Katie said no", "Dad rated 4", "Anees flagged resale risk".

Never infer the actor from a shared browser session alone. The selected map identity is the actor for that action unless the authenticated user system later overrides it with stricter permissions.

For the alpha, identity has two layers:
1. Authenticated account: who logged in.
2. Active member context: who the action is being recorded as.

In a family search, one phone or tablet may be passed around. The active member context is what prevents all notes from becoming "Mark".

## Product direction

The alpha should be built around Anees as the first realtor-team workspace.

Decision:
- Customer path: realtor-led, buyer-collaborative.
- First workspace: Anees / Anees's realtor team.
- Galleon owns the app and IP.
- Repliers paid account/data access moves to Anees or his team when the investment/deal is ready.
- Free Repliers sample account can remain under Mark for prototype work.

This keeps the product grounded in one real team, one real buyer journey, and one real investment conversation.

## Realtor team model

A realtor account should also be modeled as a team, not a single person.

### realtor_teams
Represents the professional team serving one or many buyer groups.

Fields:
- id
- display_name, e.g. "Anees Steitieh Team", "North GTA Buyer Team"
- brokerage_name
- broker_of_record_name, nullable
- subscription_owner_member_id
- status
- created_at
- updated_at

### realtor_team_members
One row per person on the team.

Fields:
- id
- realtor_team_id
- user_id, nullable until invited
- name
- email
- phone
- role, e.g. lead_agent, buyer_agent, showing_agent, admin, coordinator, mortgage_partner, inspector, lawyer, advisor
- license_number, nullable
- brokerage_role, nullable
- can_view_clients
- can_comment
- can_rate_as_advisor
- can_request_research
- can_schedule_showings
- can_manage_team
- can_manage_subscription
- created_at
- updated_at

### buyer_group_realtor_team_assignments
Connects a buyer group to a realtor team, and optionally to specific team members.

Fields:
- id
- buyer_group_id
- realtor_team_id
- lead_realtor_member_id
- assigned_coordinator_member_id, nullable
- status
- created_at
- updated_at

## Realtor team UI rule

The same dynamic-person principle applies to realtor teams.

If a team has two active members, show two actor choices where relevant:
- Anees, Lead Agent
- Sarah, Coordinator

If a team has four active members, show all four:
- Anees, Lead Agent
- Buyer Agent
- Coordinator
- Mortgage Partner

The UI must render realtor team members from data. It must not assume there is only one realtor.

When a realtor team member acts on a listing:
- Notes are stored against that `realtor_team_member_id`.
- Advisor ratings are stored against that `realtor_team_member_id`.
- Risk flags are stored against that `realtor_team_member_id`.
- Showing or follow-up tasks are assigned to a named team member, not the generic realtor account.

Buyer sentiment and realtor/advisor input should be visually separated:
- Buyer ratings drive buyer consensus.
- Realtor team flags drive advisory/risk workflow.
- A realtor may recommend, warn, or shortlist, but should not be counted as a buyer unless explicitly configured.

## Feedback table

### listing_feedback
One row per person per listing per feedback event, or an event log plus a latest-state view.

Fields:
- id
- buyer_group_id
- listing_id
- buyer_group_member_id
- action_type, e.g. rating, note, reject, research_request, research_reviewed, advisor_flag
- rating, nullable
- status, nullable, e.g. interested, maybe, rejected, shortlisted
- note, nullable
- reason, nullable
- visibility, e.g. group, agent_only, private
- created_at
- updated_at

The latest visible state can be derived from the event log:
- latest rating per member per listing
- latest status per member per listing
- all notes by member
- group consensus
- veto flags

## Why this matters

Preferences can exist at two levels:

1. Group-level preferences
   - Max price
   - target towns
   - required bedrooms
   - commute requirements
   - dealbreakers agreed by the group

2. Individual-level preferences
   - Mark likes acreage
   - Katie cares about layout and stress level
   - Anees flags resale risk
   - Parent cares about main-floor bedroom

The scoring engine should calculate:
- group fit score
- per-person sentiment/rating
- conflicts, e.g. "Mark 5, Katie 2"
- consensus score
- veto flag, e.g. elderly parent said no because of stairs
- accessibility fit where relevant

## Consensus filtering

Replace the current POC label "Both like" with "People / consensus".

Render one filter row per `buyer_group_member`. This must be dynamic, not hardcoded.

If the buyer group has two members, show two rows:
- Mark [Any]
- Katie [Any]

If the buyer group has four members, show all four rows:
- Mom [Any]
- Dad [Any]
- Adult child [Any]
- Elderly parent [Any]

If the buyer group has five members, show all five rows. The UI reads the buyer group members and renders the rows from data. It must not assume Mark/Katie or a maximum of two buyers.

Advisor/realtor members can appear in the same dynamic list when `can_rate` or `can_comment` is true, but the UI should visually label their role so their input is not confused with buyer sentiment.

The filter options should include:
- Any
- No rating yet
- 1+ stars
- 2+ stars
- 3+ stars
- 4+ stars
- 5 stars
- Said no
- Did not say no

Add group-level consensus filters:
- No consensus filter
- At least one person likes it
- At least N people like it
- Everyone likes it
- All decision-makers like it
- Hide if anyone said no
- Hide if any veto-power member said no

## Notes

Do not store "buyer_name" as a single field on listings. Store buyer groups and buyer group members properly from the start. This avoids rebuilding when a search has 1, 2, or 5 decision-makers.

Do not store notes as appended text blobs in one generic comments column. Store every note as a person-attributed feedback event, then render the grouped view in the UI.
