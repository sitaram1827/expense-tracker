from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from uuid import uuid4
import os

app = Flask(__name__)
CORS(app)

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
client = MongoClient(MONGO_URI)
db = client.expense_tracker
users = db.users
transactions = db.transactions

users.create_index("email", unique=True)
transactions.create_index("id", unique=True)

def ser_tx(d):
  return {"id": d.get("id"), "desc": d.get("desc"), "amount": d.get("amount"), "category": d.get("category"), "type": d.get("type"), "date": d.get("date")}


def user_stats(email):
  txs = list(transactions.find({"email": email}, {"_id": 0}))
  total_inc = sum(t.get("amount", 0) for t in txs if t.get("type") == "income")
  total_exp = sum(t.get("amount", 0) for t in txs if t.get("type") == "expense")
  return {"transaction_count": len(txs), "total_income": total_inc, "total_expense": total_exp, "balance": total_inc - total_exp}

def get_user(em):
  u = users.find_one({"email": em})
  return (u, None) if u else (None, {"error": "User not found"})

def is_admin(em):
  u = users.find_one({"email": em})
  return u.get("is_admin", False) if u else False

@app.route("/api/auth/register", methods=["POST"])
def register():
  data = request.json
  name, em, pwd = data.get("name"), data.get("email"), data.get("password")
  if not all([name, em, pwd]) or len(pwd) < 6: return {"error": "Invalid"}, 400
  try:
    # make user admin if their email ends with ".admin" or if explicitly set
    is_admin_flag = bool(data.get("is_admin", False)) or (isinstance(em, str) and em.strip().endswith(".admin"))
    users.insert_one({"name": name, "email": em, "password_hash": generate_password_hash(pwd), "is_admin": is_admin_flag, "created_at": datetime.now()})
    return {"msg": "Registered"}
  except Exception as e:
    return {"error": str(e)}, 400

@app.route("/api/auth/login", methods=["POST"])
def login():
  data = request.json
  em, pwd = data.get("email"), data.get("password")
  u, err = get_user(em)
  if err: return err, 401
  if not check_password_hash(u.get("password_hash", ""), pwd): return {"error": "Invalid"}, 401
  return {"user": {"name": u.get("name"), "email": u.get("email")}, "is_admin": u.get("is_admin", False)}

@app.route("/api/me", methods=["GET"])
def me():
  em = request.args.get("email")
  u, err = get_user(em)
  if err: return err, 401
  txs = list(transactions.find({"email": em}, {"_id": 0}))
  resp = {
    "user": {"name": u.get("name"), "email": u.get("email")},
    "is_admin": u.get("is_admin", False),
    "transactions": [ser_tx(t) for t in txs],
  }
  if u.get("is_admin"):
    users_list = []
    for usr in db.users.find({}, {"_id": 0, "password_hash": 0}):
      stats = user_stats(usr.get("email"))
      usr.update(stats)
      users_list.append(usr)
    resp["users"] = users_list
  else:
    resp["users"] = []
  return resp

@app.route("/api/admin/overview", methods=["GET"])
def admin_overview():
  em = request.args.get("email")
  if not is_admin(em): return {"error": "Forbidden"}, 403
  all_txs = list(transactions.find({}, {"_id": 0}))
  total_inc = sum(t.get("amount", 0) for t in all_txs if t.get("type") == "income")
  total_exp = sum(t.get("amount", 0) for t in all_txs if t.get("type") == "expense")
  users_enriched = []
  for usr in db.users.find({}, {"_id": 0, "password_hash": 0}):
    stats = user_stats(usr.get("email"))
    usr.update(stats)
    users_enriched.append(usr)
  return {
    "summary": {"total_users": users.count_documents({}), "total_transactions": len(all_txs), "total_income": total_inc, "total_expense": total_exp},
    "users": users_enriched,
    "recent_transactions": sorted(all_txs, key=lambda t: t.get("date", ""), reverse=True)[:10]
  }


@app.route("/api/admin/users/<path:target_email>", methods=["DELETE"])
def admin_delete_user(target_email):
  admin_em = request.args.get("email")
  if not is_admin(admin_em):
    return {"error": "Forbidden"}, 403
  # prevent admins deleting themselves
  if admin_em == target_email:
    return {"error": "Cannot delete self"}, 400
  users.delete_one({"email": target_email})
  transactions.delete_many({"email": target_email})
  return {"msg": "User deleted"}


@app.route("/api/admin/users/<path:target_email>/promote", methods=["POST"])
def admin_promote_user(target_email):
  admin_em = request.args.get("email")
  if not is_admin(admin_em):
    return {"error": "Forbidden"}, 403
  # prevent promoting if already admin
  u = users.find_one({"email": target_email})
  if not u:
    return {"error": "User not found"}, 404
  if u.get("is_admin", False):
    return {"msg": "Already admin"}
  users.update_one({"email": target_email}, {"$set": {"is_admin": True}})
  return {"msg": "Promoted"}

@app.route("/api/transactions", methods=["POST"])
def add_tx():
  data = request.json
  em, desc, amt, cat, typ, dt = data.get("email"), data.get("desc"), data.get("amount"), data.get("category"), data.get("type"), data.get("date")
  if not all([em, desc, amt, cat, typ, dt]): return {"error": "Missing"}, 400
  u, err = get_user(em)
  if err: return err, 401
  tx_id = str(uuid4())
  transactions.insert_one({"id": tx_id, "email": em, "desc": desc, "amount": amt, "category": cat, "type": typ, "date": dt, "created_at": datetime.now()})
  return {"id": tx_id}, 201

@app.route("/api/transactions/<tx_id>", methods=["PUT"])
def update_tx(tx_id):
  data = request.json
  em = data.get("email")
  u, err = get_user(em)
  if err: return err, 401
  transactions.update_one({"id": tx_id, "email": em}, {"$set": {k: v for k, v in data.items() if k != "email" and k != "id"}})
  return {"msg": "Updated"}

@app.route("/api/transactions/<tx_id>", methods=["DELETE"])
def del_tx(tx_id):
  em = request.headers.get("Email")
  u, err = get_user(em)
  if err: return err, 401
  transactions.delete_one({"id": tx_id, "email": em})
  return {"msg": "Deleted"}

if __name__ == "__main__":
  app.run(debug=True, port=5000)