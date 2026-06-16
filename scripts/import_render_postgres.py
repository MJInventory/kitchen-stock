import json
import re
from pathlib import Path
from datetime import datetime

import bcrypt
import psycopg
import requests


BASE_ID = "appAFvMwWZb2PPWUz"
SUPPLIERS_TABLE_ID = "tbl2YP7EpUpk3Ug6f"
INVENTORY_TABLE_ID = "tblEuIXG6gxEiD5oU"
REQUESTS_TABLE_ID = "tblUHh1jWhqMFEfjd"
ALLOWED_UNITS = {"box", "bag", "item", "bottle"}

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = (ROOT / "database" / "schema.sql").read_text(encoding="utf-8")


def normalize(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())


def to_bool(value, fallback=True):
    if isinstance(value, bool):
        return value
    if value in (None, ""):
        return fallback
    return str(value).strip().lower() not in ("false", "0", "no")


def to_num(value, fallback=0):
    try:
        return float(value)
    except Exception:
        return fallback


def role_value(value):
    role = str(value or "user").strip().lower().replace("_", "-").replace(" ", "-")
    return role if role in {"god", "admin", "power-user", "user"} else "user"


def parse_items_json(value):
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


class AirtableImporter:
    def __init__(self, token, database_url):
        self.database_url = database_url
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            }
        )

    def get_meta_tables(self):
        response = self.session.get(
            f"https://api.airtable.com/v0/meta/bases/{BASE_ID}/tables", timeout=60
        )
        response.raise_for_status()
        return response.json().get("tables", [])

    def find_table(self, tables, *aliases):
        for alias in aliases:
            wanted = normalize(alias)
            for table in tables:
                if normalize(table.get("name")) == wanted:
                    return table
        return None

    def list_all_records(self, table_id):
        records = []
        offset = None
        while True:
            params = {"pageSize": 100}
            if offset:
                params["offset"] = offset
            response = self.session.get(
                f"https://api.airtable.com/v0/{BASE_ID}/{table_id}",
                params=params,
                timeout=60,
            )
            response.raise_for_status()
            data = response.json()
            records.extend(data.get("records", []))
            offset = data.get("offset")
            if not offset:
                return records

    def query_map(self, cur, sql_text):
        cur.execute(sql_text)
        return {row[0]: row[1] for row in cur.fetchall() if row[0] is not None}

    def query_map_lower_name(self, cur, table_name):
        cur.execute(f"select lower(name), id from {table_name}")
        return {row[0]: row[1] for row in cur.fetchall()}

    def upsert_lookup(self, cur, table_name, records, primary_field, sort_field="Sort Order"):
        for index, record in enumerate(records):
            fields = record.get("fields", {})
            name = str(fields.get(primary_field) or fields.get("Name") or "").strip()
            if not name:
                continue
            cur.execute(
                f"""
                insert into {table_name} (external_id, name, active, sort_order)
                values (%s, %s, %s, %s)
                on conflict (name) do update
                  set external_id = coalesce({table_name}.external_id, excluded.external_id),
                      active = excluded.active,
                      sort_order = excluded.sort_order,
                      updated_at = now()
                """,
                (
                    record["id"],
                    name,
                    to_bool(fields.get("Active"), True),
                    int(to_num(fields.get(sort_field), index)),
                ),
            )

    def run(self):
        tables = self.get_meta_tables()
        lookup = {
            "categories": self.find_table(tables, "Categories"),
            "storage_locations": self.find_table(tables, "Storage Locations"),
            "inventory_areas": self.find_table(tables, "Inventory Areas"),
            "shelf_codes": self.find_table(tables, "Shelf Codes"),
            "units": self.find_table(
                tables, "Unit Of Measurement", "Units Of Measurement", "Units"
            ),
            "app_users": self.find_table(tables, "App Users"),
            "stock_counts": self.find_table(tables, "Stock Counts"),
            "standing_orders": self.find_table(tables, "Standing Orders"),
            "driver_lines": self.find_table(tables, "Driver Sheet Lines"),
            "daily_guest_counts": self.find_table(
                tables, "Daily Guest Counts", "Daily Guests", "Guest Counts", "Daily Guest Count"
            ),
        }

        print("Loading Airtable data...")
        supplier_records = self.list_all_records(SUPPLIERS_TABLE_ID)
        category_records = self.list_all_records(lookup["categories"]["id"]) if lookup["categories"] else []
        storage_records = self.list_all_records(lookup["storage_locations"]["id"]) if lookup["storage_locations"] else []
        area_records = self.list_all_records(lookup["inventory_areas"]["id"]) if lookup["inventory_areas"] else []
        unit_records = self.list_all_records(lookup["units"]["id"]) if lookup["units"] else []
        shelf_records = self.list_all_records(lookup["shelf_codes"]["id"]) if lookup["shelf_codes"] else []
        app_user_records = self.list_all_records(lookup["app_users"]["id"]) if lookup["app_users"] else []
        inventory_records = self.list_all_records(INVENTORY_TABLE_ID)
        request_records = self.list_all_records(REQUESTS_TABLE_ID)
        driver_line_records = self.list_all_records(lookup["driver_lines"]["id"]) if lookup["driver_lines"] else []
        stock_count_records = self.list_all_records(lookup["stock_counts"]["id"]) if lookup["stock_counts"] else []
        standing_order_records = self.list_all_records(lookup["standing_orders"]["id"]) if lookup["standing_orders"] else []
        daily_guest_records = self.list_all_records(lookup["daily_guest_counts"]["id"]) if lookup["daily_guest_counts"] else []

        with psycopg.connect(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cur:
                print("Resetting schema...")
                cur.execute("drop schema public cascade; create schema public;")
                cur.execute(SCHEMA)

                print("Importing suppliers...")
                for record in supplier_records:
                    fields = record.get("fields", {})
                    name = str(fields.get("Supplier Name") or fields.get("Name") or "").strip()
                    if not name:
                        continue
                    cur.execute(
                        """
                        insert into suppliers (external_id, name, contact_information, active)
                        values (%s, %s, %s, %s)
                        on conflict (name) do update
                          set external_id = coalesce(suppliers.external_id, excluded.external_id),
                              contact_information = excluded.contact_information,
                              active = excluded.active,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            name,
                            str(fields.get("Contact Information") or "").strip(),
                            to_bool(fields.get("Active"), True),
                        ),
                    )

                print("Importing lookup tables...")
                self.upsert_lookup(cur, "categories", category_records, "Category")
                self.upsert_lookup(cur, "storage_locations", storage_records, "Storage Location")
                self.upsert_lookup(cur, "inventory_areas", area_records, "Inventory Area")

                for record in unit_records:
                    fields = record.get("fields", {})
                    name = str(fields.get("Unit") or fields.get("Name") or "").strip().lower()
                    if not name:
                        continue
                    cur.execute(
                        """
                        insert into units_of_measure (external_id, name, active)
                        values (%s, %s, %s)
                        on conflict (name) do update
                          set external_id = coalesce(units_of_measure.external_id, excluded.external_id),
                              active = excluded.active,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            name,
                            to_bool(fields.get("Active"), True),
                        ),
                    )

                for unit_name in ALLOWED_UNITS:
                    cur.execute(
                        "insert into units_of_measure (name, active) values (%s, true) on conflict (name) do nothing",
                        (unit_name,),
                    )

                storage_map = self.query_map(
                    cur, "select external_id, id from storage_locations where external_id is not null"
                )
                for record in shelf_records:
                    fields = record.get("fields", {})
                    code = str(fields.get("Shelf Code") or fields.get("Name") or "").strip()
                    if not code:
                        continue
                    storage_external = ((fields.get("Storage Location Link") or [])[:1] or [""])[0]
                    storage_id = storage_map.get(storage_external)
                    if not storage_id:
                        continue
                    cur.execute(
                        """
                        insert into shelf_codes (external_id, storage_location_id, code, active, sort_order)
                        values (%s, %s, %s, %s, %s)
                        on conflict (external_id) do update
                          set storage_location_id = excluded.storage_location_id,
                              code = excluded.code,
                              active = excluded.active,
                              sort_order = excluded.sort_order,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            storage_id,
                            code,
                            to_bool(fields.get("Active"), True),
                            int(to_num(fields.get("Sort Order"), 0)),
                        ),
                    )

                print("Importing users...")
                for record in app_user_records:
                    fields = record.get("fields", {})
                    username = str(
                        fields.get("Username")
                        or fields.get("User Name")
                        or fields.get("Name")
                        or ""
                    ).strip().lower()
                    if not username:
                        continue
                    plain_password = str(
                        fields.get("Password") or fields.get("New Password") or "changeme"
                    ).strip() or "changeme"
                    password_hash = bcrypt.hashpw(
                        plain_password.encode("utf-8"), bcrypt.gensalt()
                    ).decode("utf-8")
                    cur.execute(
                        """
                        insert into app_users (
                          external_id, username, display_name, password_hash, role, theme, active, must_change_password, source
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, 'airtable')
                        on conflict (username) do update
                          set external_id = coalesce(app_users.external_id, excluded.external_id),
                              display_name = excluded.display_name,
                              password_hash = excluded.password_hash,
                              role = excluded.role,
                              theme = excluded.theme,
                              active = excluded.active,
                              must_change_password = excluded.must_change_password,
                              source = excluded.source,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            username,
                            str(fields.get("Display Name") or username).strip(),
                            password_hash,
                            role_value(fields.get("Role")),
                            "light"
                            if str(fields.get("Theme") or "dark").strip().lower() == "light"
                            else "dark",
                            to_bool(fields.get("Active"), True),
                            to_bool(fields.get("Force Password Change"), False),
                        ),
                    )

                maps = {
                    "suppliers": self.query_map(
                        cur, "select external_id, id from suppliers where external_id is not null"
                    ),
                    "suppliers_by_name": self.query_map_lower_name(cur, "suppliers"),
                    "categories": self.query_map(
                        cur, "select external_id, id from categories where external_id is not null"
                    ),
                    "storage_locations": storage_map,
                    "shelf_codes": self.query_map(
                        cur, "select external_id, id from shelf_codes where external_id is not null"
                    ),
                    "inventory_areas": self.query_map(
                        cur, "select external_id, id from inventory_areas where external_id is not null"
                    ),
                    "units": self.query_map(
                        cur, "select external_id, id from units_of_measure where external_id is not null"
                    ),
                    "units_by_name": self.query_map_lower_name(cur, "units_of_measure"),
                }

                print("Importing inventory items...")
                for record in inventory_records:
                    fields = record.get("fields", {})
                    name = str(fields.get("Item Name") or "").strip()
                    if not name:
                        continue
                    category_id = maps["categories"].get(
                        ((fields.get("Category Link") or [])[:1] or [""])[0]
                    )
                    storage_id = maps["storage_locations"].get(
                        ((fields.get("Storage Location Link") or [])[:1] or [""])[0]
                    )
                    shelf_id = maps["shelf_codes"].get(
                        ((fields.get("Shelf Code Link") or [])[:1] or [""])[0]
                    )
                    area_id = maps["inventory_areas"].get(
                        ((fields.get("Inventory Area Link") or [])[:1] or [""])[0]
                    )
                    supplier_id = maps["suppliers"].get(
                        ((fields.get("Supplier/Vendor") or [])[:1] or [""])[0]
                    )
                    unit_id = maps["units"].get(
                        ((fields.get("Unit Of Measurement Link") or [])[:1] or [""])[0]
                    ) or maps["units_by_name"].get(
                        str(fields.get("Unit of Measure") or "").strip().lower()
                    )
                    cur.execute(
                        """
                        insert into inventory_items (
                          external_id, name, category_id, storage_location_id, shelf_code_id, inventory_area_id,
                          primary_supplier_id, unit_of_measure_id, current_quantity, minimum_threshold, active
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (external_id) do update
                          set name = excluded.name,
                              category_id = excluded.category_id,
                              storage_location_id = excluded.storage_location_id,
                              shelf_code_id = excluded.shelf_code_id,
                              inventory_area_id = excluded.inventory_area_id,
                              primary_supplier_id = excluded.primary_supplier_id,
                              unit_of_measure_id = excluded.unit_of_measure_id,
                              current_quantity = excluded.current_quantity,
                              minimum_threshold = excluded.minimum_threshold,
                              active = excluded.active,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            name,
                            category_id,
                            storage_id,
                            shelf_id,
                            area_id,
                            supplier_id,
                            unit_id,
                            to_num(fields.get("Current Quantity"), 0),
                            to_num(fields.get("Minimum Threshold"), 0),
                            to_bool(fields.get("Active"), True),
                        ),
                    )

                maps["inventory_items"] = self.query_map(
                    cur, "select external_id, id from inventory_items where external_id is not null"
                )

                print("Importing order requests...")
                for record in request_records:
                    fields = record.get("fields", {})
                    inventory_item_id = maps["inventory_items"].get(
                        ((fields.get("Requested Item") or [])[:1] or [""])[0]
                    )
                    if not inventory_item_id:
                        continue
                    cur.execute(
                        """
                        insert into order_requests (
                          external_id, inventory_item_id, quantity_needed, urgency_level, status, requested_by_username,
                          requested_at, delivered, delivered_at, delivered_by_username, notes
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (external_id) do update
                          set inventory_item_id = excluded.inventory_item_id,
                              quantity_needed = excluded.quantity_needed,
                              urgency_level = excluded.urgency_level,
                              status = excluded.status,
                              requested_by_username = excluded.requested_by_username,
                              requested_at = excluded.requested_at,
                              delivered = excluded.delivered,
                              delivered_at = excluded.delivered_at,
                              delivered_by_username = excluded.delivered_by_username,
                              notes = excluded.notes,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            inventory_item_id,
                            to_num(fields.get("Quantity Needed"), 0),
                            str(fields.get("Urgency Level") or "Medium"),
                            str(fields.get("Status") or "Approved"),
                            str(fields.get("Requested By") or "Kitchen"),
                            fields.get("Request Date/Time") or datetime.utcnow().isoformat(),
                            bool(fields.get("Received")),
                            fields.get("Received Date/Time"),
                            str(fields.get("Received By") or ""),
                            str(fields.get("Notes") or ""),
                        ),
                    )

                maps["requests"] = self.query_map(
                    cur, "select external_id, id from order_requests where external_id is not null"
                )

                print("Importing driver sheet lines...")
                for record in driver_line_records:
                    fields = record.get("fields", {})
                    order_request_id = maps["requests"].get(
                        str(fields.get("Item Request Record ID") or "")
                    )
                    if not order_request_id:
                        continue
                    supplier_id = maps["suppliers_by_name"].get(
                        str(fields.get("Supplier Name") or "").strip().lower()
                    )
                    cur.execute(
                        """
                        insert into driver_sheet_lines (
                          external_id, sheet_date, order_request_id, supplier_id, driver_username, ordered, ordered_at,
                          ordered_by_username, received, received_at, received_by_username, to_deliver, delivery_day, notes
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (external_id) do update
                          set sheet_date = excluded.sheet_date,
                              order_request_id = excluded.order_request_id,
                              supplier_id = excluded.supplier_id,
                              driver_username = excluded.driver_username,
                              ordered = excluded.ordered,
                              ordered_at = excluded.ordered_at,
                              ordered_by_username = excluded.ordered_by_username,
                              received = excluded.received,
                              received_at = excluded.received_at,
                              received_by_username = excluded.received_by_username,
                              to_deliver = excluded.to_deliver,
                              delivery_day = excluded.delivery_day,
                              notes = excluded.notes,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            fields.get("Sheet Date"),
                            order_request_id,
                            supplier_id,
                            str(fields.get("Driver") or ""),
                            bool(fields.get("Ordered")),
                            fields.get("Ordered Date/Time"),
                            str(fields.get("Ordered By") or ""),
                            bool(fields.get("Received")),
                            fields.get("Received Date/Time"),
                            str(fields.get("Received By") or ""),
                            bool(fields.get("2Deliver")),
                            fields.get("Delivery Day") or fields.get("Delivery Date"),
                            str(fields.get("Notes") or ""),
                        ),
                    )

                print("Importing stock counts...")
                for record in stock_count_records:
                    fields = record.get("fields", {})
                    inventory_item_id = maps["inventory_items"].get(
                        str(fields.get("Inventory Item Record ID") or "")
                    )
                    if not inventory_item_id:
                        continue
                    cur.execute(
                        """
                        insert into stock_counts (
                          external_id, inventory_item_id, counted_quantity, previous_quantity, counted_by_username, counted_at, notes
                        )
                        values (%s, %s, %s, %s, %s, %s, %s)
                        on conflict (external_id) do update
                          set inventory_item_id = excluded.inventory_item_id,
                              counted_quantity = excluded.counted_quantity,
                              previous_quantity = excluded.previous_quantity,
                              counted_by_username = excluded.counted_by_username,
                              counted_at = excluded.counted_at,
                              notes = excluded.notes
                        """,
                        (
                            record["id"],
                            inventory_item_id,
                            to_num(fields.get("Counted Quantity"), 0),
                            to_num(fields.get("Previous Quantity"), 0),
                            str(fields.get("Counted By") or ""),
                            fields.get("Counted At")
                            or fields.get("Count Date/Time")
                            or datetime.utcnow().isoformat(),
                            str(fields.get("Notes") or ""),
                        ),
                    )

                print("Importing standing orders...")
                for record in standing_order_records:
                    fields = record.get("fields", {})
                    supplier_id = maps["suppliers_by_name"].get(
                        str(fields.get("Supplier Name") or "").strip().lower()
                    )
                    cur.execute(
                        """
                        insert into standing_orders (
                          external_id, name, supplier_id, expected_arrival_date, schedule, other_schedule,
                          recurring, active, last_generated_date, notes
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        on conflict (external_id) do update
                          set name = excluded.name,
                              supplier_id = excluded.supplier_id,
                              expected_arrival_date = excluded.expected_arrival_date,
                              schedule = excluded.schedule,
                              other_schedule = excluded.other_schedule,
                              recurring = excluded.recurring,
                              active = excluded.active,
                              last_generated_date = excluded.last_generated_date,
                              notes = excluded.notes,
                              updated_at = now()
                        """,
                        (
                            record["id"],
                            str(fields.get("Standing Order") or fields.get("Name") or "Standing Order"),
                            supplier_id,
                            fields.get("Expected Arrival Date"),
                            str(fields.get("Schedule") or "Weekly"),
                            str(fields.get("Other Schedule") or ""),
                            str(fields.get("Schedule") or "").strip().lower() != "one time",
                            to_bool(fields.get("Active"), True),
                            fields.get("Last Generated Date"),
                            str(fields.get("Notes") or ""),
                        ),
                    )

                maps["standing_orders"] = self.query_map(
                    cur, "select external_id, id from standing_orders where external_id is not null"
                )
                for record in standing_order_records:
                    fields = record.get("fields", {})
                    standing_order_id = maps["standing_orders"].get(record["id"])
                    if not standing_order_id:
                        continue
                    for item in parse_items_json(fields.get("Items JSON")):
                        inventory_item_id = maps["inventory_items"].get(str(item.get("itemId") or ""))
                        if not inventory_item_id:
                            continue
                        cur.execute(
                            """
                            insert into standing_order_items (standing_order_id, inventory_item_id, quantity)
                            values (%s, %s, %s)
                            on conflict (standing_order_id, inventory_item_id) do update
                              set quantity = excluded.quantity,
                                  updated_at = now()
                            """,
                            (
                                standing_order_id,
                                inventory_item_id,
                                to_num(item.get("quantity"), 0),
                            ),
                        )

                print("Importing daily guest counts...")
                for record in daily_guest_records:
                    fields = record.get("fields", {})
                    report_date = (
                        fields.get("Date")
                        or fields.get("Guest Date")
                        or fields.get("Report Date")
                    )
                    if not report_date:
                        continue
                    guests = fields.get(
                        "Guest Count",
                        fields.get("Guests", fields.get("Guest Total", fields.get("Daily Guests", 0))),
                    )
                    entered_by = (
                        str(fields.get("Entered By") or fields.get("Created By") or fields.get("User") or "system").strip()
                        or "system"
                    )
                    cur.execute(
                        """
                        insert into daily_guest_counts (
                          external_id, report_date, guests, notes, entered_by_username, entered_at
                        )
                        values (%s, %s, %s, %s, %s, %s)
                        on conflict (report_date) do update
                          set external_id = coalesce(daily_guest_counts.external_id, excluded.external_id),
                              guests = excluded.guests,
                              notes = excluded.notes,
                              entered_by_username = excluded.entered_by_username,
                              entered_at = excluded.entered_at
                        """,
                        (
                            record["id"],
                            report_date,
                            max(0, int(round(to_num(guests, 0)))),
                            str(fields.get("Notes") or fields.get("Guest Notes") or ""),
                            entered_by,
                            fields.get("Entered At")
                            or fields.get("Created At")
                            or fields.get("Timestamp")
                            or datetime.utcnow().isoformat(),
                        ),
                    )

                conn.commit()

                summary = {}
                for table_name in [
                    "suppliers",
                    "categories",
                    "storage_locations",
                    "inventory_areas",
                    "units_of_measure",
                    "shelf_codes",
                    "app_users",
                    "inventory_items",
                    "order_requests",
                    "driver_sheet_lines",
                    "stock_counts",
                    "standing_orders",
                    "standing_order_items",
                    "daily_guest_counts",
                ]:
                    cur.execute(f"select count(*) from {table_name}")
                    summary[table_name] = cur.fetchone()[0]

                print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    import os
    token = os.environ["AIRTABLE_TOKEN"]
    database_url = os.environ["DATABASE_URL"]
    AirtableImporter(token, database_url).run()
