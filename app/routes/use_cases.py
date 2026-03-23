import json
from flask import Blueprint, jsonify, request
from app.database import get_db

use_cases_bp = Blueprint("use_cases", __name__, url_prefix="/api/use-cases")


def _build_tree(db, use_case_id):
    """Reconstruct the nested node tree from flat DB rows."""
    nodes = db.execute(
        "SELECT * FROM nodes WHERE use_case_id = ? ORDER BY position",
        (use_case_id,),
    ).fetchall()

    attrs = db.execute(
        """
        SELECT a.* FROM attributes a
        JOIN nodes n ON a.node_id = n.id
        WHERE n.use_case_id = ?
        ORDER BY a.position
        """,
        (use_case_id,),
    ).fetchall()

    attr_map = {}
    for a in attrs:
        attr_map.setdefault(a["node_id"], []).append({
            "id":      a["id"],
            "name":    a["name"],
            "value":   a["value"],
            "isInput": bool(a["is_input"]),
        })

    node_map = {}
    for n in nodes:
        node_map[n["id"]] = {
            "id":         n["id"],
            "name":       n["name"],
            "flags":      json.loads(n["flags"] or "[]"),
            "attributes": attr_map.get(n["id"], []),
            "children":   [],
        }

    roots = []
    for n in nodes:
        nd = node_map[n["id"]]
        if n["parent_id"] and n["parent_id"] in node_map:
            node_map[n["parent_id"]]["children"].append(nd)
        elif not n["parent_id"]:
            roots.append(nd)

    return roots


def _flatten_nodes(nodes, use_case_id, parent_id=None):
    """Flatten nested tree into list of rows."""
    rows = []
    for i, node in enumerate(nodes):
        rows.append({
            "id":          node["id"],
            "use_case_id": use_case_id,
            "parent_id":   parent_id,
            "name":        node["name"],
            "flags":       json.dumps(node.get("flags", [])),
            "position":    i,
            "attributes":  node.get("attributes", []),
        })
        rows.extend(_flatten_nodes(node.get("children", []), use_case_id, node["id"]))
    return rows


# ── LIST ──────────────────────────────────────────────────────────────────────

@use_cases_bp.route("/", methods=["GET"])
def list_use_cases():
    db = get_db()
    rows = db.execute(
        "SELECT id, name, created_at, updated_at FROM use_cases ORDER BY updated_at DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


# ── CREATE ────────────────────────────────────────────────────────────────────

@use_cases_bp.route("/", methods=["POST"])
def create_use_case():
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    db = get_db()
    cur = db.execute("INSERT INTO use_cases (name) VALUES (?)", (name,))
    db.commit()
    uc = db.execute("SELECT * FROM use_cases WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(uc)), 201


# ── GET ───────────────────────────────────────────────────────────────────────

@use_cases_bp.route("/<int:uc_id>", methods=["GET"])
def get_use_case(uc_id):
    db = get_db()
    uc = db.execute("SELECT * FROM use_cases WHERE id = ?", (uc_id,)).fetchone()
    if not uc:
        return jsonify({"error": "not found"}), 404
    tree = _build_tree(db, uc_id)
    return jsonify({**dict(uc), "tree": tree})


# ── RENAME ────────────────────────────────────────────────────────────────────

@use_cases_bp.route("/<int:uc_id>", methods=["PATCH"])
def rename_use_case(uc_id):
    data = request.get_json(force=True)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400
    db = get_db()
    db.execute(
        "UPDATE use_cases SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (name, uc_id),
    )
    db.commit()
    uc = db.execute("SELECT * FROM use_cases WHERE id = ?", (uc_id,)).fetchone()
    if not uc:
        return jsonify({"error": "not found"}), 404
    return jsonify(dict(uc))


# ── SAVE TREE ─────────────────────────────────────────────────────────────────

@use_cases_bp.route("/<int:uc_id>/tree", methods=["PUT"])
def save_tree(uc_id):
    """Replace the entire tree for a use case (full overwrite)."""
    data = request.get_json(force=True)
    tree = data.get("tree", [])

    db = get_db()
    uc = db.execute("SELECT id FROM use_cases WHERE id = ?", (uc_id,)).fetchone()
    if not uc:
        return jsonify({"error": "not found"}), 404

    db.execute("DELETE FROM nodes WHERE use_case_id = ?", (uc_id,))

    flat = _flatten_nodes(tree, uc_id)
    for n in flat:
        db.execute(
            "INSERT INTO nodes (id, use_case_id, parent_id, name, flags, position) VALUES (?,?,?,?,?,?)",
            (n["id"], n["use_case_id"], n["parent_id"], n["name"], n["flags"], n["position"]),
        )
        for j, a in enumerate(n["attributes"]):
            db.execute(
                "INSERT INTO attributes (id, node_id, name, value, is_input, position) VALUES (?,?,?,?,?,?)",
                (a["id"], n["id"], a["name"], a.get("value", ""), 1 if a.get("isInput") else 0, j),
            )

    db.execute(
        "UPDATE use_cases SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (uc_id,)
    )
    db.commit()
    return jsonify({"ok": True})


# ── DELETE ────────────────────────────────────────────────────────────────────

@use_cases_bp.route("/<int:uc_id>", methods=["DELETE"])
def delete_use_case(uc_id):
    db = get_db()
    db.execute("DELETE FROM use_cases WHERE id = ?", (uc_id,))
    db.commit()
    return jsonify({"ok": True})