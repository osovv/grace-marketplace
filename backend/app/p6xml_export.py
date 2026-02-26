"""
P6XML Export: Generates a Primavera P6-compatible XML file.
"""
import uuid
from lxml import etree

from app.models import Project, WBSNode, Activity, Relationship


def _oid():
    return str(uuid.uuid4())


def generate_p6xml(
    project: Project,
    wbs_nodes: list[WBSNode],
    activities: list[Activity],
    relationships: list[Relationship],
) -> bytes:
    """Generate P6XML bytes for download."""

    root = etree.Element("APIBusinessObjects")

    # ── Calendar ──────────────────────────────────────────────────────
    cal_oid = _oid()
    cal_el = etree.SubElement(root, "CalendarType")
    etree.SubElement(cal_el, "ObjectId").text = cal_oid
    etree.SubElement(cal_el, "Name").text = "Standard 5x8"
    etree.SubElement(cal_el, "CalendarId").text = "CAL-5X8"
    etree.SubElement(cal_el, "HoursPerDay").text = "8"
    etree.SubElement(cal_el, "HoursPerWeek").text = "40"
    etree.SubElement(cal_el, "HoursPerMonth").text = "172"
    etree.SubElement(cal_el, "HoursPerYear").text = "2080"

    # Standard work week
    std_wk = etree.SubElement(cal_el, "StandardWorkWeek")
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for day_name in day_names:
        day_el = etree.SubElement(std_wk, "StandardWorkHours")
        etree.SubElement(day_el, "DayOfWeek").text = day_name
        if day_name in ("Saturday", "Sunday"):
            etree.SubElement(day_el, "IsWorkDay").text = "false"
        else:
            etree.SubElement(day_el, "IsWorkDay").text = "true"
            wh = etree.SubElement(day_el, "WorkHours")
            etree.SubElement(wh, "StartTime").text = "08:00"
            etree.SubElement(wh, "FinishTime").text = "17:00"

    # ── Project ───────────────────────────────────────────────────────
    proj_oid = _oid()
    proj_el = etree.SubElement(root, "ProjectType")
    etree.SubElement(proj_el, "ObjectId").text = proj_oid
    etree.SubElement(proj_el, "ProjectId").text = project.name[:20].replace(" ", "_")
    etree.SubElement(proj_el, "Name").text = project.name
    etree.SubElement(proj_el, "CalendarObjectId").text = cal_oid

    # ── WBS ───────────────────────────────────────────────────────────
    wbs_oid_map = {}  # wbs.id -> ObjectId
    for node in wbs_nodes:
        oid = _oid()
        wbs_oid_map[node.id] = oid

        wbs_el = etree.SubElement(root, "WBSType")
        etree.SubElement(wbs_el, "ObjectId").text = oid
        etree.SubElement(wbs_el, "Code").text = node.code or ""
        etree.SubElement(wbs_el, "Name").text = node.name or node.code or ""
        etree.SubElement(wbs_el, "ProjectObjectId").text = proj_oid
        if node.parent_id and node.parent_id in wbs_oid_map:
            etree.SubElement(wbs_el, "ParentObjectId").text = wbs_oid_map[node.parent_id]
        etree.SubElement(wbs_el, "SequenceNumber").text = str(node.level or 0)

    # ── Activities ────────────────────────────────────────────────────
    act_oid_map = {}  # act_uid -> ObjectId
    for act in activities:
        oid = _oid()
        act_oid_map[act.act_uid] = oid

        act_el = etree.SubElement(root, "ActivityType")
        etree.SubElement(act_el, "ObjectId").text = oid
        etree.SubElement(act_el, "ActivityId").text = act.act_id or ""
        etree.SubElement(act_el, "Name").text = act.name or ""
        etree.SubElement(act_el, "ProjectObjectId").text = proj_oid

        if act.wbs_id and act.wbs_id in wbs_oid_map:
            etree.SubElement(act_el, "WBSObjectId").text = wbs_oid_map[act.wbs_id]

        # Duration in hours
        dur = float(act.dur_hr or 0)
        etree.SubElement(act_el, "PlannedDuration").text = f"{dur:.1f}h"
        # Original duration in P6 typically in days for 8hr calendar
        dur_days = dur / 8 if dur > 0 else 0
        etree.SubElement(act_el, "OriginalDuration").text = f"{dur_days:.2f}"
        etree.SubElement(act_el, "CalendarObjectId").text = cal_oid

        # Type
        etree.SubElement(act_el, "ActivityType").text = "TaskDependent"

    # ── Relationships ─────────────────────────────────────────────────
    for rel in relationships:
        pred_oid = act_oid_map.get(rel.pred_act_uid)
        succ_oid = act_oid_map.get(rel.succ_act_uid)
        if not pred_oid or not succ_oid:
            continue

        rel_el = etree.SubElement(root, "ActivityRelationshipType")
        etree.SubElement(rel_el, "ObjectId").text = _oid()
        etree.SubElement(rel_el, "PredecessorActivityObjectId").text = pred_oid
        etree.SubElement(rel_el, "SuccessorActivityObjectId").text = succ_oid
        etree.SubElement(rel_el, "Type").text = _map_rel_type(rel.rel_type)
        lag = float(rel.lag_hr or 0)
        lag_days = lag / 8
        etree.SubElement(rel_el, "Lag").text = f"{lag_days:.2f}"

    return etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="UTF-8")


def _map_rel_type(rel_type: str) -> str:
    mapping = {
        "FS": "Finish to Start",
        "SS": "Start to Start",
        "FF": "Finish to Finish",
        "SF": "Start to Finish",
    }
    return mapping.get(rel_type, "Finish to Start")
