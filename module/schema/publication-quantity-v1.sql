-- Version: publisher-publication-quantity/v1. Apply once before enabling multi-copy submissions.
-- Existing rows are unchanged. Each order continues to have a unique submission_key;
-- batch + media is now a lookup index because explicit repeat publications are separate orders.
-- Drafts still retain one immutable article version and one confirmed offer/spec per media.
ALTER TABLE publisher_items
  DROP INDEX pub_items_batch_media_uq,
  ADD INDEX pub_items_batch_media_idx (batch_id, media_resource_id);
