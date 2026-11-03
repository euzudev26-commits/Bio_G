ALTER TABLE public.raw_punch_events
DROP CONSTRAINT IF EXISTS raw_punch_events_source_channel_check;

ALTER TABLE public.raw_punch_events
ADD CONSTRAINT raw_punch_events_source_channel_check
CHECK (
  source_channel = ANY (
    ARRAY[
      'historical_import'::text,
      'realtime_push'::text,
      'manual_import'::text,
      'reconciliation'::text
    ]
  )
);
