### Description

This PR addresses the follow-up feedback items recorded in the KAN-30 code review (PR #28):

1. **Move cart items to `deal`**: Replaced the `campaign_item` table with `deal` table. Cart additions insert directly into `deal` with `status: 'pending'` and `offer_expires_at: null`.
2. **`deal_event` timing constraint**: Documented with a load-bearing comment in `add-to-cart.ts` that cart-add intentionally omits writing a `deal_event` to avoid FK constraints during cart removal (KAN-32).
3. **HTTP Status Code**: Updated `app/api/campaigns/[id]/items/route.ts` to return `200 OK` rather than `201`, aligning with the Tech Spec and AC.
4. **`isUniqueViolation` check**: Tightened the helper in `add-to-cart.ts` to explicitly assert the exact constraint name `CAMPAIGN_CREATOR_UNIQUE_CONSTRAINT` (`deal_campaign_creator_unique`).
5. **Error Code Documentation**: Clarified the difference between `CREATOR_NOT_BOOKABLE` and `CREATOR_NOT_VERIFIED` with detailed JSDoc comments in `lib/validation/errors.ts`.
6. **Use `isBookable` helper**: Swapped the handwritten tier checks in `addToCart` with the central `isBookable(creator)` predicate from `queries.ts`.
7. **`deal_total_price_valid` check constraint**: Added a database-level constraint in `db/schema.ts` to enforce `total_price = unit_price * video_count`, along with backing schema tests.

Refs KAN-30
