import { z } from 'zod';
import {publisherDraftOutputSchema as originalDraft,publisherPreflightOutputSchema as originalPreflight} from '@frontmind/monitoring-contracts';
import {publicationSelectionSchema} from '../shared/publication-selection.js';

// Local response extensions preserve the host validation and prevent z.object stripping quantity metadata.
export const publisherDraftOutputSchema=originalDraft.extend({items:z.array(originalDraft.shape.items.element.extend({publication:publicationSelectionSchema.optional()})).max(20)});
export const publisherPreflightOutputSchema=originalPreflight.extend({items:z.array(originalPreflight.shape.items.element.extend({publication:publicationSelectionSchema.optional()})).min(1).max(20)});
export type PublisherQuantityPreflightOutput=z.infer<typeof publisherPreflightOutputSchema>;
