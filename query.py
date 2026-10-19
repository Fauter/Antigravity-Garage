import sqlite3
import json

conn = sqlite3.connect('./.data/garageia.sqlite')
cursor = conn.cursor()

cursor.execute('SELECT json_data FROM debts WHERE json_extract(json_data, "$.status") = "PENDING"')
debts = cursor.fetchall()
for d in debts:
    data = json.loads(d[0])
    if data.get('amount') == 341000:
        print(json.dumps(data, indent=2))
