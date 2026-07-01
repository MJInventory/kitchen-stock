export async function ensureReportingViews(query) {
  await query(`drop view if exists order_report_summary_vw`);
  await query(`drop view if exists audit_daily_summary_vw`);
  await query(`drop view if exists driver_sheet_request_vw`);
  await query(`drop view if exists management_order_item_totals_vw`);
  await query(`drop view if exists management_order_summary_vw`);
  await query(`drop view if exists management_order_lines_vw`);
  await query(`drop view if exists standing_order_due_vw`);
  await query(`drop view if exists inventory_below_minimum_vw`);
  await query(`drop view if exists order_request_attention_vw`);
  await query(`drop view if exists order_request_supply_vw`);
  await query(`drop view if exists standing_order_overview_vw`);
  await query(`drop view if exists order_request_details_vw`);
  await query(`drop view if exists internal_order_details_vw`);
  await query(`
      create or replace view order_request_details_vw as
      select
        r.id,
        r.request_number,
        r.inventory_item_id as item_id,
        r.inventory_item_id,
        r.quantity_needed as quantity,
        r.quantity_needed,
        r.urgency_level as urgency,
        r.urgency_level,
        r.status,
        r.requested_by_username as requested_by,
        r.requested_by_username,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by_username as delivered_by,
        r.delivered_by_username,
        r.ordered,
        r.ordered_at,
        r.ordered_by_username as ordered_by,
        r.ordered_by_username,
        r.to_deliver,
        r.delivery_day,
        (r.requested_at at time zone 'UTC')::date::text as request_day,
        ((r.requested_at at time zone 'UTC')::date = current_date) as is_today_request,
        (r.standing_order_run_id is not null or r.standing_order_run_line_id is not null) as is_standing_order,
        case
          when r.delivery_day is not null and r.delivery_day > current_date then true
          else false
        end as scheduled_delivery_future,
        greatest(0, current_date - ((r.requested_at at time zone 'UTC')::date))::integer as request_age_days,
        case
          when coalesce(r.partial_receipt, false) = true then 'partial'
          when r.standing_order_run_id is not null or r.standing_order_run_line_id is not null then 'standing'
          when lower(coalesce(r.requested_by_username, '')) = 'auto minimum'
            or lower(coalesce(r.notes, '')) like '%automatic minimum%'
            or lower(coalesce(r.notes, '')) like '%internal order shortage%' then 'automatic'
          else 'user'
        end as origin_type,
        r.notes,
        r.partial_receipt,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        r.order_unit,
        i.name as item_name,
        c.name as category,
        sl.name as storage_location,
        ia.name as inventory_area,
        sc.code as shelf_code,
        coalesce(nullif(r.order_unit, ''), u.name, 'item') as unit,
        sp.id as primary_supplier_id,
        sp.name as supplier_name,
        sp.contact_information as supplier_contact
      from order_requests r
      join inventory_items i on i.id = r.inventory_item_id
      left join categories c on c.id = i.category_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
      left join suppliers sp on sp.id = i.primary_supplier_id
    `);
  await query(`
      create or replace view internal_order_details_vw as
      select
        b.id as batch_id,
        b.requested_by_username,
        coalesce(b.requested_at, b.created_at) as requested_at,
        b.status as batch_status,
        b.notes as batch_notes,
        b.picker_username,
        b.ready_at,
        b.ready_by_username,
        b.closed_at,
        b.closed_by_username,
        l.id,
        l.internal_order_batch_id,
        l.inventory_item_id,
        l.requested_item_quantity,
        l.picked_item_quantity,
        l.shortage_item_quantity,
        l.shortage_request_id,
        l.auto_min_request_id,
        l.status,
        l.notes,
        i.name as item_name,
        i.current_quantity,
        i.minimum_threshold,
        c.name as category,
        ia.name as inventory_area,
        sl.name as storage_location,
        sc.code as shelf_code,
        u.name as unit
      from internal_order_batches b
      join internal_order_lines l on l.internal_order_batch_id = b.id
      join inventory_items i on i.id = l.inventory_item_id
      left join categories c on c.id = i.category_id
      left join inventory_areas ia on ia.id = i.inventory_area_id
      left join storage_locations sl on sl.id = i.storage_location_id
      left join shelf_codes sc on sc.id = i.shelf_code_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
    `);
  await query(`
      create or replace view order_request_supply_vw as
      select
        r.*,
        sorl.supplier_name as standing_line_supplier_name,
        coalesce(ss.id, sso.id, r.primary_supplier_id) as resolved_supplier_id,
        coalesce(nullif(trim(sorl.supplier_name), ''), sso.name, r.supplier_name) as resolved_supplier_name,
        coalesce(ss.contact_information, sso.contact_information, r.supplier_contact, '') as resolved_supplier_contact
      from order_request_details_vw r
      left join standing_order_run_lines sorl on sorl.id = r.standing_order_run_line_id
      left join standing_order_runs sor on sor.id = coalesce(r.standing_order_run_id, sorl.standing_order_run_id)
      left join standing_orders so on so.id = coalesce(sor.standing_order_id, sorl.standing_order_id)
      left join suppliers sso on sso.id = so.supplier_id
      left join suppliers ss on lower(ss.name) = lower(sorl.supplier_name)
    `);
  await query(`
      create or replace view driver_sheet_request_vw as
      select
        d.id,
        d.order_request_id,
        d.sheet_date::text as sheet_date,
        d.driver_username,
        d.ordered,
        d.ordered_at,
        d.ordered_by_username,
        d.received,
        d.received_at,
        d.received_by_username,
        d.to_deliver,
        d.delivery_day::text as delivery_day,
        coalesce(ds.name, r.resolved_supplier_name) as supplier_name,
        coalesce(ds.contact_information, r.resolved_supplier_contact, '') as supplier_contact,
        r.id as request_id,
        r.request_number,
        r.item_id,
        r.inventory_item_id,
        r.quantity,
        r.urgency,
        r.status,
        r.requested_by,
        r.requested_at,
        r.delivered,
        r.delivered_at,
        r.delivered_by,
        r.notes,
        r.partial_receipt,
        r.standing_order_run_id,
        r.standing_order_run_line_id,
        r.origin_type,
        r.is_today_request,
        r.is_standing_order,
        r.request_day,
        r.request_age_days,
        r.scheduled_delivery_future,
        r.item_name,
        r.category,
        r.storage_location,
        r.inventory_area,
        r.shelf_code,
        r.unit
      from order_request_supply_vw r
      left join driver_sheet_lines d on d.order_request_id = r.id
      left join suppliers ds on ds.id = d.supplier_id
    `);
  await query(`
      create or replace view order_report_summary_vw as
      select
        sheet_date,
        count(*) filter (where coalesce(is_standing_order, false) = false)::integer as total_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and coalesce(ordered, false) = true
        )::integer as ordered_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and (coalesce(received, false) = true or coalesce(delivered, false) = true)
        )::integer as delivered_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and coalesce(received, false) = false
            and coalesce(delivered, false) = false
        )::integer as waiting_lines,
        count(*) filter (
          where coalesce(is_standing_order, false) = false
            and coalesce(to_deliver, false) = true
        )::integer as to_deliver_lines
      from driver_sheet_request_vw
      where sheet_date is not null
      group by sheet_date
    `);
  await query(`
      create or replace view audit_daily_summary_vw as
      select
        action_date::text as action_date,
        count(*) filter (where action_type = 'add')::integer as adds,
        count(*) filter (where action_type = 'change')::integer as changes,
        count(*) filter (where action_type = 'delete')::integer as deletes,
        count(distinct nullif(trim(actor_username), ''))::integer as users
      from audit_log_entries
      group by action_date
    `);
  await query(`
      create or replace view order_request_attention_vw as
      select
        r.id,
        lower(coalesce(r.requested_by_username, '')) as requested_by_key,
        coalesce(r.requested_by_username, '') as requested_by_username,
        r.requested_at::date as request_date,
        greatest(0, current_date - (r.requested_at::date))::integer as request_age_days,
        coalesce(r.partial_receipt, false) as partial_receipt,
        coalesce(r.delivery_day > current_date, false) as scheduled_delivery_future,
        (r.standing_order_run_id is not null or r.standing_order_run_line_id is not null) as is_standing
      from order_requests r
      where coalesce(r.delivered, false) = false
        and coalesce(r.status, '') in ('Pending', 'Approved')
    `);
  await query(`
      create or replace view standing_order_overview_vw as
      select
        so.id,
        so.name,
        so.supplier_id,
        sp.name as supplier_name,
        so.expected_arrival_date::text as expected_date,
        so.schedule,
        so.other_schedule,
        so.recurring,
        so.active,
        so.last_generated_date::text as last_generated_date,
        so.notes,
        coalesce(so.deleted, false) as deleted,
        case
          when coalesce(so.deleted, false) = true then false
          when so.schedule = 'One Time' and coalesce(expected_run.closed_for_expected, false) = true then false
          when so.expected_arrival_date is not null and so.expected_arrival_date >= current_date then true
          else coalesce(so.active, false)
        end as display_active,
        case
          when coalesce(so.deleted, false) = true then 'Inactive'
          when so.schedule = 'One Time' and coalesce(expected_run.closed_for_expected, false) = true then 'Completed'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date < current_date
            and coalesce(expected_run.closed_for_expected, false) = false then 'Due'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date <= current_date
            and (
              coalesce(so.active, false) = true
              or coalesce(expected_run.open_for_expected, false) = true
              or coalesce(expected_run.open_lines_for_expected, false) = true
            ) then 'Due'
          when so.expected_arrival_date is not null
            and so.expected_arrival_date > current_date then 'Scheduled'
          when so.schedule = 'One Time' and coalesce(any_closed_run.has_any_closed_run, false) = true then 'Completed'
          else 'Inactive'
        end as status_label
      from standing_orders so
      left join suppliers sp on sp.id = so.supplier_id
      left join lateral (
        select
          bool_or(sor.status = 'Closed') as closed_for_expected,
          bool_or(sor.status <> 'Closed') as open_for_expected,
          bool_or(coalesce(sorl.received, false) = false) filter (where sorl.id is not null) as open_lines_for_expected
        from standing_order_runs sor
        left join standing_order_run_lines sorl on sorl.standing_order_run_id = sor.id
        where sor.standing_order_id = so.id
          and so.expected_arrival_date is not null
          and sor.expected_delivery_date = so.expected_arrival_date
      ) expected_run on true
      left join lateral (
        select bool_or(sor.status = 'Closed') as has_any_closed_run
        from standing_order_runs sor
        where sor.standing_order_id = so.id
      ) any_closed_run on true
    `);
  await query(`
      create or replace view inventory_below_minimum_vw as
      select
        i.id,
        i.name,
        coalesce(i.current_quantity, 0) as current_quantity,
        coalesce(i.minimum_threshold, 0) as minimum_threshold
      from inventory_items i
      where coalesce(i.active, true) = true
        and coalesce(i.current_quantity, 0) < coalesce(i.minimum_threshold, 0)
    `);
  await query(`
      create or replace view standing_order_due_vw as
      select
        id,
        supplier_name,
        expected_date,
        schedule
      from standing_order_overview_vw
      where display_active = true
        and nullif(expected_date, '') is not null
        and expected_date::date <= current_date
    `);
  await query(`
      create or replace view management_order_lines_vw as
      select
        r.id as request_id,
        r.request_number,
        r.inventory_item_id,
        coalesce(i.name, '') as item_name,
        coalesce(c.name, 'Uncategorized') as category_name,
        coalesce(s.name, 'Unassigned Supplier') as supplier_name,
        coalesce(nullif(r.order_unit, ''), u.name, 'item') as unit_name,
        coalesce(a.name, '') as area_name,
        coalesce(sl.name, '') as storage_location_name,
        coalesce(r.requested_by_username, '') as requested_by_username,
        r.requested_at,
        r.requested_at::date as request_date,
        coalesce(r.quantity_needed, 0) as quantity_needed,
        coalesce(r.urgency_level, '') as urgency_level,
        coalesce(r.status, '') as status,
        coalesce(r.ordered, false) as ordered,
        coalesce(r.delivered, false) as delivered,
        coalesce(r.to_deliver, false) as to_deliver,
        r.delivery_day,
        r.delivered_at,
        r.standing_order_run_id,
        r.standing_order_run_line_id
      from order_requests r
      left join inventory_items i on i.id = r.inventory_item_id
      left join categories c on c.id = i.category_id
      left join suppliers s on s.id = i.primary_supplier_id
      left join units_of_measure u on u.id = i.unit_of_measure_id
      left join inventory_areas a on a.id = i.inventory_area_id
      left join storage_locations sl on sl.id = i.storage_location_id
    `);
  await query(`
      create or replace view management_order_summary_vw as
      select
        request_date::text as request_date,
        coalesce(sum(quantity_needed), 0) as total_quantity,
        count(*)::integer as total_lines,
        count(distinct inventory_item_id)::integer as distinct_items,
        count(distinct supplier_name)::integer as distinct_suppliers
      from management_order_lines_vw
      group by request_date
    `);
  await query(`
      create or replace view management_order_item_totals_vw as
      select
        request_date::text as request_date,
        category_name,
        item_name,
        supplier_name,
        unit_name,
        coalesce(sum(quantity_needed), 0) as total_quantity,
        round(avg(
          case
            when delivered_at is not null and requested_at is not null
            then extract(epoch from (delivered_at - requested_at)) / 86400.0
            else null
          end
        )::numeric, 1) as avg_lead_time_days
      from management_order_lines_vw
      group by request_date, category_name, item_name, supplier_name, unit_name
    `);
}
