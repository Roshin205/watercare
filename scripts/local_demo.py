"""Try the website on this computer with sample data, without touching the real local database or Cloudflare.

    python scripts/local_demo.py            # keeps the demo data from the last run
    python scripts/local_demo.py --reset    # starts again from fresh sample data

It uses its own database and upload folder under instance/ (never deployed, never committed). The first run makes a
random sign-in and prints it here; it is also kept in instance/demo-login.txt.
"""
import argparse
import os
import secrets
import shutil
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
INSTANCE = ROOT / "instance"
DATABASE = INSTANCE / "demo.db"
UPLOADS = INSTANCE / "demo-uploads"
LOGIN_FILE = INSTANCE / "demo-login.txt"
EMAIL = "demo@wolgan.test"

os.environ["DATABASE_URL"] = "sqlite:///" + str(DATABASE).replace("\\", "/")
os.environ["STORAGE_PATH"] = str(UPLOADS)
os.environ.pop("FLASK_ENV", None)
sys.path.insert(0, str(ROOT))

from backend import create_app  # noqa: E402
from backend.database import db  # noqa: E402
from backend.models import memberships, organizations, users  # noqa: E402
from backend.security.passwords import hash_password  # noqa: E402

CLIENTS = ["Daikin", "Asteco", "Engie", "Al Futtaim"]
SITES = [
    ("Daikin", "True Bell", "1087", "Monthly", -120, 1, "CT - 2 samples, CT Make up - 1 Sample, CHW 1 - 1 sample", "Jebel Ali"),
    ("Asteco", "Madinat Badr", "770", "Monthly", -300, 430, "CT - 1 sample, CT Make up - 1 Sample", "Muhaisnah"),
    ("Engie", "RTA NHQ A Block", "801", "Quarterly", -200, 40, "Chilled water system", "Umm Ramool"),
    ("Engie", "RTA NHQ C Block", "802", "Quarterly", -200, 160, "Chilled water system", "Umm Ramool"),
    ("Engie", "MBR Solar Park", "1012", "Bimonthly", -240, 850, "Engineer Visit - Bimonthly, CHW POD 1 - 1 Sample", "Saih Al Dahal"),
    ("Engie", "G+2 Building", "815", "Half-yearly", -400, -5, "Domestic water tank", "Deira"),
    ("Al Futtaim", "DFC Tower Areesh", "930", "Quarterly", -360, 1, "Domestic and cooling water", "Festival City"),
    ("Al Futtaim", "Festival Tower", "931", "Yearly", -30, 330, "Cooling tower", "Festival City"),
]


def seed(app):
    day = date.today()
    client = app.test_client()
    password, key = secrets.token_urlsafe(12), secrets.token_urlsafe(12)
    with app.app_context():
        db.create_all()
        now = datetime.now(timezone.utc).isoformat()
        organization, user = str(uuid4()), str(uuid4())
        db.session.execute(organizations.insert().values(id=organization, name="Wolgan Water Treatment LLC", created_at=now, updated_at=now))
        db.session.execute(users.insert().values(
            id=user, email=EMAIL, full_name="Demo Admin", password_hash=hash_password(password),
            access_key_hash=hash_password(key), is_active=True, created_at=now, updated_at=now,
        ))
        db.session.execute(memberships.insert().values(
            id=str(uuid4()), organization_id=organization, user_id=user, role="administrator", status="active", created_at=now,
        ))
        db.session.commit()
    LOGIN_FILE.write_text(f"Demo sign-in (Admin login)\nEmail: {EMAIL}\nPassword: {password}\nPrivate key: {key}\n", encoding="utf-8")
    token = client.post("/api/auth/login", json={"email": EMAIL, "password": password, "login_type": "admin", "access_key": key}).json["csrf_token"]

    def add(path, **fields):
        response = client.post(f"/api/hub{path}", json=fields, headers={"X-CSRF-Token": token})
        assert response.status_code in (200, 201), (path, response.json)
        return response.json.get("data")

    client.get("/api/hub/bootstrap")
    client.get("/api/services")
    staff = [
        add("/staff", name=name, position=position, employee_id=f"E{index:03d}", mobile=f"+97150000{index:04d}", status="Active",
            joined="2024-01-15", vehicle_no=f"D {index}4521", vehicle_name="Toyota Hiace",
            visa_no=f"V-{index}9921", visa_expiry=(day + timedelta(days=26 + index * 10)).isoformat(),
            eid_no=f"784-19{index}", eid_expiry=(day + timedelta(days=90 + index * 45)).isoformat(),
            passport_no=f"P{index}77123", passport_expiry=(day + timedelta(days=200 + index * 60)).isoformat())
        for index, (name, position) in enumerate([
            ("Canutte Dsouza", "Senior Technician"), ("Rahul Menon", "Water Technician"), ("Imran Khan", "Driver"),
            ("Joseph Thomas", "Lab Technician"), ("Ali Hassan", "Service Engineer"),
        ], start=1)
    ]
    contracts = []
    for index, (customer, site, so, frequency, started, expires, system, area) in enumerate(SITES):
        start, expiry = (day + timedelta(days=started)).isoformat(), (day + timedelta(days=expires)).isoformat()
        contracts.append(add(
            "/contracts", client=customer, site=site, so=so, frequency=frequency, start=start, expiry=expiry,
            period_text=f"{start[:7]} to {expiry[:7]}", system_details=system, location=area, contact=f"{customer} Site Team",
            mobile=f"+97155{index}000{index}11", map_link=f"https://www.google.com/maps/search/{site.replace(' ', '+')}",
            source=("AMC", "AMC + Schedule", "Schedule only")[index % 3], microbiology="Yes", legionella="Yes",
            latitude=round(25.02 + index * 0.05, 5), longitude=round(55.08 + index * 0.06, 5),
            service=("Water testing", "Tank cleaning")[index % 2], engineer=("Ali Hassan", "Rahul Menon")[index % 2], visit_time="09:00",
        ))
    month = day.isoformat()[:7]
    for index, row in enumerate(contracts):
        if index % 2 == 0:
            add(f"/contracts/{row['id']}/schedule", month=month, engineer=staff[index % 5]["name"])
        if index % 3 == 0:
            add(f"/contracts/{row['id']}/visit", date=(day - timedelta(days=3)).isoformat(), engineer=staff[1]["name"], report="Submitted", lab="Sample sent")
        for test, system, duration, back in (("Legionella", "Cooling tower", "Quarterly", 12), ("Microbiology", "Domestic water", "Monthly", 40)):
            add("/samples", contract_id=row["id"], client=row["client"], site=row["site"], test=test, water_system=system, duration=duration,
                points=f"{system} - Point {index + 1}", contact=row["contact"], mobile=row["mobile"], qty_due=1,
                collection_date=(day - timedelta(days=back)).isoformat())
    add("/grn_projects", project="True Bell Pump Replacement", quote="Q-2201", po="PO-881", so="1087", status="Waiting GRN")
    add("/grn_projects", project="Madinat Badr Valve Works", quote="Q-2202", po="PO-882", so="770", status="GRN Received")
    add("/ppm_planners/generate", year=day.year)
    items = {name: add("/inventory_items", name=name, code=f"M{index:03d}", category="Chemicals", uom="Drum", opening_stock=stock, min_stock=4, unit_cost=cost, location="Main Store", supplier="Veneto")
             for index, (name, stock, cost) in enumerate([("SANITER 420", 18, 420), ("SANITER 413", 9, 390), ("STABILFLUID 620", 3, 510), ("Dispersol 8300", 0, 275)], start=1)}
    add("/inventory_items", name="Motorized Valve", code="S001", category="Spare parts", uom="Nos", opening_stock=25, min_stock=5, unit_cost=145, location="Main Store")
    add("/inventory_moves", item_id=items["SANITER 420"]["id"], type="IN", qty=6, date=day.isoformat(), reference="GRN-1120")
    for row in contracts[:3]:
        for chemical, quantity in (("SANITER 420", 10), ("Dispersol 8300", 6)):
            line = add("/chemical_lines", contract_id=row["id"], client=row["client"], site=row["site"], so=row["so"], block="Contract period", system="Cooling tower", supplier="Veneto", chemical=chemical, description="20 kg drum", uom="Drum", contract_qty=quantity)
            add(f"/chemical_lines/{line['id']}/month", month=month, qty=2)
    for index, row in enumerate(contracts[:4]):
        add("/delivery_notes", date=(day - timedelta(days=index)).isoformat(), contract_id=row["id"], client=row["client"], site=row["site"], so=row["so"],
            address=row["location"], contact=row["contact"], mobile=row["mobile"], type="Chemicals", driver="Imran Khan", driver_mobile="+971500000003",
            helpers="Rahul Menon", helper_count=1, amount=500 + index * 150, status=("Pending", "In transit", "Delivered", "Delivered")[index],
            items=[{"name": "SANITER 420", "description": "20 kg/drum", "qty": 2, "unit": "Drum"}, {"name": "Motorized Valve", "description": "DN25", "qty": 3, "unit": "Nos"}])
    marks = [{"staff_id": person["id"], "date": (day - timedelta(days=offset)).isoformat(), "code": "P"} for person in staff for offset in range(0, 4)]
    client.put("/api/hub/attendance", json={"marks": marks}, headers={"X-CSRF-Token": token})
    for offset, person in enumerate(staff[:3]):
        add("/staff_schedule", date=day.isoformat(), staff=person["name"], shift="08:00 - 17:00", site=contracts[offset]["site"], task="Site visit", status="Planned")
    sections = {section["system"]: section for section in client.get("/api/hub/bootstrap").json["sections"]}
    add("/section_rows", section_id=sections["assets"]["id"], values={"item": "Hilti Drill", "model": "TE 6-A", "qty": 2, "cost": 1800, "condition": "Working", "in_charge": "Rahul Menon", "purchase_date": "2025-03-10", "supplier": "Hilti"})
    add("/section_rows", section_id=sections["assets"]["id"], values={"item": "Pressure Pump", "model": "PX-200", "qty": 1, "cost": 3200, "condition": "Needs repair", "in_charge": "Ali Hassan"})
    add("/section_rows", section_id=sections["calibration"]["id"], values={"instrument": "Conductivity Meter", "model": "S-504CO", "mfg": "Walchem", "serial": "80240120", "qty": 1, "cost": 950, "condition": "Working Condition", "in_charge": "Joseph Thomas", "calibration_date": (day - timedelta(days=350)).isoformat()})
    add("/section_rows", section_id=sections["calibration"]["id"], values={"instrument": "pH Meter", "model": "PH-22", "mfg": "Hanna", "serial": "9920", "qty": 2, "cost": 620, "condition": "Working Condition", "calibration_date": (day - timedelta(days=30)).isoformat()})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="throw away the demo data and start again")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()
    INSTANCE.mkdir(exist_ok=True)
    if args.reset:
        DATABASE.unlink(missing_ok=True)
        shutil.rmtree(UPLOADS, ignore_errors=True)
    fresh = not DATABASE.exists()
    app = create_app()
    if fresh:
        seed(app)
    print(f"\nWolgan demo: http://127.0.0.1:{args.port}\n{LOGIN_FILE.read_text(encoding='utf-8')}")
    app.run(host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
