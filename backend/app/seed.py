"""
Seed data: default areas, templates, productivity norms.
Called during tenant registration.
"""
from app.models import AreaDictionary, Template, ProductivityNorm

# ── Default area dictionaries with keywords ──────────────────────────────
DEFAULT_AREAS = [
    {"code": "ISBL", "keywords_json": ["isbl", "process area", "reactor", "column", "separator"], "priority": 10},
    {"code": "OSBL", "keywords_json": ["osbl", "offsite", "storage", "loading"], "priority": 20},
    {"code": "UTL", "keywords_json": ["utility", "utilities", "steam", "cooling water", "compressed air"], "priority": 30},
    {"code": "SUB", "keywords_json": ["substation", "electrical room", "switchgear"], "priority": 40},
    {"code": "BLDG", "keywords_json": ["building", "control room", "warehouse", "office"], "priority": 50},
    {"code": "OFFSITE", "keywords_json": ["tank farm", "flare", "waste treatment"], "priority": 60},
    {"code": "TIEIN", "keywords_json": ["tie-in", "tie in", "interconnect"], "priority": 70},
    {"code": "TEMP", "keywords_json": ["temporary", "construction camp", "laydown"], "priority": 80},
    {"code": "GEN", "keywords_json": [], "priority": 999},
]

# ── Standard template steps & rules ──────────────────────────────────────
STANDARD_STEPS = [
    {
        "phase": "ENG",
        "activities": [
            {"code": "AFD", "name": "Design AFD", "default_dur_hr": 24},
            {"code": "IFC", "name": "Issue IFC", "default_dur_hr": 8},
        ],
    },
    {
        "phase": "PROC",
        "activities": [
            {"code": "MR", "name": "Material Requisition", "default_dur_hr": 8},
            {"code": "PO", "name": "Purchase Order", "default_dur_hr": 16},
            {"code": "VDR", "name": "Vendor Data Review", "default_dur_hr": 24},
            {"code": "FAT", "name": "Factory Acceptance Test", "default_dur_hr": 0, "optional": True},
            {"code": "DEL", "name": "Delivery to Site", "default_dur_hr": 8},
        ],
    },
    {
        "phase": "CONST",
        "activities": [
            {"code": "PREP", "name": "Site Preparation", "default_dur_hr": 16},
            {"code": "INST", "name": "Installation/Erection", "default_dur_hr": 80},
            {"code": "TEST", "name": "Testing/QA", "default_dur_hr": 24},
            {"code": "PUNCH", "name": "Punch Closeout", "default_dur_hr": 16},
            {"code": "HO", "name": "Handover", "default_dur_hr": 8},
        ],
    },
]

STANDARD_RULES = {
    "dependencies": [
        {"pred_phase": "ENG", "pred_code": "AFD", "succ_phase": "ENG", "succ_code": "IFC", "type": "FS", "lag_hr": 0},
        {"pred_phase": "ENG", "pred_code": "IFC", "succ_phase": "CONST", "succ_code": "PREP", "type": "FS", "lag_hr": 0},
        {"pred_phase": "PROC", "pred_code": "MR", "succ_phase": "PROC", "succ_code": "PO", "type": "FS", "lag_hr": 0},
        {"pred_phase": "PROC", "pred_code": "PO", "succ_phase": "PROC", "succ_code": "VDR", "type": "FS", "lag_hr": 0},
        {"pred_phase": "PROC", "pred_code": "VDR", "succ_phase": "PROC", "succ_code": "DEL", "type": "FS", "lag_hr": 0},
        {"pred_phase": "PROC", "pred_code": "DEL", "succ_phase": "CONST", "succ_code": "PREP", "type": "FS", "lag_hr": 0},
        {"pred_phase": "CONST", "pred_code": "PREP", "succ_phase": "CONST", "succ_code": "INST", "type": "FS", "lag_hr": 0},
        {"pred_phase": "CONST", "pred_code": "INST", "succ_phase": "CONST", "succ_code": "TEST", "type": "FS", "lag_hr": 0},
        {"pred_phase": "CONST", "pred_code": "TEST", "succ_phase": "CONST", "succ_code": "PUNCH", "type": "FS", "lag_hr": 0},
        {"pred_phase": "CONST", "pred_code": "PUNCH", "succ_phase": "CONST", "succ_code": "HO", "type": "FS", "lag_hr": 0},
    ],
    "optional_activities": [
        {"phase": "PROC", "code": "FAT", "enabled_by_field": "meta_json.requires_fat"},
    ],
}

# ── Templates per discipline/work_type ───────────────────────────────────
DEFAULT_TEMPLATES = [
    {"discipline": "PIP", "work_type": "PIP_INSTALL", "name": "Piping Installation"},
    {"discipline": "CIV", "work_type": "CIV_CONCRETE", "name": "Civil Concrete Works"},
    {"discipline": "STR", "work_type": "STR_STEEL", "name": "Structural Steel"},
    {"discipline": "MECH", "work_type": "MECH_EQUIP_INSTALL", "name": "Mechanical Equipment Installation"},
    {"discipline": "EI", "work_type": "EI_CABLING", "name": "Electrical & Instrumentation Cabling"},
    {"discipline": "GEN", "work_type": "GEN", "name": "Generic Template"},
]

# ── Productivity norms ───────────────────────────────────────────────────
DEFAULT_NORMS = [
    {"discipline": "PIP", "work_type": "PIP_INSTALL", "uom": "LM", "mh_per_uom": 1.5, "crew_json": {"crew_size": 6, "hours_per_day": 8}, "labor_rate": 45},
    {"discipline": "CIV", "work_type": "CIV_CONCRETE", "uom": "M3", "mh_per_uom": 3.0, "crew_json": {"crew_size": 8, "hours_per_day": 8}, "labor_rate": 40},
    {"discipline": "STR", "work_type": "STR_STEEL", "uom": "TON", "mh_per_uom": 20.0, "crew_json": {"crew_size": 6, "hours_per_day": 8}, "labor_rate": 50},
    {"discipline": "MECH", "work_type": "MECH_EQUIP_INSTALL", "uom": "EA", "mh_per_uom": 40.0, "crew_json": {"crew_size": 6, "hours_per_day": 8}, "labor_rate": 55},
    {"discipline": "EI", "work_type": "EI_CABLING", "uom": "LM", "mh_per_uom": 0.8, "crew_json": {"crew_size": 4, "hours_per_day": 8}, "labor_rate": 42},
]


async def seed_tenant_defaults(db, tenant_id: str):
    """Insert default reference data for a new tenant."""
    # Areas
    for area in DEFAULT_AREAS:
        db.add(AreaDictionary(tenant_id=tenant_id, **area))

    # Templates
    for tmpl in DEFAULT_TEMPLATES:
        db.add(Template(
            tenant_id=tenant_id,
            discipline=tmpl["discipline"],
            work_type=tmpl["work_type"],
            name=tmpl["name"],
            steps_json=STANDARD_STEPS,
            rules_json=STANDARD_RULES,
        ))

    # Norms
    for norm in DEFAULT_NORMS:
        db.add(ProductivityNorm(tenant_id=tenant_id, **norm))

    await db.flush()
