export async function refreshInventoryPriceSchema(query) {
  await query(`
    alter table inventory_items
      add column if not exists unit_price numeric(12,2)
  `);

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
      i.unit_price,
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
    create or replace view order_request_supply_vw as
    select
      r.*,
      coalesce(sor.expected_delivery_date::text, so.expected_arrival_date::text, '') as expected_date,
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
      r.expected_date,
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
      r.unit,
      r.unit_price
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
      )::integer as to_deliver_lines,
      coalesce(sum(quantity * unit_price) filter (
        where coalesce(is_standing_order, false) = false
          and (coalesce(received, false) = true or coalesce(delivered, false) = true)
          and unit_price is not null
      ), 0)::numeric(12,2) as delivered_value
    from driver_sheet_request_vw
    where sheet_date is not null
    group by sheet_date
  `);
}
