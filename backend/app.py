# backend/app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from settlement import calculate_settlements, Expense

app = Flask(__name__)
CORS(app)  # This allows the React frontend to talk to this backend

@app.route('/api/calculate', methods=['POST'])
def calculate():
    data = request.json
    # Convert JSON data into our Python objects
    expenses_list = []
    for item in data:
        expenses_list.append(Expense(item['payer'], item['amount'], item['involved']))

    results = calculate_settlements(expenses_list)
    return jsonify(results)

if __name__ == '__main__':
    app.run(debug=True, port=5000)