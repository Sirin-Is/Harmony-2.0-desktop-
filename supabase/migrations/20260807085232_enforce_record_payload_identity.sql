-- The storage key and the identity encoded in payload must describe the same
-- business record. This prevents shadow records and cross-record overwrites.
alter table public.harmony_records
  add constraint harmony_records_payload_identity_check
  check (
    case
      when entity_type in (
        'clients', 'custom_columns', 'calendar_events', 'hr_orders',
        'hr_monthly_documents', 'payroll_records', 'audit_operations', 'audit_events'
      ) then coalesce(payload->>'id', '') = id
      when entity_type in ('monthly_payments', 'income_records')
        then coalesce(payload->>'clientId', '') || '|' || coalesce(payload->>'monthKey', '') = id
      when entity_type in ('tax_records', 'report_records')
        then coalesce(payload->>'key', '') = id
      when entity_type = 'settings' then id = 'default'
      else false
    end
  ) not valid;

alter table public.harmony_records
  validate constraint harmony_records_payload_identity_check;
