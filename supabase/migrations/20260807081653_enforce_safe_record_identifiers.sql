-- Storage keys are later used as SQLite keys and DOM data attributes. Keep
-- them opaque and predictable even when a caller bypasses the application.
alter table public.harmony_records
  add constraint harmony_records_safe_identifier_check
  check (
    length(id) between 1 and 512
    and id ~ '^[A-Za-z0-9._:@|:-]+$'
  ) not valid;

alter table public.harmony_records
  validate constraint harmony_records_safe_identifier_check;
