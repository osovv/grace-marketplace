"""
Rules Engine: BOQ classification -> package assignment -> WBS generation
-> activity generation -> relationship creation -> estimation.
"""
import uuid
from collections import defaultdict
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models import (
    BOQItem, WBSNode, Activity, Relationship, Template,
    ProductivityNorm, AreaDictionary, Project,
)

# ── Keyword classification maps (starter fallback) ───────────────────────
DISCIPLINE_KEYWORDS = {
    "PIP": ["pipe", "piping", "tube", "tubing", "valve", "flange", "fitting", "spool"],
    "CIV": ["concrete", "foundation", "earthwork", "excavat", "backfill", "grading", "paving"],
    "STR": ["steel", "structural", "beam", "column", "brace", "truss", "grating"],
    "MECH": ["pump", "compressor", "vessel", "tank", "exchanger", "equipment", "mechanical", "turbine"],
    "EI": ["cable", "wiring", "electrical", "instrument", "panel", "switchgear", "transformer", "motor"],
    "HVAC": ["hvac", "duct", "air handling", "ventilation", "cooling"],
    "PLB": ["plumbing", "drain", "sewer", "sanitary", "domestic water"],
    "INST": ["instrument", "transmitter", "control valve", "dcs", "sensor"],
}

WORK_TYPE_MAP = {
    "PIP": "PIP_INSTALL",
    "CIV": "CIV_CONCRETE",
    "STR": "STR_STEEL",
    "MECH": "MECH_EQUIP_INSTALL",
    "EI": "EI_CABLING",
    "HVAC": "PIP_INSTALL",
    "PLB": "PIP_INSTALL",
    "INST": "EI_CABLING",
}

GENERIC_TEMPLATE_STEPS = [
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

GENERIC_RULES = {
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


# ── 1) Classify BOQ items ────────────────────────────────────────────────
async def classify_boq_items(
    db: AsyncSession, project: Project, boq_items: list[BOQItem],
):
    """Classify area_norm, discipline, work_type for each BOQ item."""
    # Load area dictionary for tenant
    result = await db.execute(
        select(AreaDictionary)
        .where(AreaDictionary.tenant_id == project.tenant_id)
        .order_by(AreaDictionary.priority)
    )
    areas = result.scalars().all()

    for item in boq_items:
        # Skip if already manually overridden
        desc_lower = (item.description or "").lower()
        area_lower = (item.area_raw or "").lower()
        search_text = f"{desc_lower} {area_lower}"

        # Classify area
        if not item.area_norm:
            matched_area = None
            for area_dict in areas:
                keywords = area_dict.keywords_json or []
                for kw in keywords:
                    if kw.lower() in search_text:
                        matched_area = area_dict.code
                        break
                if matched_area:
                    break
            # Also check project area_map_json
            area_map = project.area_map_json or {}
            for kw, area_code in area_map.items():
                if kw.lower() in search_text:
                    matched_area = area_code
                    break
            item.area_norm = matched_area or "GEN"

        # Classify discipline
        if not item.discipline:
            matched_disc = None
            for disc, keywords in DISCIPLINE_KEYWORDS.items():
                for kw in keywords:
                    if kw in desc_lower:
                        matched_disc = disc
                        break
                if matched_disc:
                    break
            item.discipline = matched_disc or "GEN"

        # Classify work_type
        if not item.work_type:
            item.work_type = WORK_TYPE_MAP.get(item.discipline, "CIV_CONCRETE")

    await db.flush()


# ── 2) Assign packages ───────────────────────────────────────────────────
def assign_packages(boq_items: list[BOQItem]) -> dict:
    """Group items by (area_norm, discipline, work_type), assign package codes."""
    groups = defaultdict(list)
    for item in boq_items:
        key = (item.area_norm or "GEN", item.discipline or "GEN", item.work_type or "GEN")
        groups[key].append(item)

    packages = {}
    pkg_counter = 1
    for key in sorted(groups.keys()):
        pkg_code = f"P{pkg_counter:03d}"
        packages[key] = {
            "code": pkg_code,
            "items": groups[key],
            "area": key[0],
            "discipline": key[1],
            "work_type": key[2],
            "total_qty": sum(float(item.qty or 0) for item in groups[key]),
        }
        for item in groups[key]:
            item.package_code = pkg_code
        pkg_counter += 1

    return packages


# ── 3) Generate WBS ──────────────────────────────────────────────────────
async def generate_wbs(
    db: AsyncSession, project_id: str, tenant_id: str, packages: dict,
) -> dict:
    """Create WBS tree: Phase → Area → Discipline → Package. Returns lookup dict."""
    wbs_lookup = {}  # (phase, area?, disc?, pkg?) -> WBSNode

    phases = ["ENG", "PROC", "CONST"]
    areas = sorted(set(pkg["area"] for pkg in packages.values()))
    disciplines_by_area = defaultdict(set)
    pkgs_by_area_disc = defaultdict(list)

    for key, pkg in packages.items():
        disciplines_by_area[pkg["area"]].add(pkg["discipline"])
        pkgs_by_area_disc[(pkg["area"], pkg["discipline"])].append(pkg)

    for phase in phases:
        # Level 1: Phase
        phase_node = WBSNode(
            tenant_id=tenant_id, project_id=project_id,
            parent_id=None, level=1, code=phase, name=phase,
        )
        db.add(phase_node)
        await db.flush()
        wbs_lookup[(phase,)] = phase_node

        for area in areas:
            # Level 2: Area
            area_node = WBSNode(
                tenant_id=tenant_id, project_id=project_id,
                parent_id=phase_node.id, level=2, code=area, name=area,
            )
            db.add(area_node)
            await db.flush()
            wbs_lookup[(phase, area)] = area_node

            for disc in sorted(disciplines_by_area[area]):
                # Level 3: Discipline
                disc_node = WBSNode(
                    tenant_id=tenant_id, project_id=project_id,
                    parent_id=area_node.id, level=3, code=disc, name=disc,
                )
                db.add(disc_node)
                await db.flush()
                wbs_lookup[(phase, area, disc)] = disc_node

                for pkg in pkgs_by_area_disc[(area, disc)]:
                    # Level 4: Package
                    pkg_node = WBSNode(
                        tenant_id=tenant_id, project_id=project_id,
                        parent_id=disc_node.id, level=4,
                        code=pkg["code"], name=f"{disc}-{pkg['code']}",
                    )
                    db.add(pkg_node)
                    await db.flush()
                    wbs_lookup[(phase, area, disc, pkg["code"])] = pkg_node

    return wbs_lookup


# ── 4) Generate activities ───────────────────────────────────────────────
async def generate_activities(
    db: AsyncSession, project_id: str, tenant_id: str,
    packages: dict, wbs_lookup: dict,
) -> list[Activity]:
    """Create activities from templates for each package."""
    # Load templates for this tenant
    result = await db.execute(
        select(Template).where(Template.tenant_id == tenant_id)
    )
    templates = result.scalars().all()
    tmpl_map = {(t.discipline, t.work_type): t for t in templates}

    all_activities = []

    for key, pkg in packages.items():
        area = pkg["area"]
        disc = pkg["discipline"]
        wtype = pkg["work_type"]
        pkg_code = pkg["code"]

        # Find matching template or use generic
        tmpl = tmpl_map.get((disc, wtype))
        steps = tmpl.steps_json if tmpl else GENERIC_TEMPLATE_STEPS

        for phase_block in steps:
            phase = phase_block["phase"]
            seq = 10
            for act_def in phase_block.get("activities", []):
                # Skip optional activities unless enabled
                if act_def.get("optional", False):
                    continue

                act_code = act_def["code"]
                act_id = f"{phase}-{area}-{disc}-{pkg_code}-{seq:03d}"
                act_uid = str(uuid.uuid4())

                # Find WBS node for this phase/area/disc/pkg
                wbs_key = (phase, area, disc, pkg_code)
                wbs_node = wbs_lookup.get(wbs_key)

                activity = Activity(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    wbs_id=wbs_node.id if wbs_node else None,
                    act_uid=act_uid,
                    act_id=act_id,
                    name=act_def["name"],
                    phase=phase,
                    area=area,
                    discipline=disc,
                    package_code=pkg_code,
                    seq=seq,
                    dur_hr=act_def.get("default_dur_hr", 0),
                    calendar_code="CAL-5X8",
                    meta_json={"template_code": act_code},
                )
                db.add(activity)
                all_activities.append(activity)
                seq += 10

    await db.flush()
    return all_activities


# ── 5) Create relationships ──────────────────────────────────────────────
async def create_relationships(
    db: AsyncSession, project_id: str, tenant_id: str,
    activities: list[Activity], packages: dict,
):
    """Create relationships based on template rules."""
    # Load templates
    result = await db.execute(
        select(Template).where(Template.tenant_id == tenant_id)
    )
    templates = result.scalars().all()
    tmpl_map = {(t.discipline, t.work_type): t for t in templates}

    # Group activities by package
    pkg_activities = defaultdict(list)
    for act in activities:
        pkg_activities[act.package_code].append(act)

    for key, pkg in packages.items():
        disc = pkg["discipline"]
        wtype = pkg["work_type"]
        pkg_code = pkg["code"]

        tmpl = tmpl_map.get((disc, wtype))
        rules = tmpl.rules_json if tmpl else GENERIC_RULES
        deps = rules.get("dependencies", [])

        # Build lookup: (phase, template_code) -> activity
        act_lookup = {}
        for act in pkg_activities.get(pkg_code, []):
            tmpl_code = (act.meta_json or {}).get("template_code", "")
            act_lookup[(act.phase, tmpl_code)] = act

        for dep in deps:
            pred = act_lookup.get((dep["pred_phase"], dep["pred_code"]))
            succ = act_lookup.get((dep["succ_phase"], dep["succ_code"]))
            if pred and succ:
                rel = Relationship(
                    tenant_id=tenant_id,
                    project_id=project_id,
                    pred_act_uid=pred.act_uid,
                    succ_act_uid=succ.act_uid,
                    rel_type=dep.get("type", "FS"),
                    lag_hr=dep.get("lag_hr", 0),
                )
                db.add(rel)

    await db.flush()


# ── 6) Compute estimates ─────────────────────────────────────────────────
async def compute_estimates(
    db: AsyncSession, tenant_id: str,
    activities: list[Activity], packages: dict,
) -> list[str]:
    """Compute MH, duration, ROM cost. Returns list of warnings."""
    result = await db.execute(
        select(ProductivityNorm).where(ProductivityNorm.tenant_id == tenant_id)
    )
    norms = result.scalars().all()
    norm_map = {(n.discipline, n.work_type): n for n in norms}

    warnings = []
    # Build package qty lookup
    pkg_qty = {pkg["code"]: pkg["total_qty"] for pkg in packages.values()}

    for act in activities:
        norm = norm_map.get((act.discipline, (act.meta_json or {}).get("template_code", "")))
        if not norm:
            norm = norm_map.get((act.discipline, act.package_code))
        # Try discipline + work_type from package
        pkg_info = None
        for pkg in packages.values():
            if pkg["code"] == act.package_code:
                pkg_info = pkg
                break

        if not norm and pkg_info:
            norm = norm_map.get((pkg_info["discipline"], pkg_info["work_type"]))

        tmpl_code = (act.meta_json or {}).get("template_code", "")

        if tmpl_code == "INST" and act.phase == "CONST":
            # Construction installation: MH = qty * mh_per_uom
            qty = pkg_qty.get(act.package_code, 0)
            if norm:
                mh_per_uom = float(norm.mh_per_uom or 1)
                crew = norm.crew_json or {}
                crew_size = crew.get("crew_size", 6)
                hours_per_day = crew.get("hours_per_day", 8)
                labor_rate = float(norm.labor_rate or 0)

                act.mh = qty * mh_per_uom
                act.dur_hr = (float(act.mh) / (crew_size * hours_per_day)) * 8 if crew_size > 0 else 0
                act.rom_cost = float(act.mh) * labor_rate
            else:
                act.mh = qty  # fallback mh_per_uom = 1
                act.dur_hr = float(act.dur_hr or 80)  # keep template default
                warnings.append(f"No norm for {act.discipline}/{act.package_code}, using fallback")
        else:
            # Other activities: keep default duration from template
            if norm and float(norm.labor_rate or 0) > 0:
                act.mh = float(act.dur_hr or 0)  # assume 1:1 for non-INST
                act.rom_cost = float(act.mh) * float(norm.labor_rate)

    await db.flush()
    return warnings


# ── 7) Main orchestrator ─────────────────────────────────────────────────
async def generate_schedule(
    db: AsyncSession, project_id: str, tenant_id: str,
) -> dict:
    """Full schedule generation pipeline. Returns summary dict."""
    # Load project
    result = await db.execute(
        select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise ValueError("Project not found")

    # Clear existing schedule data
    await db.execute(delete(Relationship).where(
        Relationship.project_id == project_id, Relationship.tenant_id == tenant_id))
    await db.execute(delete(Activity).where(
        Activity.project_id == project_id, Activity.tenant_id == tenant_id))
    await db.execute(delete(WBSNode).where(
        WBSNode.project_id == project_id, WBSNode.tenant_id == tenant_id))
    await db.flush()

    # Load BOQ items
    result = await db.execute(
        select(BOQItem).where(
            BOQItem.project_id == project_id, BOQItem.tenant_id == tenant_id)
    )
    boq_items = list(result.scalars().all())

    if not boq_items:
        return {"wbs_count": 0, "activity_count": 0, "relationship_count": 0, "warnings": ["No BOQ items found"]}

    # 1) Classify
    await classify_boq_items(db, project, boq_items)

    # 2) Assign packages
    packages = assign_packages(boq_items)

    # 3) Generate WBS
    wbs_lookup = await generate_wbs(db, project_id, tenant_id, packages)

    # 4) Generate activities
    activities = await generate_activities(db, project_id, tenant_id, packages, wbs_lookup)

    # 5) Create relationships
    await create_relationships(db, project_id, tenant_id, activities, packages)

    # 6) Compute estimates
    warnings = await compute_estimates(db, tenant_id, activities, packages)

    await db.flush()

    return {
        "wbs_count": len(wbs_lookup),
        "activity_count": len(activities),
        "relationship_count": 0,  # counted during creation
        "warnings": warnings,
    }
